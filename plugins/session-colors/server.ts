// bb-plugin-session-colors backend.
//
// Keeps one map threadId → color id in bb.storage.kv, so colors survive app
// and server restarts. Two surfaces write it: the thread header picker
// (app.tsx, over RPC) and the `bb session-colors` CLI that agents use. Every
// write publishes a realtime signal so all open windows repaint.
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  SESSION_COLORS,
  SESSION_COLOR_IDS,
  isSessionColorId,
  type SessionColorId,
} from "./colors";

const colorIdSchema = z.enum(SESSION_COLOR_IDS);
const colorMapSchema = z.record(z.string(), colorIdSchema);
export type SessionColorMap = z.infer<typeof colorMapSchema>;

export const rpcContract = defineRpcContract({
  colors_list: {
    input: z.null(),
    output: z.object({ colors: colorMapSchema }),
  },
  colors_set: {
    input: z
      .object({
        threadId: z.string().min(1).max(200),
        color: colorIdSchema.nullable(),
      })
      .strict(),
    output: z.object({ color: colorIdSchema.nullable() }),
  },
});

/** Realtime channel app.tsx listens on. */
export const COLORS_CHANGED = "colors-changed";

const STORAGE_KEY = "colors";

export default async function plugin(bb: BbPluginApi) {
  async function readColors(): Promise<SessionColorMap> {
    const stored = await bb.storage.kv.get<unknown>(STORAGE_KEY);
    if (stored === undefined || stored === null || typeof stored !== "object") {
      return {};
    }
    // Drop entries with unknown colors instead of failing the whole map.
    const colors: SessionColorMap = {};
    for (const [threadId, color] of Object.entries(stored)) {
      if (isSessionColorId(color)) colors[threadId] = color;
    }
    return colors;
  }

  // kv has no compare-and-set, so writes run one after another.
  let writeQueue: Promise<unknown> = Promise.resolve();
  function updateColors(
    update: (colors: SessionColorMap) => boolean,
  ): Promise<SessionColorMap> {
    const next = writeQueue.then(async () => {
      const colors = await readColors();
      if (update(colors)) {
        await bb.storage.kv.set(STORAGE_KEY, colors);
        bb.realtime.publish(COLORS_CHANGED, null);
      }
      return colors;
    });
    writeQueue = next.catch(() => undefined);
    return next;
  }

  function setColor(
    threadId: string,
    color: SessionColorId | null,
  ): Promise<SessionColorMap> {
    return updateColors((colors) => {
      if ((colors[threadId] ?? null) === color) return false;
      if (color === null) delete colors[threadId];
      else colors[threadId] = color;
      return true;
    });
  }

  bb.rpc.register(rpcContract, {
    colors_list: async () => ({ colors: await readColors() }),
    colors_set: async ({ threadId, color }) => {
      const colors = await setColor(threadId, color);
      return { color: colors[threadId] ?? null };
    },
  });

  // A deleted thread never comes back, so its color goes with it.
  bb.events.on("thread.deleted", async ({ thread }) => {
    await setColor(thread.id, null);
  });

  function requireThreadId(
    explicit: string | undefined,
    contextThreadId: string | undefined,
  ): string {
    const threadId = explicit ?? contextThreadId;
    if (threadId === undefined) {
      throw new PluginCliError("no thread given", {
        code: "thread_required",
        hint: "Run it from a bb thread or pass --thread <thread-id>.",
      });
    }
    return threadId;
  }

  async function requireExistingThreadId(
    explicit: string | undefined,
    contextThreadId: string | undefined,
  ): Promise<string> {
    const threadId = requireThreadId(explicit, contextThreadId);
    try {
      await bb.sdk.threads.get({ threadId });
    } catch {
      throw new PluginCliError(`thread ${threadId} not found`, {
        code: "thread_not_found",
        hint: "Run `bb thread list` to see thread ids.",
      });
    }
    return threadId;
  }

  const threadOption = {
    type: "string",
    description: "Thread id; defaults to the thread running the command",
    aliases: ["thread-id", "session"],
    placeholder: "thread-id",
  } as const;
  const jsonOption = {
    type: "boolean",
    description: "Emit machine-readable JSON",
  } as const;
  const paletteText = SESSION_COLOR_IDS.join(", ");

  bb.cli.register(
    defineCli({
      name: "session-colors",
      summary: "Color-tag bb threads in the sidebar and thread header",
      description: `Colors: ${paletteText}. Colors persist across restarts.`,
      commands: {
        set: cliCommand({
          summary: "Set a thread's color",
          positionals: [
            {
              name: "color",
              description: `One of: ${paletteText}`,
              required: true,
            },
          ],
          options: { thread: threadOption, json: jsonOption },
          async run({ positionals, options }, ctx) {
            const color = positionals.color.toLowerCase();
            if (!isSessionColorId(color)) {
              throw new PluginCliError(`unknown color "${positionals.color}"`, {
                code: "unknown_color",
                hint: `Use one of: ${paletteText}.`,
              });
            }
            const threadId = await requireExistingThreadId(
              options.thread,
              ctx.threadId,
            );
            await setColor(threadId, color);
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({ threadId, color })
                : `${threadId}: ${color}`,
            };
          },
        }),
        clear: cliCommand({
          summary: "Remove a thread's color",
          options: { thread: threadOption, json: jsonOption },
          async run({ options }, ctx) {
            const threadId = requireThreadId(options.thread, ctx.threadId);
            await setColor(threadId, null);
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({ threadId, color: null })
                : `${threadId}: no color`,
            };
          },
        }),
        get: cliCommand({
          summary: "Show a thread's color",
          options: { thread: threadOption, json: jsonOption },
          async run({ options }, ctx) {
            const threadId = requireThreadId(options.thread, ctx.threadId);
            const color = (await readColors())[threadId] ?? null;
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify({ threadId, color })
                : `${threadId}: ${color ?? "no color"}`,
            };
          },
        }),
        list: cliCommand({
          summary: "List colored threads",
          options: { json: jsonOption },
          async run({ options }) {
            const colors = await readColors();
            if (options.json) {
              return { exitCode: 0, stdout: JSON.stringify(colors) };
            }
            const entries = Object.entries(colors);
            return {
              exitCode: 0,
              stdout:
                entries.length === 0
                  ? "No colored threads."
                  : entries
                      .map(([threadId, color]) => `${threadId}  ${color}`)
                      .join("\n"),
            };
          },
        }),
        palette: cliCommand({
          summary: "List available colors",
          options: { json: jsonOption },
          run({ options }) {
            return {
              exitCode: 0,
              stdout: options.json
                ? JSON.stringify(
                    SESSION_COLORS.map(({ id, label }) => ({ id, label })),
                  )
                : SESSION_COLOR_IDS.join("\n"),
            };
          },
        }),
      },
    }),
  );
}
