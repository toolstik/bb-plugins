import type { BbPluginApi, JsonValue } from "@get-bb/plugin-sdk";
import type { Engine } from "./config.js";

const common = { memoryEnabled: true, subagentsDisabled: false };
const defaults = {
  "claude-code": { ...common, workflowsDisabled: false, disable1MContext: false, chromeEnabled: false,
    artifactsEnabled: false, sandboxEnabled: true, fullAccessApprovalsEnabled: false, commandDescriptionsEnabled: false },
  codex: common,
};

/** Keep the synchronous provider-options callback backed by a fresh, allowlisted snapshot. */
export class InheritedSettings {
  private values = new Map<Engine, Record<string, boolean>>();
  constructor(private readonly sdk: BbPluginApi["sdk"]) {}

  async refresh(engine: Engine): Promise<void> {
    try {
      const source = await this.sdk.plugins.getSettings({ pluginId: `provider-${engine}` });
      const values: Record<string, boolean> = {};
      for (const [key, fallback] of Object.entries(defaults[engine])) {
        const descriptor = source.schema[key];
        // Never forward credentials, unrelated fields, or unvalidated settings.
        if (descriptor && descriptor.type !== "boolean") throw new Error("Incompatible setting type.");
        const value = source.values[key] !== undefined ? source.values[key]
          : (descriptor?.type === "boolean" ? descriptor.default : undefined) ?? fallback;
        if (typeof value !== "boolean") throw new Error("Invalid boolean setting.");
        values[key] = value;
      }
      this.values.set(engine, values);
    } catch {
      this.values.delete(engine);
      throw new Error(`Cannot inherit settings from provider-${engine}. Enable the original provider and retry.`);
    }
  }

  options(engine: Engine, promptMode?: "plan"): Record<string, JsonValue> {
    const value = this.values.get(engine);
    if (!value) throw new Error(`Settings from provider-${engine} are unavailable. Enable the original provider and retry.`);
    const options: Record<string, JsonValue> = {
      memoryEnabled: value.memoryEnabled!, providerSubagentsEnabled: !value.subagentsDisabled,
    };
    if (engine === "claude-code") Object.assign(options, {
      workflowsEnabled: !value.workflowsDisabled, disable1MContext: value.disable1MContext,
      chromeEnabled: value.chromeEnabled, artifactsEnabled: value.artifactsEnabled,
      sandboxEnabled: value.sandboxEnabled, fullAccessApprovalsEnabled: value.fullAccessApprovalsEnabled,
      commandDescriptionsEnabled: value.commandDescriptionsEnabled,
      ...(promptMode === "plan" ? { claudeCodePermissionMode: "plan" } : {}),
    });
    return options;
  }
}
