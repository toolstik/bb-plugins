import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Engine } from "../src/config.js";
import type { ProviderBridgeEntry } from "@get-bb/plugin-sdk/provider-bridge";
export async function createBridgeFixture(engine: Engine, dir: string) {
  const keyFile = join(dir, "key.env");
  await writeFile(keyFile, "LITELLM_API_KEY=conformance-only-key\n", { mode: 0o600 });
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const options = { engine, keyFile, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, executable: "" };
  return { options,
    send(bridge: ProviderBridgeEntry, line: string) {
      let message: any;
      try { message = JSON.parse(line); } catch { bridge.handleLine(line); return; }
      if (message.params && typeof message.params === "object") {
        if (message.params.options) message.params.options.providerOptions = { ...message.params.options.providerOptions, ...options };
        else message.params.providerOptions = options;
      }
      bridge.handleLine(JSON.stringify(message));
    },
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
