// bb-plugin-plugin-sync: keeps this bb's plugin set in line with a GitHub repository.
//
// The repository's marketplace.json lists the plugins (the same file bb's plugin store
// reads after `bb marketplace add`). Nothing changes on its own: an hourly check records what differs, the
// app shows a toast once per new set of changes, and the settings section (app.tsx)
// has the Apply button.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// The parts of a marketplace.json entry this plugin uses; bb validates the rest.
const marketplaceSchema = z.object({
  plugins: z.array(
    z.object({
      id: z.string().min(1),
      source: z.union([
        z.object({
          git: z.object({
            url: z.string(),
            subdir: z.string().optional(),
            ref: z.string().optional(),
            range: z.string().optional(),
            tagPrefix: z.string().optional(),
          }),
        }),
        z.object({
          npm: z.object({
            package: z.string(),
            range: z.string().optional(),
            tag: z.string().optional(),
          }),
        }),
        z.object({ bundled: z.object({ plugin: z.string() }) }),
      ]),
    }),
  ),
});
type MarketplaceSource = z.infer<typeof marketplaceSchema>["plugins"][number]["source"];

const pluginEntrySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  kind: z.enum(["own", "external"]),
  // missing: not installed. update: the source has a newer version. Apply handles both.
  // local: installed from a local path, a working copy left alone.
  // other-source: the id is installed from somewhere else, left alone.
  // broken: installed but not running.
  state: z.enum(["missing", "update", "current", "local", "other-source", "broken"]),
  source: z.string(),
  installedSource: z.string().nullable(),
  detail: z.string().nullable(),
});
export type PluginEntry = z.infer<typeof pluginEntrySchema>;

