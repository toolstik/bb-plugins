import { readFile, stat } from "node:fs/promises";

export function parseCredentialFile(text: string): string {
  const lines = text.split(/\r?\n/).filter(line => /^\s*(?:export\s+)?LITELLM_API_KEY\s*=/.test(line));
  if (lines.length !== 1) throw new Error("Credential file must contain exactly one LITELLM_API_KEY assignment.");
  let value = lines[0]!.replace(/^\s*(?:export\s+)?LITELLM_API_KEY\s*=\s*/, "").trim();
  try {
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
  } catch { throw new Error("Invalid quoting in credential file."); }
  if (typeof value !== "string" || !value || /[\s\x00-\x1f]/.test(value)) {
    throw new Error("LITELLM_API_KEY is empty or invalid.");
  }
  return value;
}

export async function readCredential(path: string): Promise<string> {
  let info;
  try { info = await stat(path); }
  catch { throw new Error("LiteLLM credential file is missing or unreadable. Configure keyFile and use bb secret request."); }
  if (!info.isFile() || info.size > 16_384) throw new Error("Invalid LiteLLM credential file.");
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error("LiteLLM credential file must be private (chmod 600).");
  }
  try { return parseCredentialFile(await readFile(path, "utf8")); }
  catch (error) {
    if (error instanceof Error && !('code' in error)) throw error;
    throw new Error("LiteLLM credential file is unreadable.");
  }
}
