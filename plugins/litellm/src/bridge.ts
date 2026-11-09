import {
  experimental_defineProviderBridge, initializeParamsSchema, modelListParamsSchema,
  PROVIDER_BRIDGE_PROTOCOL_VERSION, THREAD_DELTA_GRAMMAR_V3,
  experimental_readCliVersion, experimental_resolveExecutablePath,
  threadStartParamsSchema, threadResumeParamsSchema, threadForkParamsSchema,
  turnStartParamsSchema, turnSteerParamsSchema, threadStopParamsSchema, threadDiscardParamsSchema,
  skillsConfigureParamsSchema,
  type ProviderBridgeContext, type ProviderBridgeEntry,
} from "@get-bb/plugin-sdk/provider-bridge";
import { parseOptions, type GatewayOptions } from "./config.js";
import { CatalogClient } from "./catalog.js";
import { GatewayProxy } from "./proxy.js";
import { setGatewayProxy } from "./runtime.js";

function result(id: unknown, value: unknown) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: value }) + "\n"); }
function error(id: unknown, code: number, message: string) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"); }
const known = new Set(["model/list", "provider/health", "commands/list", "skills/configure", "thread/start", "thread/resume", "thread/fork", "turn/start", "turn/steer", "thread/stop", "thread/discard", "thread/name/set", "thread/archive", "thread/unarchive", "thread/goal/clear"]);

