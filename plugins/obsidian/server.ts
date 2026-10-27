// bb-plugin-obsidian - backend entry.
//
// Two jobs:
// - agents.configure: when a thread's workspace lies inside a registered
//   Obsidian vault, tell the agent to write note references in chat as
//   Markdown file links (the chat does not render [[wikilinks]] or
//   obsidian:// URIs as links);
// - RPC for the frontend click interceptor: the list of vault roots, and
//   opening one note in Obsidian.
//
// Vaults are read from Obsidian's own registry (obsidian.json), so only
// vaults Obsidian knows about count, and the server must run on the machine
// where Obsidian is installed.
//
// A note already open in a tab gets the focus; any other note opens in a new
// tab. The obsidian:// URI cannot do that (it either replaces the current tab
// or always adds one), so the note is opened through the Obsidian CLI, which
// runs a script inside the running app; the URI is the fallback when the CLI
// is unavailable or Obsidian is not running.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  list_vaults: {
    input: z.null(),
    output: z.object({ vaults: z.array(z.object({ name: z.string(), root: z.string() })) }),
  },
  open_in_obsidian: {
    input: z.object({ path: z.string().min(1).max(4096) }),
    output: z.object({ opened: z.boolean(), error: z.string().nullable() }),
  },
});

interface Vault {
  name: string;
  root: string;
}

function registryPath(): string {
  switch (platform()) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "obsidian", "obsidian.json");
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "obsidian", "obsidian.json");
  }
}

const registrySchema = z.looseObject({
  vaults: z.record(z.string(), z.looseObject({ path: z.string() })),
});

// configure() is synchronous, so the registry is read with sync fs and
// cached until obsidian.json changes.
let cache: { mtimeMs: number; vaults: Vault[] } | null = null;

function listVaults(): Vault[] {
  const file = registryPath();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return [];
  }
  if (cache?.mtimeMs === mtimeMs) return cache.vaults;
  let vaults: Vault[] = [];
  try {
    const parsed = registrySchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (parsed.success) {
      vaults = Object.values(parsed.data.vaults)
        .map((v) => resolve(v.path))
        .filter((root) => existsSync(join(root, ".obsidian")))
        .map((root) => ({ name: basename(root), root }));
    }
  } catch {
    vaults = [];
  }
  cache = { mtimeMs, vaults };
  return vaults;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The innermost registered vault containing `path`, if any. */
function vaultFor(path: string): Vault | null {
  const abs = resolve(path);
  let best: Vault | null = null;
  for (const vault of listVaults()) {
    if (isInside(vault.root, abs) && (best === null || vault.root.length > best.root.length)) {
      best = vault;
    }
  }
  return best;
}

function run(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((done, fail) => {
    execFile(cmd, args, { timeout }, (error, stdout) => (error ? fail(error) : done(stdout)));
  });
}

function openUri(uri: string): Promise<void> {
  const [cmd, args] =
    platform() === "darwin"
      ? ["open", [uri]]
      : platform() === "win32"
        ? ["cmd", ["/c", "start", "", uri]]
        : ["xdg-open", [uri]];
  return run(cmd, args, 10_000).then(() => {});
}

/** The Obsidian CLI: next to the app on macOS, else `obsidian` on PATH. */
function obsidianCli(): string {
  if (platform() === "darwin") {
    for (const apps of ["/Applications", join(homedir(), "Applications")]) {
      const cli = join(apps, "Obsidian.app", "Contents", "MacOS", "obsidian-cli");
      if (existsSync(cli)) return cli;
    }
  }
  return "obsidian";
}

// Runs inside Obsidian. The path arrives URI-encoded, so the script has no
// quotes or backslashes to escape. A tab in the main area or a popout window
// that shows the note gets the focus (sidebar views such as the outline also
// carry a file and are skipped); otherwise the note opens in a new tab, or in
// the active tab when that one is empty.
function focusOrOpenScript(vaultPath: string): string {
  return `(async () => {
    const ws = app.workspace;
    const path = decodeURIComponent("${encodeURIComponent(vaultPath)}");
    const file = [path, path.normalize("NFC"), path.normalize("NFD")]
      .map((p) => app.vault.getFileByPath(p)).find((f) => f) ?? null;
    if (file === null) return "bb-obsidian:missing";
    let open = null;
    ws.iterateAllLeaves((leaf) => {
      const root = leaf.getRoot();
      if (open || root === ws.leftSplit || root === ws.rightSplit) return;
      if (leaf.getViewState().state?.file === file.path) open = leaf;
    });
    if (open) {
      await ws.revealLeaf(open);
      ws.setActiveLeaf(open, { focus: true });
      return "bb-obsidian:focused";
    }
    const recent = ws.getMostRecentLeaf();
    const leaf = recent?.view?.getViewType() === "empty" ? recent : ws.getLeaf("tab");
    await leaf.openFile(file, { active: true });
    return "bb-obsidian:opened";
  })()`.replace(/\s*\n\s*/gu, " ");
}

