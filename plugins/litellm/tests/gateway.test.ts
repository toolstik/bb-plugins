import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayProxy } from "../src/proxy.js";
import { parseOptions, normalizedBaseUrl } from "../src/config.js";
import { parseCredentialFile, readCredential } from "../src/credentials.js";
import { CatalogClient, parseCatalog } from "../src/catalog.js";
import { corporateCodexConfig, corporateCodexLaunch, corporateClaudeEnv, setGatewayProxy } from "../src/runtime.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(handler: Parameters<typeof createServer>[0]) {
  const dir = await mkdtemp(join(tmpdir(), "litellm-test-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const keyFile = join(dir, "credentials.env");
  await writeFile(keyFile, 'LITELLM_API_KEY="test-corporate-secret"\n', { mode: 0o600 });
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address() as { port: number };
  const options = parseOptions({ engine: "codex", keyFile, baseUrl: `http://127.0.0.1:${address.port}` });
  return { options, keyFile, dir, server };
}
describe("corporate gateway", () => {
  it("normalizes v1 and rejects insecure or credential-bearing upstream URLs", () => {
    expect(normalizedBaseUrl("https://llm.example/v1/")).toBe("https://llm.example");
    for (const url of ["http://example.com", "https://key@example.com", "https://example.com/?key=x"]) expect(() => normalizedBaseUrl(url)).toThrow();
  });
  it("requires a private credential file and rejects duplicate assignments without echoing values", async () => {
    expect(() => parseCredentialFile("LITELLM_API_KEY=secret\nLITELLM_API_KEY=other")).toThrow("exactly one");
    const { keyFile } = await fixture((_req, res) => res.end());
    expect(await readCredential(keyFile)).toBe("test-corporate-secret");
    await chmod(keyFile, 0o644);
    await expect(readCredential(keyFile)).rejects.toThrow("private");
  });
  it("uses the key for discovery, caches, refreshes after rotation and never calls health", async () => {
    const calls: string[] = [], auth: unknown[] = [];
    const { options, keyFile } = await fixture((req, res) => {
      calls.push(req.url!); auth.push(req.headers.authorization);
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ id: "model-a" }, { id: "EmbeddingGemma" }] }));
    });
    const client = new CatalogClient();
    expect((await client.list(options)).models.map(x => x.id)).toEqual(["model-a"]);
    await client.list(options); expect(calls).toEqual(["/v1/models"]);
    await writeFile(keyFile, "LITELLM_API_KEY=rotated-secret\n"); await client.list(options);
    expect(auth).toEqual(["Bearer test-corporate-secret", "Bearer rotated-secret"]);
  });
  it("keeps display names, maps explicit aliases, filters non-chat models and scopes defaults", () => {
    const options = parseOptions({ engine: "codex", keyFile: "/tmp/key", modelAliases: { "Corporate GPT": "gpt-canonical" }, modelAllowlist: ["Corporate GPT"], defaultModel: "gpt-canonical" });
    const result = parseCatalog({ data: [{ id: "Corporate GPT" }, { id: "other" }, { id: "embed" }] }, options);
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({ id: "gpt-canonical", displayName: "Corporate GPT", isDefault: true, supportedReasoningEfforts: [] });
  });
  it("rejects unauthenticated proxy access and streams both API formats with replaced auth", async () => {
    const requests: { url: string; auth: unknown; key: unknown; body: string }[] = [];
    const { options } = await fixture(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      requests.push({ url: req.url!, auth: req.headers.authorization, key: req.headers["x-api-key"], body });
      res.setHeader("content-type", "text/event-stream");
      res.write('data: {"delta":"hello"}\n\n');
      setTimeout(() => res.end('data: [DONE]\n\n'), 10);
    });
    const proxy = new GatewayProxy(options); await proxy.start(); cleanup.push(() => proxy.close());
    expect((await fetch(`${proxy.baseUrl}/v1/models`)).status).toBe(401);
    for (const path of ["/v1/messages", "/v1/responses"]) {
      const response = await fetch(proxy.baseUrl + path, { method: "POST", headers: { authorization: `Bearer ${proxy.token}` }, body: '{"model":"selected","stream":true}' });
      expect(response.status).toBe(200); expect(await response.text()).toContain("hello");
    }
    expect(requests.map(x => x.url)).toEqual(["/v1/messages", "/v1/responses"]);
    expect(requests.every(x => x.auth === "Bearer test-corporate-secret" && x.key === "test-corporate-secret" && x.body.includes("selected"))).toBe(true);
    setGatewayProxy(proxy);
    expect(JSON.stringify(corporateCodexConfig()) + JSON.stringify(corporateCodexLaunch({})) + JSON.stringify(corporateClaudeEnv("selected"))).not.toContain("test-corporate-secret");
    expect(corporateCodexConfig()["model_providers.corporate-litellm.requires_openai_auth"]).toBe(false);
    expect(corporateClaudeEnv("selected").ANTHROPIC_API_KEY).toBe("");
  });
  it("rejects arbitrary paths, sanitizes upstream errors, and fails closed after removing the key", async () => {
    const { options, keyFile } = await fixture((_req, res) => res.writeHead(429).end("test-corporate-secret echoed"));
    const proxy = new GatewayProxy(options); await proxy.start(); cleanup.push(() => proxy.close());
    const headers = { authorization: `Bearer ${proxy.token}` };
    expect((await fetch(`${proxy.baseUrl}/health`, { headers })).status).toBe(404);
    const error = await fetch(`${proxy.baseUrl}/v1/models`, { headers });
    expect(error.status).toBe(429); expect(await error.text()).not.toContain("test-corporate-secret");
    await rm(keyFile);
    expect((await fetch(`${proxy.baseUrl}/v1/models`, { headers })).status).toBe(502);
  });
});
