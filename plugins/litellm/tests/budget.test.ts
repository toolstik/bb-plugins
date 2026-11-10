import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetUsage, budgetWindow } from "../src/budget.js";
import { createFakePluginHost, makeHostResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "litellm-budget-")); dirs.push(dir);
  const keyFile = join(dir, "key.env");
  const key = `test-key-${dir.split("/").pop()}`;
  await writeFile(keyFile, `LITELLM_API_KEY=${key}\n`, { mode: 0o600 });
  return { key, input: { baseUrl: "https://gateway.example", keyFile, refresh: false } };
}
it("uses the actual user budget when the key is uncapped; caches both engines and authenticates without URL secrets", async () => {
  const { key, input } = await setup();
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).not.toContain(key); expect(url).not.toContain("?");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${key}`);
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("bb-litellm/");
    return Response.json(url.endsWith("/key/info") ? { key, info: { spend: 0.185, max_budget: null } }
      : { user_info: { spend: 0.185, max_budget: 30, budget_reset_at: "2026-12-01T00:00:00Z" }, keys: [{ token: key }] });
  });
  vi.stubGlobal("fetch", fetch);
  const result = await budgetUsage(input);
  expect(result.usage.status).toBe("ok");
  if (result.usage.status !== "ok") throw new Error("expected successful usage");
  expect(result.usage.windows).toHaveLength(1);
  expect(result.usage.windows[0]?.cost).toEqual({ usedUsdCents: 18.5, limitUsdCents: 3000 });
  expect(result.usage.windows[0]?.usedPercent).toBeCloseTo(0.6166667);
  expect(JSON.stringify(result)).not.toContain(key);
  expect(await budgetUsage(input)).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(2);
  await writeFile(input.keyFile, "LITELLM_API_KEY=rotated-test-key\n", { mode: 0o600 });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ info: { spend: 1, max_budget: 10 } })));
  const rotated = await budgetUsage(input);
  expect(rotated).not.toEqual(result);
});
it("keeps independent key and user budgets without summing them, and allows overage", () => {
  expect(budgetWindow({ spend: 25, max_budget: 20, budget_reset_at: "bad-date" }, "key"))
    .toMatchObject({ usedPercent: 125, resetsAt: null, cost: { usedUsdCents: 2500, limitUsdCents: 2000 } });
  for (const value of [{ spend: 1, max_budget: null }, { spend: 1, max_budget: 0 }, { spend: -1, max_budget: 20 }, { spend: "1", max_budget: 20 }])
    expect(budgetWindow(value, "user")).toBeNull();
});
it("can show the key budget when user info is forbidden, and never returns upstream error text or a guessed default", async () => {
  const { key, input } = await setup();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/key/info")
    ? Response.json({ info: { spend: 2, max_budget: 10 } }) : new Response(key, { status: 403 })));
  const result = await budgetUsage(input);
  expect(result.usage.status).toBe("ok");
  const other = await setup();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(key, { status: 403 })));
  const denied = await budgetUsage(other.input);
  expect(denied.usage.status).toBe("error");
  expect(JSON.stringify(denied)).not.toContain(key);
  const uncapped = await setup();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ info: { spend: 2, max_budget: null }, user_info: { spend: 2, max_budget: null } })));
  const missing = await budgetUsage(uncapped.input);
  expect(missing.usage.status).toBe("error");
});
it("publishes both provider resources and fetches budget only for the requested execution host", async () => {
  const host = createFakePluginHost({ pluginId: "litellm", sdk: { hosts: { list: async () => [makeHostResponse({ id: "host-test", name: "Test machine", status: "connected" })] } },
    experimental_callHostRpc: async ({ method, hostId }) => {
      expect(method).toBe("budgetUsage"); expect(hostId).toBe("host-test");
      return { accountKey: null, observedAt: 123, usage: { status: "ok", accountEmail: null, plan: null, planLabel: "LiteLLM", windows: [budgetWindow({ spend: 2, max_budget: 30 }, "user")] } };
    } });
  try {
    await plugin(host.bb);
    const list = await host.harness.behavior.callRpc("provider-usage.v1.listResources", {}) as { resources: { id: string; providerId: string }[] };
    expect(list.resources.map(r => r.providerId)).toEqual(["litellm-claude-code", "litellm-codex"]);
    expect(host.harness.experimental_hostRpcCalls).toHaveLength(0);
    const value = await host.harness.behavior.callRpc("provider-usage.v1.getResource", { resourceId: list.resources[1]!.id, refresh: false });
    expect(value).toMatchObject({ observedAt: 123, usage: { status: "ok" } });
    await expect(host.harness.behavior.callRpc("provider-usage.v1.getResource", { resourceId: "missing", refresh: false })).rejects.toThrow();
  } finally { await host.harness.lifecycle.dispose(); }
});
