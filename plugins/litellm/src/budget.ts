import { createHash } from "node:crypto";
import { z } from "zod";
import { keyFilePath, normalizedBaseUrl } from "./config.js";
import { readCredential } from "./credentials.js";
import type { UsageMeasurement } from "../usage-contract.js";

const budgetSchema = z.object({
  spend: z.number().finite().nonnegative(),
  max_budget: z.number().finite().nonnegative().nullable(),
  budget_reset_at: z.string().nullable().optional(),
});
const userBudgetSchema = budgetSchema.omit({ max_budget: true }).extend({
  metadata: z.object({ paid_model_budget: z.number().finite().positive() }),
}).transform(({ metadata, ...user }) => ({ ...user, max_budget: metadata.paid_model_budget }));
const cache = new Map<string, { at: number; value: Promise<UsageMeasurement> }>();

export function budgetWindow(value: unknown, scope: "key" | "user") {
  const result = (scope === "user" ? userBudgetSchema : budgetSchema).safeParse(value);
  if (!result.success || !result.data.max_budget) return null;
  const { spend, max_budget, budget_reset_at } = result.data;
  return { id: `litellm-${scope}-budget`, kind: "custom" as const,
    label: scope === "user" ? "Paid model budget" : "Key budget", model: null,
    usedPercent: spend / max_budget * 100,
    resetsAt: budget_reset_at && Number.isFinite(Date.parse(budget_reset_at)) ? new Date(budget_reset_at).toISOString() : null,
    cost: { usedUsdCents: spend * 100, limitUsdCents: max_budget * 100 } };
}

async function request(baseUrl: string, route: string, key: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(baseUrl + route, { headers: { Authorization: `Bearer ${key}`, "User-Agent": "bb-litellm/0.1.4" },
      redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  } catch { throw new Error("Cannot reach LiteLLM budget API."); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`LiteLLM ${route} returned HTTP ${response.status}.`); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty LiteLLM budget response.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 2_000_000) throw new Error("LiteLLM budget response exceeds size limit."); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new Error("Invalid LiteLLM budget response."); }
}

export async function budgetUsage(input: { baseUrl: string; keyFile: string; refresh: boolean }, signal?: AbortSignal): Promise<UsageMeasurement> {
  const failure = (message: string): UsageMeasurement => ({ accountKey: null, observedAt: null,
    usage: { status: "error", accountEmail: null, plan: null, planLabel: null, message } });
  let key: string, baseUrl: string;
  try { baseUrl = normalizedBaseUrl(input.baseUrl); key = await readCredential(keyFilePath(input.keyFile)); }
  catch { return failure("LiteLLM credentials or URL are unavailable. Check plugin settings."); }
  const fingerprint = createHash("sha256").update(baseUrl).update(key).digest("hex");
  const hit = cache.get(fingerprint);
  if (hit && Date.now() - hit.at < (input.refresh ? 5_000 : 60_000)) return hit.value;
  const value = (async (): Promise<UsageMeasurement> => {
    const results = await Promise.allSettled([request(baseUrl, "/key/info", key, signal), request(baseUrl, "/user/info", key, signal)]);
    const windows = results.flatMap((result, index) => {
      if (result.status !== "fulfilled") return [];
      const window = budgetWindow(result.value[index === 0 ? "info" : "user_info"], index === 0 ? "key" : "user");
      return window ? [window] : [];
    });
    if (!windows.length) return failure(results.some(r => r.status === "rejected")
      ? "LiteLLM budget API is unavailable or access is denied. Ask support for read access to your own /key/info and /user/info."
      : "LiteLLM reports no valid user_info.metadata.paid_model_budget or finite key budget. No default dollar limit is assumed.");
    return { accountKey: null, observedAt: Date.now(), usage: { status: "ok", accountEmail: null, plan: null,
      planLabel: "LiteLLM", windows } };
  })().catch(() => failure("Cannot collect LiteLLM budget usage."));
  if (cache.size >= 32) cache.clear();
  cache.set(fingerprint, { at: Date.now(), value });
  return value;
}
