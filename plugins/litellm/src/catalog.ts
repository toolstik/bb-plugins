import { createHash } from "node:crypto";
import type { AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import type { GatewayOptions } from "./config.js";
import { readCredential } from "./credentials.js";
import { defaultEffort, modelEfforts } from "./effort.js";

export type Catalog = { models: AvailableModel[]; selectedOnlyModels: AvailableModel[] };
const nonChat = /embed|rerank|whisper|tts|dall-e|stable.diffusion|imagen/i;

export function parseCatalog(data: unknown, options: GatewayOptions, info = new Map<string, unknown[]>()): Catalog {
  if (!data || typeof data !== "object" || !Array.isArray((data as { data?: unknown }).data)) {
    throw new Error("LiteLLM returned an invalid model catalog.");
  }
  const models: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const row of (data as { data: unknown[] }).data.slice(0, 5000)) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = item.id;
    if (typeof id !== "string" || !id.trim() || id.length > 512) continue;
    if (item.mode && !["chat", "completion", "responses"].includes(String(item.mode))) continue;
    if (nonChat.test(id)) continue;
    const model = options.modelAliases[id] ?? id;
    if (options.modelAllowlist.length && !options.modelAllowlist.includes(id) && !options.modelAllowlist.includes(model)) continue;
    if (seen.has(model)) continue;
    seen.add(model);
    const supportedReasoningEfforts = modelEfforts(options.baseUrl, id, model, info);
    models.push({ id: model, model, displayName: id, description: "Corporate LiteLLM. Agent compatibility depends on the upstream model.",
      reasoningDiscovery: "known", supportedReasoningEfforts, defaultReasoningEffort: supportedReasoningEfforts.length ? defaultEffort : "medium", isDefault: false });
    if (models.length === 1000) break;
  }
  if (models.length === 0) throw new Error("LiteLLM returned no selectable chat models. Check the key and model allowlist.");
  const preferred = models.find(m => m.id === options.defaultModel || m.displayName === options.defaultModel);
  (preferred ?? models[0])!.isDefault = true;
  return { models, selectedOnlyModels: [] };
}

async function fetchModelInfo(baseUrl: string, key: string, signal: AbortSignal): Promise<Map<string, unknown[]>> {
  const models = new Map<string, unknown[]>();
  try {
    const response = await fetch(baseUrl + "/model/info", {
      headers: { Authorization: "Bearer " + key }, redirect: "error", signal,
    });
    if (!response.ok) { await response.body?.cancel(); return models; }
    const body = await response.text();
    if (body.length > 2_000_000) return models;
    const { data } = JSON.parse(body);
    if (!Array.isArray(data)) return models;
    for (const row of data.slice(0, 5000)) {
      if (typeof row?.model_name !== "string") continue;
      const deployments = models.get(row.model_name) ?? [];
      deployments.push(row);
      models.set(row.model_name, deployments);
    }
  } catch { /* Optional metadata; model discovery still works without it. */ }
  return models;
}

export class CatalogClient {
  private cache: { fingerprint: string; expires: number; value: Catalog } | undefined;
  async list(options: GatewayOptions, force = false): Promise<Catalog> {
    const key = await readCredential(options.keyFile);
    const fingerprint = createHash("sha256").update(JSON.stringify(options)).update(key).digest("hex");
    if (!force && this.cache?.fingerprint === fingerprint && this.cache.expires > Date.now()) return structuredClone(this.cache.value);
    const modelInfo = fetchModelInfo(options.baseUrl, key, AbortSignal.timeout(8_000));
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error("Cannot reach LiteLLM model catalog. Check URL, network and TLS."); }
    if (!response.ok) throw new Error(`LiteLLM model catalog returned HTTP ${response.status}.`);
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error("LiteLLM model catalog exceeds size limit.");
    let json: unknown;
    try { json = JSON.parse(body); } catch { throw new Error("LiteLLM model catalog is not JSON."); }
    const info = await modelInfo;
    const value = parseCatalog(json, options, info);
    const ttl = info.size ? 60_000 : 5_000;
    this.cache = { fingerprint, expires: Date.now() + ttl, value };
    return structuredClone(value);
  }
}
