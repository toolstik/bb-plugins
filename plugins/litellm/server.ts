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
  let registrations: { dispose(): void }[] = [];
  function register(values: Awaited<ReturnType<typeof settings.get>>) {
    for (const item of registrations) item.dispose();
    registrations = [];
    for (const engine of ["claude-code", "codex"] as const) {
      const isClaude = engine === "claude-code";
      const declaration: PluginProviderDeclaration = {
        id: `litellm-${engine}`, displayName: `LiteLLM / ${isClaude ? "Claude Code" : "Codex"}`,
        family: "litellm", icon: "Network", experimental_visibility: "always",
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
        deriveProviderOptions: context => ({ memoryEnabled: false, providerSubagentsEnabled: true, sandboxEnabled: true,
          ...(isClaude && context.promptMode === "plan" ? { claudeCodePermissionMode: "plan" } : {}) }),
      };
      registrations.push(bb.providers.register(declaration));
    }
  }
  register(await settings.get());
  settings.onChange(next => register(next));
}