const statusSchema = z.object({
  repository: z.string(),
  branch: z.string(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
  plugins: z.array(pluginEntrySchema),
  // Installed from this repository but no longer listed in it. Shown, never removed.
  orphaned: z.array(z.string()),
  // Identifies the pending changes; the toast shows once per signature.
  signature: z.string(),
  acknowledged: z.boolean(),
  busy: z.boolean(),
});
export type SyncStatus = z.infer<typeof statusSchema>;

const actionResultSchema = z.object({
  done: z.array(z.string()),
  failed: z.array(z.object({ id: z.string(), error: z.string() })),
});
export type ActionResult = z.infer<typeof actionResultSchema>;

export const rpcContract = defineRpcContract({
  status: { input: z.null(), output: statusSchema },
  check: { input: z.null(), output: statusSchema },
  apply: { input: z.null(), output: actionResultSchema },
  update: { input: z.object({ id: z.string().min(1) }), output: actionResultSchema },
  acknowledge: { input: z.object({ signature: z.string() }), output: z.null() },
});

const STATUS_CHANGED = "status-changed";
const SELF_ID = "plugin-sync";

/** A source without its ref or version: git:https://host/repo.git@main → https://host/repo.git */
function sourceBase(source: string): string {
  if (source.startsWith("npm:")) {
    const name = source.slice(4);
    const at = name.indexOf("@", 1);
    return `npm:${at === -1 ? name : name.slice(0, at)}`;
  }
  const bare = source.replace(/^git:/, "");
  const scheme = bare.indexOf("://");
  const at = bare.indexOf("@", scheme === -1 ? 1 : scheme + 3);
  return at === -1 ? bare : bare.slice(0, at);
}

/** `bb plugin install` arguments for a marketplace source; null for bundled plugins. */
function installArgs(source: MarketplaceSource): { source: string; subdirectory?: string } | null {
  if ("git" in source) {
    const { url, subdir, ref, range, tagPrefix } = source.git;
    const spec =
      range !== undefined ? `@semver:${tagPrefix === undefined ? "" : `${tagPrefix}:`}${range}` : ref !== undefined ? `@${ref}` : "";
    return { source: `git:${url}${spec}`, ...(subdir === undefined ? {} : { subdirectory: subdir }) };
  }
  if ("npm" in source) {
    const version = source.npm.range ?? source.npm.tag;
    return { source: `npm:${source.npm.package}${version === undefined ? "" : `@${version}`}` };
  }
  return null;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    repository: {
      type: "string",
      label: "GitHub repository",
      description: "owner/name of the public repository with marketplace.json",
      default: "toolstik/bb-plugins",
      experimental_schema: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/name"),
    },
    branch: {
      type: "string",
      label: "Branch",
      default: "main",
      experimental_schema: z.string().min(1),
    },
  });

  let busy = false;
  let lastStatus: SyncStatus | null = null;

  async function fetchJson(repository: string, branch: string, path: string): Promise<unknown> {
    const url = `https://raw.githubusercontent.com/${repository}/${branch}/${path}`;
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  async function readManifest() {
    const { repository, branch } = await settings.get();
    const marketplace = await fetchJson(repository, branch, "marketplace.json");
    if (marketplace === null) throw new Error(`${repository}@${branch} has no marketplace.json`);
    const repoUrl = `https://github.com/${repository}.git`;
    const plugins = marketplaceSchema.parse(marketplace).plugins.flatMap((entry) => {
      const args = installArgs(entry.source);
      if (args === null) return [];
      const own = sourceBase(args.source) === repoUrl;
      return [
        {
          id: entry.id,
          kind: own ? ("own" as const) : ("external" as const),
          args,
          display: own && args.subdirectory !== undefined ? `${args.subdirectory} @ ${branch}` : args.source,
        },
      ];
    });
    return { repository, branch, repoUrl, plugins };
  }

  async function publish(
    partial: Omit<SyncStatus, "signature" | "acknowledged" | "busy">,
  ): Promise<SyncStatus> {
    const pending = partial.plugins
      .filter((p) => p.state === "missing" || p.state === "update")
      .map((p) => `${p.state}:${p.id}:${p.detail ?? ""}`)
      .sort();
    const signature = pending.join("\n");
    const acknowledged = await bb.storage.kv.get<string>("acknowledged");
    const status: SyncStatus = {
      ...partial,
      signature,
      acknowledged: signature === "" || signature === acknowledged,
      busy,
    };
    lastStatus = status;
    await bb.storage.kv.set("status", status);
    bb.realtime.publish(STATUS_CHANGED, { signature });
    return status;
  }

  /** Compares the repository with what is installed, from bb's last update check. */
  async function buildStatus(error: string | null = null): Promise<SyncStatus> {
    const { repository, branch } = await settings.get();
    const base = {
      repository,
      branch,
      checkedAt: new Date().toISOString(),
      plugins: [],
      orphaned: [],
    };
    let manifest: Awaited<ReturnType<typeof readManifest>>;
    try {
      manifest = await readManifest();
    } catch (cause) {
      return publish({ ...base, error: error ?? errorText(cause) });
    }

    const { plugins: installed } = await bb.sdk.plugins.list();
    const byId = new Map(installed.map((p) => [p.id, p]));

    const describe = (
      id: string,
      kind: PluginEntry["kind"],
      source: string,
      expectedBase: string,
    ): PluginEntry => {
      const current = byId.get(id);
      const entry = { id, kind, source, name: current?.name ?? null };
      if (current === undefined) {
        return { ...entry, state: "missing", installedSource: null, detail: null };
      }
      const result = (state: PluginEntry["state"], detail: string | null = null): PluginEntry => ({
        ...entry,
        state,
        installedSource: current.source,
        detail,
      });
      if (current.source.startsWith("path:")) return result("local");
      if (sourceBase(current.source) !== expectedBase) return result("other-source");
      if (current.status !== "running" && current.status !== "disabled") {
        return result("broken", current.statusDetail ?? current.status);
      }
      if (current.updateState.outcome === "update-available") {
        return result("update", current.updateState.availableVersion ?? null);
      }
      return result("current");
    };

    const plugins = manifest.plugins.map((p) =>
      describe(p.id, p.kind, p.display, sourceBase(p.args.source)),
    );

    const listed = new Set(plugins.map((p) => p.id));
    const orphaned = installed
      .filter((p) => sourceBase(p.source) === manifest.repoUrl && !listed.has(p.id))
      .map((p) => p.id);

    return publish({ ...base, error, plugins, orphaned });
  }

  /** Asks bb to re-check every tracking source, then rebuilds the status. */
  async function check(): Promise<SyncStatus> {
    let error: string | null = null;
    try {
      await bb.sdk.plugins.checkUpdates();
    } catch (cause) {
      error = `Update check failed: ${errorText(cause)}`;
    }
    return buildStatus(error);
  }

  async function exclusive(work: () => Promise<ActionResult>): Promise<ActionResult> {
    if (busy) throw new Error("Another apply or update is still running");
    busy = true;
    if (lastStatus !== null) lastStatus = { ...lastStatus, busy };
    bb.realtime.publish(STATUS_CHANGED, { busy });
    try {
      return await work();
    } finally {
      busy = false;
      await buildStatus().catch((cause) => bb.log.warn(`status refresh failed: ${errorText(cause)}`));
    }
  }

  async function installMissing(
    manifest: Awaited<ReturnType<typeof readManifest>>,
    result: ActionResult,
  ): Promise<void> {
    const { plugins: installed } = await bb.sdk.plugins.list();
    const have = new Set(installed.map((p) => p.id));
    const targets = manifest.plugins.filter((p) => !have.has(p.id));
    for (const target of targets) {
      try {
        await bb.sdk.plugins.install(target.args);
        result.done.push(`installed ${target.id}`);
      } catch (cause) {
        result.failed.push({ id: target.id, error: errorText(cause) });
      }
    }
  }

  async function applyUpdates(ids: string[], result: ActionResult): Promise<void> {
    for (const pluginId of ids.filter((p) => p !== SELF_ID)) {
      try {
        const outcome = await bb.sdk.plugins.applyUpdate({ pluginId });
        if (outcome.applied) result.done.push(`updated ${pluginId}`);
        else result.failed.push({ id: pluginId, error: outcome.detail ?? outcome.outcome });
      } catch (cause) {
        result.failed.push({ id: pluginId, error: errorText(cause) });
      }
    }
    // Updating this plugin reloads it, so it goes last and runs as a background job.
    if (ids.includes(SELF_ID)) {
      try {
        await bb.sdk.plugins.experimental_startUpdate({ pluginId: SELF_ID });
        result.done.push(`updating ${SELF_ID}, it reloads itself`);
      } catch (cause) {
        result.failed.push({ id: SELF_ID, error: errorText(cause) });
      }
    }
  }

  /** Brings this bb in line with the repository: installs and updates. Never removes. */
  function apply(): Promise<ActionResult> {
    return exclusive(async () => {
      const result: ActionResult = { done: [], failed: [] };
      const manifest = await readManifest();
      await installMissing(manifest, result);
      const status = await check();
      const ids = status.plugins.filter((p) => p.state === "update").map((p) => p.id);
      await applyUpdates(ids, result);
      return result;
    });
  }

  /** Updates one plugin only. */
  function update(id: string): Promise<ActionResult> {
    return exclusive(async () => {
      const status = await check();
      if (!status.plugins.some((p) => p.id === id && p.state === "update")) {
        throw new Error(`${id} has no update to apply`);
      }
      const result: ActionResult = { done: [], failed: [] };
      await applyUpdates([id], result);
      return result;
    });
  }

  bb.rpc.register(rpcContract, {
    status: async () => {
      const status = lastStatus ?? (await bb.storage.kv.get<SyncStatus>("status"));
      return status == null ? buildStatus() : { ...status, busy };
    },
    check: () => check(),
    apply: () => apply(),
    update: ({ id }) => update(id),
    acknowledge: async ({ signature }) => {
      await bb.storage.kv.set("acknowledged", signature);
      if (lastStatus !== null) await publish(lastStatus);
      return null;
    },
  });

  // Only looks; installing and updating stay manual.
  bb.background.schedule("check", "23 * * * *", async () => {
    await check();
  });

  const usage = [
    "Usage:",
    "  bb plugin-sync status [--json]         Re-check sources and show what differs",
    "  bb plugin-sync apply [--json]          Install missing plugins and apply updates",
    "  bb plugin-sync update <id> [--json]    Update one plugin",
  ].join("\n");

  function formatStatus(status: SyncStatus): string {
    const lines = [`${status.repository}@${status.branch}, checked ${status.checkedAt ?? "never"}`];
    if (status.error !== null) lines.push(`error: ${status.error}`);
    for (const p of status.plugins) {
      lines.push(`${p.state.padEnd(13)}${p.id}${p.detail === null ? "" : `  (${p.detail})`}`);
    }
    for (const id of status.orphaned) lines.push(`${"not listed".padEnd(13)}${id}`);
    return lines.join("\n");
  }

  function formatResult(result: ActionResult): string {
    const lines = [...result.done, ...result.failed.map((f) => `failed ${f.id}: ${f.error}`)];
    return lines.length === 0 ? "Nothing to do." : lines.join("\n");
  }

  bb.cli.register({
    name: "plugin-sync",
    summary: "Sync this bb's plugins with the plugin repository",
    commands: [
      {
        name: "status",
        summary: "Re-check sources and show what differs",
        usage: "bb plugin-sync status [--json]",
      },
      {
        name: "apply",
        summary: "Install missing plugins and apply updates",
        usage: "bb plugin-sync apply [--json]",
      },
      {
        name: "update",
        summary: "Update one plugin",
        usage: "bb plugin-sync update <id> [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      const reply = (value: unknown, text: string, failed: boolean) => ({
        exitCode: failed ? 1 : 0,
        stdout: json ? JSON.stringify(value) : text,
      });
      try {
        switch (command) {
          case undefined:
          case "help":
          case "--help":
            return { exitCode: 0, stdout: usage };
          case "status": {
            const status = await check();
            return reply(status, formatStatus(status), status.error !== null);
          }
          case "apply": {
            if (args.length > 0) break;
            const result = await apply();
            return reply(result, formatResult(result), result.failed.length > 0);
          }
          case "update": {
            const [id] = args;
            if (id === undefined || args.length > 1) break;
            const result = await update(id);
            return reply(result, formatResult(result), result.failed.length > 0);
          }
        }
      } catch (cause) {
        return { exitCode: 1, stderr: errorText(cause) };
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  // First check shortly after load, without holding up activation.
  const timer = setTimeout(() => {
    check().catch((cause) => bb.log.warn(`initial check failed: ${errorText(cause)}`));
  }, 5_000);
  bb.onDispose(() => clearTimeout(timer));
}