/** Focuses or opens the note through the CLI; false when that did not work. */
async function focusOrOpenViaCli(vault: Vault, abs: string, log: BbPluginApi["log"]): Promise<boolean> {
  const vaultPath = relative(vault.root, abs).split(sep).join("/");
  let stdout: string;
  try {
    stdout = await run(obsidianCli(), [`vault=${vault.name}`, "eval", `code=${focusOrOpenScript(vaultPath)}`], 5_000);
  } catch (error) {
    log.info(`Obsidian CLI unavailable, falling back to the URI: ${String(error)}`);
    return false;
  }
  if (/^=> bb-obsidian:(focused|opened)$/mu.test(stdout)) return true;
  log.warn(`Obsidian CLI could not open ${vaultPath}: ${stdout.trim()}`);
  return false;
}

function instructions(vault: Vault, workspace: string): string {
  const sub = relative(vault.root, workspace);
  const where = sub === "" ? "is the root of" : `lies inside (at \`${sub}\`)`;
  return [
    `This thread's workspace \`${workspace}\` ${where} the Obsidian vault "${vault.name}". When the user clicks a Markdown link to a note file of this vault, bb opens the note in Obsidian.`,
    "",
    "In chat replies (not inside note files), every mention of an existing note of this vault is a link of exactly this form:",
    "",
    "`[Note Name](<path/to/Note Name.md>)`",
    "",
    "- The path is relative to the workspace root, keeps the `.md` extension and sits inside angle brackets, so spaces and Cyrillic stay as they are; never URL-encode it.",
    "- The link text is the note's file name without `.md`; use a short alias only when the sentence needs another grammatical form.",
    "- Link only notes whose file you have seen or checked; never invent a path.",
    "- Never write `[[wikilinks]]` or `obsidian://` URIs in chat replies: the chat renders neither as a link.",
    "- Attachments and other non-note files keep plain file links.",
    "",
    "Inside note files, keep the vault's own link conventions.",
  ].join("\n");
}

export default async function plugin(bb: BbPluginApi) {
  bb.agents.configure((context) => {
    const workspace = context.environment.path;
    const vault = workspace === null ? null : vaultFor(workspace);
    if (workspace === null || vault === null) return { tools: [], skills: [] };
    return { tools: [], skills: [], instructions: instructions(vault, resolve(workspace)) };
  });

  bb.rpc.register(rpcContract, {
    list_vaults: () => ({ vaults: listVaults() }),
    open_in_obsidian: async ({ path }) => {
      if (!isAbsolute(path)) return { opened: false, error: "path is not absolute" };
      const abs = resolve(path);
      const vault = vaultFor(abs);
      // Files under .obsidian/ are config, not notes.
      if (vault === null || relative(vault.root, abs).split(sep)[0] === ".obsidian") {
        return { opened: false, error: "not a note of an Obsidian vault" };
      }
      if (!existsSync(abs)) return { opened: false, error: `no such note: ${relative(vault.root, abs)}` };
      try {
        // The CLI switches tabs but leaves the window where it is; a URI with
        // only the vault raises the window and opens nothing.
        if (await focusOrOpenViaCli(vault, abs, bb.log)) {
          await openUri(`obsidian://open?vault=${encodeURIComponent(vault.name)}`);
        } else {
          await openUri(`obsidian://open?path=${encodeURIComponent(abs)}&paneType=tab`);
        }
        return { opened: true, error: null };
      } catch (error) {
        bb.log.warn(`failed to open ${abs} in Obsidian: ${String(error)}`);
        return { opened: false, error: String(error) };
      }
    },
  });
}
