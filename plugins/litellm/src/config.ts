import { z } from "zod";
import { homedir } from "node:os";
import { resolve, isAbsolute } from "node:path";

export const engineSchema = z.enum(["claude-code", "codex"]);
export type Engine = z.infer<typeof engineSchema>;
export const gatewayOptionsSchema = z.object({
  engine: engineSchema,
  baseUrl: z.string().url().default("https://llm.finstar-ai.cc"),
  keyFile: z.string().min(1),
  executable: z.string().default(""),
  modelAliases: z.record(z.string(), z.string().min(1)).default({}),
  modelAllowlist: z.array(z.string().min(1)).default([]),
  defaultModel: z.string().default(""),
});
export type GatewayOptions = z.infer<typeof gatewayOptionsSchema>;

export function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("LiteLLM URL must use HTTPS (HTTP is allowed only on loopback).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("LiteLLM URL must not contain credentials, a query, or a fragment.");
  }
  return url.href.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export function keyFilePath(value: string): string {
  const path = value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : value;
  if (!isAbsolute(path)) throw new Error("Credential file must be an absolute path or start with ~/.");
  return path;
}

export function parseOptions(value: unknown): GatewayOptions {
  const options = gatewayOptionsSchema.parse(value);
  return { ...options, baseUrl: normalizedBaseUrl(options.baseUrl), keyFile: keyFilePath(options.keyFile) };
}
