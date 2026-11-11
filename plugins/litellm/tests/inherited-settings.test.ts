import { expect, it } from "vitest";
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";

function fixture() {
  const settings: Record<string, Record<string, boolean | string>> = {
    "provider-claude-code": { memoryEnabled: false, subagentsDisabled: true, workflowsDisabled: true,
      disable1MContext: true, chromeEnabled: true, artifactsEnabled: false, sandboxEnabled: false,
      fullAccessApprovalsEnabled: true, commandDescriptionsEnabled: true, apiKey: "test-secret-do-not-forward" },
    "provider-codex": { memoryEnabled: true, subagentsDisabled: false, extra: "unrelated" },
  };
  const calls: string[] = []; let unavailable = false;
  const host = createFakePluginHost({ pluginId: "litellm", sdk: { plugins: { getSettings: async ({ pluginId }) => {
    calls.push(pluginId); if (unavailable) throw new Error("source unavailable");
    return { ok: true as const, schema: {}, values: settings[pluginId]! };
  } } } });
  function options(id: string, plan = false) {
    const declaration = host.harness.registrations.providerRegistrations.find(p => p.id === id)!;
    return declaration.deriveProviderOptions!({ threadId: "t1", projectId: "p1", model: "corporate-model", permissionMode: "accept-edits", settings: {}, ...(plan ? { promptMode: "plan" as const } : {}) });
  }
  async function dispatch(providerId: string) {
    const context = makeMessageDispatchHookContext();
    return host.harness.registrations.hooks["message.dispatch"]!({ ...context, requestedExecution: { ...context.requestedExecution, providerId } });
  }
  return { ...host, settings, calls, options, dispatch, fail: () => { unavailable = true; } };
}
it("inherits independent native behavior settings, including disabling subagents, without copying secrets or gateway options", async () => {
  const f = fixture();
  try {
    await plugin(f.bb);
    expect(f.options("litellm-claude-code", true)).toEqual({ memoryEnabled: false, providerSubagentsEnabled: false,
      workflowsEnabled: false, disable1MContext: true, chromeEnabled: true, artifactsEnabled: false,
      sandboxEnabled: false, fullAccessApprovalsEnabled: true, commandDescriptionsEnabled: true, claudeCodePermissionMode: "plan" });
    expect(f.options("litellm-codex")).toEqual({ memoryEnabled: true, providerSubagentsEnabled: true });
    expect(f.options("litellm-claude-code")).not.toHaveProperty("claudeCodePermissionMode");
    const declarations = f.harness.registrations.providerRegistrations;
    expect(declarations.map(p => p.id)).toEqual(["litellm-claude-code", "litellm-codex"]);
    expect(declarations[0]!.experimental_bridgeOptions).toMatchObject({ engine: "claude-code", baseUrl: "https://llm.finstar-ai.cc" });
    expect(JSON.stringify(f.options("litellm-claude-code"))).not.toContain("test-secret");
  } finally { await f.harness.lifecycle.dispose(); }
});
it("rereads only the selected original provider before each corporate dispatch and leaves personal dispatches alone", async () => {
  const f = fixture();
  try {
    await plugin(f.bb); f.calls.length = 0;
    f.settings["provider-codex"] = { memoryEnabled: false, subagentsDisabled: true };
    expect(await f.dispatch("litellm-codex")).toEqual({ action: "proceed" });
    expect(f.calls).toEqual(["provider-codex"]);
    expect(f.options("litellm-codex")).toEqual({ memoryEnabled: false, providerSubagentsEnabled: false });
    expect(f.options("litellm-claude-code").sandboxEnabled).toBe(false);
    f.calls.length = 0;
    expect(await f.dispatch("codex")).toEqual({ action: "proceed" });
    expect(f.calls).toEqual([]);
  } finally { await f.harness.lifecycle.dispose(); }
});
it("rejects unavailable or malformed source settings rather than retaining stale permission or subagent settings", async () => {
  const f = fixture();
  try {
    await plugin(f.bb);
    f.settings["provider-codex"] = { subagentsDisabled: "false" };
    expect(await f.dispatch("litellm-codex")).toMatchObject({ action: "reject" });
    expect(() => f.options("litellm-codex")).toThrow("provider-codex");
    f.fail();
    expect(await f.dispatch("litellm-claude-code")).toMatchObject({ action: "reject" });
    expect(() => f.options("litellm-claude-code")).toThrow("provider-claude-code");
  } finally { await f.harness.lifecycle.dispose(); }
});
