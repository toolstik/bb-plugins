import { expect, it } from "vitest";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import { fileURLToPath } from "node:url";

it("ships only public SDK imports and local bridge dependencies", () => {
  const scan = experimental_scanPublicSdkOnly(fileURLToPath(new URL("../", import.meta.url)), {
    // /process is a public export in SDK 0.6.132; the scanner's default list predates it.
    allow: [/^vitest$/, /^@get-bb\/plugin-sdk\/process$/, /^@anthropic-ai\/claude-agent-sdk$/, /^@modelcontextprotocol\/sdk\//],
  });
  expect(scan.privateDependencies).toEqual([]);
  expect(scan.violations).toEqual([]);
});
