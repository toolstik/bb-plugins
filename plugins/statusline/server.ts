// bb-plugin-statusline - backend entry.
//
// Context usage is read by the frontend straight from the browser SDK. Usage
// limits come from here: bb publishes them through `provider-usage.v1` RPC
// sources - the provider plugins themselves and Account Pooler - and one
// source can be throttled by the provider while another still has fresh
// numbers. `usage_limits` reads every source's cached measurement for the
// provider (refresh: false, so it never forces a new check on the provider)
// and returns the most recent successful one.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const LIST_METHOD = "provider-usage.v1.listResources";
const GET_METHOD = "provider-usage.v1.getResource";
const CACHE_MS = 30_000;

const windowSchema = z
  .object({
    kind: z.string().optional(),
    label: z.string(),
    usedPercent: z.number(),
    resetsAt: z.string().nullable(),
    model: z.string().nullable().optional(),
  })
  .passthrough();

const okUsageSchema = z
  .object({
    status: z.literal("ok"),
    accountEmail: z.string().nullable().optional(),
    planLabel: z.string().nullable().optional(),
    windows: z.array(windowSchema),
  })
  .passthrough();

const usageSchema = z.union([
  okUsageSchema,
  z.object({ status: z.string(), message: z.string().optional() }).passthrough(),
]);

const resourceListSchema = z
  .object({
    resources: z.array(z.object({ id: z.string(), providerId: z.string() }).passthrough()),
  })
  .passthrough();

const resourceSchema = z
  .object({
    observedAt: z.number().nullable(),
    usage: usageSchema,
  })
  .passthrough();

const limitsSchema = z.object({
  /** The freshest successful measurement, or null when no source has one. */
  usage: okUsageSchema.nullable(),
  /** Plugin id of the source the measurement came from. */
  source: z.string().nullable(),
  observedAt: z.number().nullable(),
  /** Why no source had a measurement; null when `usage` is set. */
  error: z.string().nullable(),
});

export type Limits = z.infer<typeof limitsSchema>;
export type UsageWindow = z.infer<typeof windowSchema>;

export const rpcContract = defineRpcContract({
  usage_limits: {
    input: z.object({ providerId: z.string().min(1).max(100) }),
    output: limitsSchema,
  },
});

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default async function plugin(bb: BbPluginApi) {
  const cache = new Map<string, { at: number; value: Promise<Limits> }>();

  async function collect(providerId: string): Promise<Limits> {
    const methods = await bb.sdk.plugins.experimental_discoverRpc({ method: LIST_METHOD });
    const sources = [...new Set(methods.map((method) => method.pluginId))];
    const errors: string[] = [];
    let best: Limits | null = null;
    await Promise.all(
      sources.map(async (pluginId) => {
        try {
          const { resources } = await bb.sdk.plugins.callRpc({
            pluginId,
            method: LIST_METHOD,
            input: {},
            outputSchema: resourceListSchema,
          });
          for (const resource of resources.filter((r) => r.providerId === providerId)) {
            const result = await bb.sdk.plugins.callRpc({
              pluginId,
              method: GET_METHOD,
              input: { resourceId: resource.id, refresh: false },
              outputSchema: resourceSchema,
            });
            const ok = okUsageSchema.safeParse(result.usage);
            if (!ok.success) {
              const reason = "message" in result.usage ? result.usage.message : result.usage.status;
              errors.push(`${pluginId}: ${String(reason)}`);
              continue;
            }
            const observedAt = result.observedAt ?? 0;
            if (best === null || observedAt > (best.observedAt ?? 0)) {
              best = { usage: ok.data, source: pluginId, observedAt, error: null };
            }
          }
        } catch (cause) {
          errors.push(`${pluginId}: ${message(cause)}`);
        }
      }),
    );
    return (
      best ?? {
        usage: null,
        source: null,
        observedAt: null,
        error: errors.length > 0 ? errors.join("; ") : `no usage source reports limits for ${providerId}`,
      }
    );
  }

  bb.rpc.register(rpcContract, {
    usage_limits: ({ providerId }) => {
      const hit = cache.get(providerId);
      if (hit !== undefined && Date.now() - hit.at < CACHE_MS) return hit.value;
      const value = collect(providerId).catch(
        (cause): Limits => ({ usage: null, source: null, observedAt: null, error: message(cause) }),
      );
      cache.set(providerId, { at: Date.now(), value });
      return value;
    },
  });
}
