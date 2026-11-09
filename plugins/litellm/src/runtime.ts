import type { GatewayProxy } from "./proxy.js";
let proxy: GatewayProxy | undefined;
export function setGatewayProxy(value: GatewayProxy): void { proxy = value; }
function active(): GatewayProxy {
  if (!proxy?.baseUrl) throw new Error("Corporate LiteLLM is not configured. Personal login fallback is disabled.");
  return proxy;
}
export function corporateClaudeEnv(model?: string): Record<string, string> {
  const gateway = active();
  return {
    ANTHROPIC_BASE_URL: gateway.baseUrl, ANTHROPIC_AUTH_TOKEN: gateway.token, ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_OAUTH_TOKEN: "", CLAUDE_CODE_USE_BEDROCK: "0", CLAUDE_CODE_USE_VERTEX: "0", CLAUDE_CODE_USE_FOUNDRY: "0",
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ...(model ? { ANTHROPIC_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model, ANTHROPIC_SMALL_FAST_MODEL: model } : {}),
  };
}
export function corporateCodexEnv(): Record<string, string> {
  return { LITELLM_BRIDGE_TOKEN: active().token, OPENAI_API_KEY: "", OPENAI_BASE_URL: `${active().baseUrl}/v1` };
}
export function corporateCodexConfig(): Record<string, string | boolean> {
  return {
    model_provider: "corporate-litellm", "model_providers.corporate-litellm.name": "Corporate LiteLLM",
    "model_providers.corporate-litellm.base_url": `${active().baseUrl}/v1`,
    "model_providers.corporate-litellm.env_key": "LITELLM_BRIDGE_TOKEN",
    "model_providers.corporate-litellm.wire_api": "responses",
    "model_providers.corporate-litellm.requires_openai_auth": false,
    "model_providers.corporate-litellm.supports_websockets": false,
  };
}
export function corporateCodexLaunch(env: NodeJS.ProcessEnv): { command: string; args: string[] } {
  const gateway = active();
  const args = ["app-server"];
  for (const [name, value] of Object.entries(corporateCodexConfig())) args.push("-c", `${name}=${JSON.stringify(value)}`);
  return { command: gateway.options.executable || env.CODEX_APP_SERVER_COMMAND || "codex", args };
}
export function corporateClaudeExecutable(): string | undefined { return active().options.executable || undefined; }