export function createCorporateBridge(): ProviderBridgeEntry & { dispose(): Promise<void> } {
  let context: ProviderBridgeContext | undefined;
  let delegate: ProviderBridgeEntry | undefined;
  let configured: GatewayOptions | undefined;
  let gateway: GatewayProxy | undefined;
  let initializing: Promise<void> | undefined;
  let skills: unknown;
  let closeDelegate: (() => void | Promise<void>) | undefined;
  const catalog = new CatalogClient();
  async function configure(raw: unknown): Promise<GatewayOptions> {
    const options = parseOptions(raw);
    if (configured && JSON.stringify(configured) !== JSON.stringify(options)) throw new Error("Corporate bridge configuration changed. Reopen this session.");
    configured = options;
    return options;
  }
  async function ensureDelegate(options: GatewayOptions): Promise<void> {
    if (delegate) return;
    if (initializing) return initializing;
    initializing = (async () => {
      gateway = new GatewayProxy(options);
      await gateway.start();
      setGatewayProxy(gateway);
      const module = options.engine === "codex"
        ? await import("../vendor/codex/bridge/bridge.js")
        : await import("../vendor/claude-code/bridge/bridge.js");
      delegate = module.experimental_providerBridge;
      closeDelegate = module.experimental_closeForLiteLLM;
      if (context) delegate.start?.(context);
      if (skills) module.experimental_applySkillsForLiteLLM(skills as any);
    })().catch(async err => { await gateway?.close(); gateway = undefined; throw err; }).finally(() => { initializing = undefined; });
    return initializing;
  }
  async function handle(parsed: Record<string, any>): Promise<void> {
    const { id, method } = parsed;
    if (method === "initialize") {
      if (!initializeParamsSchema.safeParse(parsed.params).success) { error(id, -32602, "Invalid initialize params"); return; }
      result(id, { protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION, capabilities: {
        sessionRestore: true, threadArchive: false, threadRename: false, threadGoalClear: false, fork: "checkpoint",
        approvalEnforcedBy: "provider", grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        steerMode: "inject", skills: { configure: true }, commands: { list: false },
      } });
      return;
    }
    if (!known.has(method)) { error(id, -32601, "Unknown method"); return; }
    if (!parsed.params || typeof parsed.params !== "object" || Array.isArray(parsed.params)) { error(id, -32602, "Invalid params"); return; }
    const schemas: Record<string, { safeParse(value: unknown): { success: boolean } }> = {
      "thread/start": threadStartParamsSchema, "thread/resume": threadResumeParamsSchema,
      "thread/fork": threadForkParamsSchema, "turn/start": turnStartParamsSchema,
      "turn/steer": turnSteerParamsSchema, "thread/stop": threadStopParamsSchema,
      "thread/discard": threadDiscardParamsSchema,
    };
    if (schemas[method] && !schemas[method]!.safeParse(parsed.params).success) { error(id, -32602, "Invalid params"); return; }
    if (method === "skills/configure" && !delegate) {
      if (!skillsConfigureParamsSchema.safeParse(parsed.params).success) { error(id, -32602, "Invalid skills/configure params"); return; }
      skills = parsed.params;
      result(id, { ok: true }); return;
    }
    if (method === "commands/list") { error(id, -32601, "commands/list is not supported by this provider."); return; }
    const params = parsed.params;
    const raw = params.options?.providerOptions ?? params.providerOptions;
    const options = raw ? await configure(raw) : configured;
    if (!options) { error(id, -32602, "Corporate LiteLLM provider options are required."); return; }
    if (method === "model/list") {
      if (!modelListParamsSchema.safeParse(params).success) { error(id, -32602, "Invalid model/list params"); return; }
      result(id, await catalog.list(options)); return;
    }
    if (method === "provider/health") {
      const command = options.executable || (options.engine === "codex" ? "codex" : "claude");
      const executable = await experimental_resolveExecutablePath(command);
      let status = executable ? "ready" : "not_installed";
      let message = executable ? "Corporate LiteLLM is ready." : `Install ${command} on this execution host.`;
      if (executable) {
        try { await catalog.list(options); } catch (err) { status = "unauthenticated"; message = err instanceof Error ? err.message : "Corporate LiteLLM is unavailable."; }
      }
      result(id, { supported: true, health: { status, statusMessage: message, accountEmail: null, planLabel: "Corporate LiteLLM",
        installedVersion: executable ? await experimental_readCliVersion(command) : null, minimumSupportedVersion: null,
        canInstall: false, canUpdate: false, loginCommand: null, localLoginCommand: null } }); return;
    }
    // Never let a missing key or empty catalog fall through to a personal login.
    if (["thread/start", "thread/resume", "thread/fork", "turn/start", "turn/steer"].includes(method)) {
      const list = await catalog.list(options);
      if (params.options) {
        params.options.model ||= list.models.find(model => model.isDefault)!.model;
        params.options.model = options.modelAliases[params.options.model] ?? params.options.model;
        if (options.modelAllowlist.length && !list.models.some(model => model.model === params.options.model)) throw new Error("Selected model is outside the corporate model allowlist.");
        delete params.options.reasoningLevel; delete params.options.serviceTier;
      }
    }
    await ensureDelegate(options);
    delegate!.handleLine(JSON.stringify(parsed));
  }
  function handleLine(line: string): void {
    let parsed: any;
    try { parsed = JSON.parse(line); } catch { return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    if (!('method' in parsed)) { delegate?.handleLine(line); return; }
    if (typeof parsed.method !== "string" || !["string", "number"].includes(typeof parsed.id)) return;
    void handle(parsed).catch(err => {
      // Only our own bounded errors are returned; vendor errors are handled by the vendor bridge.
      error(parsed.id, -32000, err instanceof Error ? err.message.slice(0, 600) : "Corporate LiteLLM bridge failed.");
    });
  }
  function shutdown(hook: "onClose" | "onSigterm" | "onSigint") {
    void gateway?.close(); delegate?.[hook]?.();
  }
  return Object.assign(experimental_defineProviderBridge({ handleLine, start: value => { context = value; },
    onClose: () => shutdown("onClose"), onSigterm: () => shutdown("onSigterm"), onSigint: () => shutdown("onSigint") }), {
      dispose: async () => { await closeDelegate?.(); await gateway?.close(); },
    });
}
export const experimental_providerBridge = createCorporateBridge();
