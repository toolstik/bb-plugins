import { InheritedSettings } from "./src/inherited-settings.js";
import { usageHostContract, usageSourceRpcContract } from "./usage-contract.js";
import { credentialHostContract, credentialRpcContract } from "./credential-contract.js";
import type { BbPluginApi, PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { normalizedBaseUrl } from "./src/config.js";
import { codexExtensionKinds } from "./vendor/codex/extension-kinds.js";

const jsonObject = z.string().refine(value => {
  try { return z.record(z.string(), z.string().min(1)).safeParse(JSON.parse(value)).success; } catch { return false; }
}, "Enter a JSON object mapping catalog names to canonical model IDs.");
const jsonList = z.string().refine(value => {
  try { return z.array(z.string().min(1)).safeParse(JSON.parse(value)).success; } catch { return false; }
}, "Enter a JSON array of model names, or [] for all chat models.");

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    baseUrl: { type: "string", label: "LiteLLM URL", default: "https://llm.finstar-ai.cc", experimental_schema: z.string().refine(value => { try { normalizedBaseUrl(value); return true; } catch { return false; } }, "Use HTTPS without credentials or query parameters.") },
    keyFile: { type: "string", label: "Private credential file on each execution host", description: "Absolute path or ~/. The file must contain LITELLM_API_KEY and have mode 600. Never paste the key here.", default: "~/.config/bb-litellm/credentials.env" },
    claudeExecutable: { type: "string", label: "Claude Code executable (empty: installed claude)", default: "" },
    codexExecutable: { type: "string", label: "Codex executable (empty: installed codex)", default: "" },
    claudeDefaultModel: { type: "string", label: "Claude Code default model (empty: first catalog model)", default: "" },
    codexDefaultModel: { type: "string", label: "Codex default model (empty: first catalog model)", default: "" },
    modelAliases: { type: "string", label: "Catalog name to canonical ID mapping (JSON)", default: "{}", experimental_multiline: true, experimental_schema: jsonObject },
    claudeModels: { type: "string", label: "Claude Code model allowlist (JSON)", default: "[]", experimental_multiline: true, experimental_schema: jsonList },
    codexModels: { type: "string", label: "Codex model allowlist (JSON)", default: "[]", experimental_multiline: true, experimental_schema: jsonList },
  });
  const host = bb.hosts.experimental_client({ contract: credentialHostContract });
  bb.rpc.register(credentialRpcContract, {
    credentialTargets: async () => ({ hosts: (await bb.sdk.hosts.list()).map(item => ({ id: item.id, name: item.name, connected: item.status === "connected" })) }),
    credentialStatus: async ({ hostId }, context) => host.call("credentialStatus", { path: (await settings.get()).keyFile }, { hostId, signal: context.experimental_signal }),
    saveCredential: async ({ hostId, apiKey }, context) => {
      const result = await host.call("saveCredential", { path: (await settings.get()).keyFile, apiKey }, { hostId, signal: context.experimental_signal });
      return result;
    },
  }, { experimental_discoverable: false });
  const budgetHost = bb.hosts.experimental_client({ contract: usageHostContract });
  async function usageResources() {
    return (await bb.sdk.hosts.list()).filter(host => host.status === "connected").flatMap(host =>
      ["litellm-claude-code", "litellm-codex"].map(providerId => ({
        id: `${host.id}:${providerId}`, providerId, accountKey: null, label: "LiteLLM",
        scope: { kind: "host" as const, hostId: host.id, hostName: host.name },
      })));
  }
  bb.rpc.register(usageSourceRpcContract, {
    "provider-usage.v1.listResources": async () => ({ resources: await usageResources() }),
    "provider-usage.v1.getResource": async ({ resourceId, refresh }, context) => {
      const resource = (await usageResources()).find(item => item.id === resourceId);
      if (!resource) throw new Error("LiteLLM usage resource is no longer available. Relist resources.");
      const values = await settings.get();
      return budgetHost.call("budgetUsage", { baseUrl: values.baseUrl, keyFile: values.keyFile, refresh },
        { hostId: resource.scope.hostId, signal: context.experimental_signal });
    },
  }, { experimental_discoverable: true });
  const inherited = new InheritedSettings(bb.sdk);
  // Catalog and credential settings stay available even if an original provider is disabled.
  const engines = ["claude-code", "codex"] as const;
  const initialInheritance = await Promise.allSettled(engines.map(engine => inherited.refresh(engine)));
  initialInheritance.forEach((result, index) => {
    const source = `provider-${engines[index]}`;
    if (result.status === "fulfilled") bb.log.info(`Behavior settings inherited from ${source}.`);
    else bb.log.warn(`Behavior settings from ${source} are unavailable; corporate messages will retry reading them before dispatch.`);
  });
  bb.experimental_hooks.on("message.dispatch", async context => {
    const providerId = context.requestedExecution.providerId;
    const engine = providerId === "litellm-claude-code" ? "claude-code" : providerId === "litellm-codex" ? "codex" : null;
    if (!engine) return { action: "proceed" };
    try { await inherited.refresh(engine); return { action: "proceed" }; }
    catch { return { action: "reject", message: `LiteLLM: cannot read settings from provider-${engine}. Enable the original provider and retry.` }; }
  });
  let registrations: { dispose(): void }[] = [];
  function register(values: Awaited<ReturnType<typeof settings.get>>) {
    for (const item of registrations) item.dispose();
    registrations = [];
    for (const engine of ["claude-code", "codex"] as const) {
      const isClaude = engine === "claude-code";
      const declaration: PluginProviderDeclaration = {
        id: `litellm-${engine}`, displayName: `LiteLLM / ${isClaude ? "Claude Code" : "Codex"}`,
        family: "litellm", icon: isClaude ? "./icons/claude-litellm.svg" : "./icons/codex-litellm.svg", experimental_visibility: "always",
        experimental_bridgeOptions: { engine, baseUrl: normalizedBaseUrl(values.baseUrl), keyFile: values.keyFile,
          executable: isClaude ? values.claudeExecutable : values.codexExecutable,
          defaultModel: isClaude ? values.claudeDefaultModel : values.codexDefaultModel,
          modelAliases: JSON.parse(values.modelAliases), modelAllowlist: JSON.parse(isClaude ? values.claudeModels : values.codexModels) },
        maintenance: { health: true, usage: false, installation: false },
        capabilities: { supportsServiceTier: false, supportsNativeUserQuestion: isClaude, fork: "checkpoint",
          supportsManualCompaction: true, supportsThreadArchive: false, supportsThreadRename: false,
          permissionModes: ["accept-edits", "auto", "full"], reasoningLevels: ["medium"] },
        composerActions: ["plan"], models: { scope: "host" },
        strings: { signInHint: "Set the private LiteLLM credential file in plugin settings.", expiredHint: "Renew the LiteLLM virtual key in the private credential file.", installUrl: isClaude ? "https://claude.com/claude-code" : "https://developers.openai.com/codex/cli" },
        ...(isClaude ? { completedTurnDisplay: "flat" as const } : { extensionKinds: codexExtensionKinds }),
        env: { passthrough: ["BB_CLAUDE_CODE_EXECUTABLE"] },
        deriveProviderOptions: context => inherited.options(engine, context.promptMode),
      };
      registrations.push(bb.providers.register(declaration));
    }
  }
  register(await settings.get());
  settings.onChange(next => register(next));
}
