import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  experimental_captureBridgeJsonRpcOutput as captureBridgeJsonRpcOutput,
  experimental_formatConformanceReport as formatConformanceReport,
  experimental_runBridgeConformance as runBridgeConformance,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { CapturedBridgeJsonRpcOutput } from "@get-bb/plugin-sdk/provider-bridge/testing";

import { createCorporateBridge } from "../src/bridge.js";
import { createBridgeFixture } from "./bridge-fixture.js";
let bridge: ReturnType<typeof createCorporateBridge>;
let fixture: Awaited<ReturnType<typeof createBridgeFixture>>;
function handleLine(line: string) { fixture.send(bridge, line); }


let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;

beforeEach(async () => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-conformance-ws-"));
  const fakeScriptPath = join(workspaceDir, "fake-codex-script.json");
  writeFileSync(
    fakeScriptPath,
    JSON.stringify({
      archiveStatePath: join(workspaceDir, "fake-codex-archived.json"),
    }),
  );

  fixture = await createBridgeFixture("codex", workspaceDir);
  const fakePath = join(workspaceDir, "fake-codex.mjs");
  writeFileSync(fakePath, '#!/usr/bin/env node\nprocess.argv = [process.argv[0], ' + JSON.stringify(new URL("./fake-codex-app-server.mjs", import.meta.url).pathname) + ', ' + JSON.stringify(fakeScriptPath) + '];\nawait import(' + JSON.stringify(new URL("./fake-codex-app-server.mjs", import.meta.url).href) + ');\n', { mode: 0o755 });
  fixture.options.executable = fakePath;
  bridge = createCorporateBridge();
  bridge.start?.({ pluginId: "litellm", dataDir: workspaceDir, tempDir: workspaceDir });
  output = captureBridgeJsonRpcOutput();
});

afterEach(async () => {
  await bridge.dispose();
  await fixture.close();
  output.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
});

it("passes the canonical protocol suite against supervised fake app-server children", async () => {
  const report = await runBridgeConformance({
    transport: { send: handleLine, takeMessages: output.takeMessages },
    providerId: "litellm-codex",
    session: {
      cwd: workspaceDir,
      promptInput: [{ type: "text", text: "say hello", mentions: [] }],
      zeroWorkPromptInput: [{ type: "text", text: "/clear", mentions: [] }],
      interruptiblePromptInput: [
        { type: "text", text: "/wait-for-interrupt", mentions: [] },
      ],
    },
    timeoutMs: 10_000,
  });

  console.info(`codex bridge conformance:\n${formatConformanceReport(report)}`);

  const statusById = Object.fromEntries(
    report.results.map((result) => [result.id, result.status]),
  );

  expect(statusById).toMatchObject({
    "rpc/unknown-method": "pass",
    "rpc/invalid-params": "pass",
    "rpc/non-json-ignored": "pass",
    "rpc/response-not-request": "pass",
    "handshake/initialize": "pass",
    "skills/configure-declared": "pass",
    "commands/list-declared": "pass",
    "session/start-identity": "pass",
    "session/start-identity-announced": "pass",
    "turn/lifecycle": "pass",
    "events/schema-valid": "pass",
    "item/opens-before-delta": "pass",
    "stop/release-not-interrupted": "pass",
    "session/resume-identity": "pass",
    "session/resume-id-uniqueness": "pass",
    "session/fork-identity": "pass",
    "session/fork-identity-announced": "pass",
    "turn/settles-without-activity": "pass",
    "recovery/session-archived": "pass",
    "session/threads-independent": "pass",
    "stop/interrupt-settles-before-result": "pass",
  });

  expect(
    report.results
      .filter((result) => result.status !== "pass")
      .map((result) => result.id),
  ).toEqual([]);
}, 60_000);
