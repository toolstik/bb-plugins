import type { ModelReasoningEffort } from "@get-bb/plugin-sdk/provider-bridge";
import { corporateBaseUrl } from "./config.js";

const levels = ["none", "low", "medium", "high", "xhigh", "max"] as const;
type Effort = typeof levels[number];
export const defaultEffort = "effort-default";

// LiteLLM's model cost map and the corporate Messages API contract define
// the levels for these exact upstream models.
const standard = ["low", "medium", "high", "xhigh"] as const;
const maximum = [...standard, "max"] as const;
const optional = ["none", ...standard] as const;
const modelProfiles = new Map<string, readonly Effort[]>([
  ["claude-fable-5-1", maximum],
  ["claude-opus-5-5", maximum],
  ["claude-sonnet-5", maximum],
  ["gpt-5.3-codex", standard],
  ["gpt-5.4-mini", optional],
  ["gpt-5.6-sol", optional],
  ["gpt-5.6-terra", optional],
  ["gpt-5.6-luna", optional],
  ["gpt-6-sol", ["none", ...maximum]],
  ["gpt-6-luna", ["none", ...maximum]],
  ["gpt-6-astra", maximum],
  ["gpt-6.1-sol", maximum],
]);

// Exact deployment IDs verified via the corporate gateway's /model/info.
// Used only for effort discovery when metadata for a deployment is missing.
const corporateProfiles = new Map([
  ["01 Top - Anthropic - Claude Fable 5.1", "claude-fable-5-1"],
  ["01 Top - Anthropic - Claude Opus 5.5", "claude-opus-5-5"],
  ["02 Coding - Anthropic - Claude Sonnet 5", "claude-sonnet-5"],
  ["01 Top - OpenAI - GPT-5.6 Sol", "gpt-5.6-sol"],
  ["01 Top - OpenAI - GPT-5.6 Terra", "gpt-5.6-terra"],
  ["01 Top - OpenAI - GPT-6 Astra", "gpt-6-astra"],
  ["01 Top - OpenAI - GPT-6 Sol", "gpt-6-sol"],
  ["01 Top - OpenAI - GPT-6.1 Sol", "gpt-6.1-sol"],
  ["02 Coding - OpenAI - GPT-5.3-Codex", "gpt-5.3-codex"],
  ["04 Fast - OpenAI - GPT-5.4 Mini", "gpt-5.4-mini"],
  ["04 Fast - OpenAI - GPT-5.6 Luna", "gpt-5.6-luna"],
  ["04 Fast - OpenAI - GPT-6 Luna", "gpt-6-luna"],
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function modelEfforts(baseUrl: string, id: string, model: string, info: Map<string, unknown[]>): ModelReasoningEffort[] {
  function profile(name: string) {
    const canonical = name.split("/").at(-1)!.toLowerCase();
    const modelId = canonical.startsWith("claude-") ? canonical.replaceAll(".", "-") : canonical;
    return modelProfiles.get(modelId) ?? [];
  }
  const confirmedModel = baseUrl === corporateBaseUrl && model === id ? corporateProfiles.get(id) : undefined;
  const deployments = info.get(model) ?? info.get(id);
  const supported = deployments ? levels.filter(level => deployments.every(deployment => {
    const row = record(deployment);
    const meta = record(row?.model_info);
    const upstream = record(row?.litellm_params)?.model;
    return typeof upstream === "string"
      && meta?.supports_reasoning !== false
      && meta?.["supports_" + level + "_reasoning_effort"] !== false
      && profile(upstream).includes(level);
  })) : profile(confirmedModel ?? model);
  if (!supported.length) return [];
  return [
    { reasoningEffort: defaultEffort, description: "Использовать уровень по умолчанию на шлюзе." },
    ...supported.map(level => ({ reasoningEffort: "effort-" + level, description: "Передать reasoning.effort = " + level + "." })),
  ];
}

export const effortLabels = [
  { id: defaultEffort, label: "Default" },
  ...levels.map(level => ({ id: "effort-" + level, label: level })),
];

export type ReasoningSelection = { model: string; effort?: Effort };

export function reasoningSelection(model: string, selected: unknown, supported: ModelReasoningEffort[]): ReasoningSelection | undefined {
  if (!supported.length) return;
  const effort = levels.find(level => selected === "effort-" + level);
  return { model, effort: supported.some(option => option.reasoningEffort === selected) ? effort : undefined };
}

export function applyReasoning(body: Buffer<ArrayBuffer>, path: string, selection: ReasoningSelection): Buffer<ArrayBuffer> {
  if (path !== "/v1/messages" && path !== "/v1/responses") return body;

  let payload: Record<string, unknown> | undefined;
  try { payload = record(JSON.parse(body.toString("utf8"))); } catch { return body; }
  if (payload?.model !== selection.model) return body;

  const reasoning = { ...record(payload.reasoning) };
  if (selection.effort === undefined) delete reasoning.effort;
  else reasoning.effort = selection.effort;
  if (Object.keys(reasoning).length) payload.reasoning = reasoning;
  else delete payload.reasoning;

  if (path === "/v1/messages") {
    const output = record(payload.output_config);
    if (output && "effort" in output) {
      delete output.effort;
      if (!Object.keys(output).length) delete payload.output_config;
    }
  }
  return Buffer.from(JSON.stringify(payload));
}
