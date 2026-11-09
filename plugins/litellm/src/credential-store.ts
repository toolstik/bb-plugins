import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { keyFilePath } from "./config.js";
import { readCredential } from "./credentials.js";

export async function credentialStatus(value: string) {
  const path = keyFilePath(value);
  try { await readCredential(path); return { path, configured: true }; }
  catch { return { path, configured: false }; }
}

export function replaceCredential(text: string, key: string): string {
  if (!key || key.length > 8192 || /[\s\x00-\x1f]/.test(key)) throw new Error("Invalid LiteLLM key.");
  const lines = text.split(/\r?\n/);
  const assignment = /^\s*(?:export\s+)?LITELLM_API_KEY\s*=/;
  if (lines.filter(line => assignment.test(line)).length > 1) throw new Error("The credential file contains duplicate LITELLM_API_KEY assignments.");
  if (lines.some(line => line.trim() && !/^\s*(?:#|(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=)/.test(line))) throw new Error("The selected file is not a supported dotenv file.");
  const replacement = `LITELLM_API_KEY=${JSON.stringify(key)}`;
  let replaced = false;
  const updated = lines.map(line => { if (!assignment.test(line)) return line; replaced = true; return replacement; });
  if (!replaced) { while (updated.at(-1) === "") updated.pop(); updated.push(replacement); }
  return updated.join("\n").replace(/\n*$/, "\n");
}

const pending = new Map<string, Promise<unknown>>();
export async function saveCredential(value: string, key: string) {
  const path = keyFilePath(value);
  const previous = pending.get(path) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    let existing = "";
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) throw new Error("Invalid credential file.");
      existing = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot update the configured credential file. Check its type and permissions.");
    }
    const content = replaceCredential(existing, key);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, path);
    } catch { throw new Error("Cannot save the LiteLLM key on this machine. The previous file has been kept."); }
    finally { await unlink(temporary).catch(() => {}); }
    return { path, configured: true };
  });
  pending.set(path, operation);
  try { return await operation; } finally { if (pending.get(path) === operation) pending.delete(path); }
}
