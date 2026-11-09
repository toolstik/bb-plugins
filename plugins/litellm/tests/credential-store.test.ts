import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { credentialStatus, replaceCredential, saveCredential } from "../src/credential-store.js";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function path() { const dir = await mkdtemp(join(tmpdir(), "litellm-save-")); dirs.push(dir); return join(dir, "credentials.env"); }
it("creates a private file and never returns the key", async () => {
  const file = await path();
  expect(await credentialStatus(file)).toEqual({ path: file, configured: false });
  const result = await saveCredential(file, "new-test-key");
  expect(result).toEqual({ path: file, configured: true });
  expect(JSON.stringify(result)).not.toContain("new-test-key");
  expect(await readFile(file, "utf8")).toBe('LITELLM_API_KEY="new-test-key"\n');
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await credentialStatus(file)).toEqual(result);
});
it("replaces only the LiteLLM assignment and preserves other variables", async () => {
  const file = await path();
  await writeFile(file, '# Keep\nOTHER="other-secret"\nLITELLM_API_KEY=old-test-key\n', { mode: 0o600 });
  await saveCredential(file, "replacement-test-key");
  expect(await readFile(file, "utf8")).toBe('# Keep\nOTHER="other-secret"\nLITELLM_API_KEY="replacement-test-key"\n');
});
it("rejects invalid values, duplicate assignments and non-env files", () => {
  expect(() => replaceCredential("", "bad\nkey")).toThrow("Invalid");
  expect(() => replaceCredential("LITELLM_API_KEY=a\nLITELLM_API_KEY=b", "new")).toThrow("duplicate");
  expect(() => replaceCredential("import something from somewhere;", "new")).toThrow("dotenv");
});
it("refuses symlinks without changing the linked file", async () => {
  const file = await path(), linked = file + ".linked";
  await writeFile(linked, "LITELLM_API_KEY=untouched\n", { mode: 0o600 });
  await symlink(linked, file);
  await expect(saveCredential(file, "replacement")).rejects.toThrow();
  expect(await readFile(linked, "utf8")).toContain("untouched");
});
