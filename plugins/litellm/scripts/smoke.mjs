// Explicit live test. Never reads or prints the credential file itself.
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_providerBridge as bridge } from "../dist/host.js";

const [engine, keyFile, model, baseUrl = "https://llm.finstar-ai.cc", resumeId] = process.argv.slice(2);
if (!["codex", "claude-code"].includes(engine) || !keyFile || !model) {
  console.error("Usage: node scripts/smoke.mjs <codex|claude-code> <private-key-file> <model> [base-url]"); process.exit(2);
}
const dir = await mkdtemp(join(tmpdir(), "litellm-live-"));
const originalWrite = process.stdout.write.bind(process.stdout);
let buffer = "", nextId = 0;
const pending = new Map();
const events = [];
process.stdout.write = function(chunk, encoding, callback) {
  buffer += String(chunk);
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    try {
      const message = JSON.parse(line);
      if (pending.has(message.id)) {
        const waiter = pending.get(message.id); pending.delete(message.id);
        clearTimeout(waiter.timer);
        message.error ? waiter.reject(new Error(`${waiter.method}: ${message.error.message}`)) : waiter.resolve(message.result);
      } else events.push(message);
    } catch { /* Ignore non-protocol output; never print it. */ }
  }
  if (typeof encoding === "function") encoding(); else callback?.();
  return true;
};
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 90_000);
    pending.set(id, { resolve, reject, timer, method });
    bridge.handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}
const providerOptions = { engine, keyFile, baseUrl, defaultModel: model };
const options = { model, permissionMode: "full", permissionScope: "full", approvalReviewer: null, permissionEscalation: null,
  providerOptions, instructions: "This is a small connectivity test in an empty temporary directory. Follow the requested local file operation and stop." };
const threadId = `litellm-smoke-${engine}-${Date.now()}`;
let providerThreadId;
let exitCode = 0;
try {
  bridge.start?.({ pluginId: "litellm", dataDir: dir, tempDir: dir });
  await request("initialize", { protocolVersion: 3, client: { name: "litellm-smoke", version: "0.1.0" }, grammarVersions: [3, 3] });
  const catalog = await request("model/list", { providerOptions });
  if (!catalog.models.length) throw new Error("Empty catalog");
  const started = await request(resumeId ? "thread/resume" : "thread/start", { threadId, cwd: dir, options, instructionMode: "append", ...(resumeId ? { providerThreadId: resumeId } : {}) });
  providerThreadId = started.providerThreadId;
  await request("turn/start", { threadId, providerThreadId, clientRequestId: "creq_sm9ke23456", options,
    input: [{ type: "text", text: "Use your shell tool to run: printf LITELLM_SMOKE_OK > smoke-result.txt. Then read smoke-result.txt with a tool and reply with its exact contents. Do not do anything else.", mentions: [] }] });
  const deadline = Date.now() + 120_000;
  let completed = false;
  while (Date.now() < deadline) {
    const deltas = events.flatMap(event => event.params?.deltas ?? []);
    if (deltas.some(delta => delta.kind === "turn.boundary" && ["completed", "failed", "interrupted"].includes(delta.status))) {
      completed = true; break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!completed) throw new Error("No completed turn within 120 seconds");
  const content = await readFile(join(dir, "smoke-result.txt"), "utf8").catch(() => "");
  const deltas = events.flatMap(event => event.params?.deltas ?? []);
  const boundaries = deltas.filter(delta => delta.kind === "turn.boundary");
  const status = boundaries.at(-1)?.status;
  const report = { engine, model, catalogModels: catalog.models.length, providerThreadId, turnStatus: status,
    fileWritten: content === "LITELLM_SMOKE_OK", markerInOutput: JSON.stringify(events).includes("LITELLM_SMOKE_OK"),
    toolEvents: deltas.filter(delta => delta.kind === "item.open" && ["tool", "command", "fileRead", "fileChange"].includes(delta.item?.type)).length,
    resumed: Boolean(resumeId),
    errors: events.filter(event => /error/.test(event.method ?? "")).map(event => String(event.params?.message ?? "Provider error").slice(0, 500)) };
  if (!report.fileWritten || status !== "completed") exitCode = 1;
  originalWrite(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  originalWrite(JSON.stringify({ engine, model, error: error.message }) + "\n"); exitCode = 1;
} finally {
  if (providerThreadId) await request("thread/stop", { threadId, providerThreadId, intent: "release", activeTurnId: null }).catch(() => {});
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
  await rm(dir, { recursive: true, force: true });
  await bridge.dispose();
  process.exitCode = exitCode;
}
