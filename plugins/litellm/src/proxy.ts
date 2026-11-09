import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { GatewayOptions } from "./config.js";
import { readCredential } from "./credentials.js";

const allowed = new Set(["/v1/messages", "/v1/messages/count_tokens", "/v1/responses", "/v1/responses/compact", "/v1/chat/completions", "/v1/models"]);
export class GatewayProxy {
  readonly token = randomBytes(32).toString("hex");
  private server: Server | undefined;
  private controllers = new Set<AbortController>();
  baseUrl = "";
  constructor(readonly options: GatewayOptions) {}
  async start(): Promise<void> {
    await readCredential(this.options.keyFile);
    this.server = createServer(async (req, res) => {
      const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? String(req.headers["x-api-key"] ?? "");
      const a = Buffer.from(supplied), b = Buffer.from(this.token);
      if (a.length !== b.length || !timingSafeEqual(a, b)) { res.writeHead(401).end(); return; }
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!allowed.has(url.pathname) || !["GET", "POST"].includes(req.method ?? "")) { res.writeHead(404).end(); return; }
      if ((url.pathname === "/v1/models") !== (req.method === "GET")) { res.writeHead(405).end(); return; }
      const controller = new AbortController();
      this.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 15 * 60_000);
      res.on("close", () => { if (!res.writableFinished) controller.abort(); });
      req.on("aborted", () => controller.abort());
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) { res.writeHead(413).end(); return; }
          chunks.push(Buffer.from(chunk));
        }
        const key = await readCredential(this.options.keyFile);
        const headers = new Headers({ authorization: `Bearer ${key}`, "x-api-key": key, "content-type": "application/json" });
        for (const name of ["anthropic-version", "anthropic-beta", "accept", "openai-beta"]) {
          const value = req.headers[name];
          if (typeof value === "string") headers.set(name, value);
        }
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const upstream = await fetch(`${this.options.baseUrl}${url.pathname}${url.search}`, {
          method: req.method, headers, body, signal: controller.signal, redirect: "error",
        });
        // Never relay arbitrary upstream error text: some gateways echo credentials.
        if (!upstream.ok) {
          await upstream.body?.cancel();
          res.writeHead(upstream.status, { "content-type": "application/json" }).end(JSON.stringify({ error: { type: "gateway_error", message: `Corporate LiteLLM returned HTTP ${upstream.status}.` } }));
          return;
        }
        const out: Record<string, string> = { "cache-control": "no-store" };
        for (const name of ["content-type", "retry-after", "request-id", "x-request-id"]) {
          const value = upstream.headers.get(name); if (value) out[name] = value;
        }
        res.writeHead(upstream.status, out);
        res.flushHeaders();
        if (upstream.body) await pipeline(Readable.fromWeb(upstream.body as never), res);
        else res.end();
      } catch {
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Corporate LiteLLM connection failed. Check credentials, network and TLS." } }));
        else res.destroy();
      } finally { clearTimeout(timer); this.controllers.delete(controller); }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => { this.server!.removeListener("error", reject); resolve(); });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Cannot open LiteLLM loopback proxy.");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }
  async close(): Promise<void> {
    for (const controller of this.controllers) controller.abort();
    this.server?.closeAllConnections();
    await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve());
    this.server = undefined;
  }
}
