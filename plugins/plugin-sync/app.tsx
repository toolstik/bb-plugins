// bb-plugin-plugin-sync frontend: the settings section with the Apply button,
// and an app-wide toast that announces new changes once per set of changes.
import { useCallback, useEffect, useRef, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ActionResult, PluginEntry, rpcContract, SyncStatus } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function useSyncStatus() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("status").then(
      (next) => {
        setStatus(next);
        setError(null);
      },
      (cause) => setError(errorText(cause)),
    );
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime("status-changed", refetch);
  return { rpc, status, error, refetch };
}

function counts(status: SyncStatus) {
  const missing = status.plugins.filter((p) => p.state === "missing").length;
  const updates = status.plugins.filter((p) => p.state === "update").length;
  return { missing, updates, total: missing + updates };
}

function summary(status: SyncStatus): string {
  const { missing, updates } = counts(status);
  const parts = [
    missing > 0 && `${missing} new plugin${missing === 1 ? "" : "s"}`,
    updates > 0 && `${updates} update${updates === 1 ? "" : "s"}`,
  ];
  return parts.filter(Boolean).join(", ");
}

function reportResult(result: ActionResult) {
  for (const failure of result.failed) toast.error(`${failure.id}: ${failure.error}`);
  if (result.done.length > 0) toast.success(result.done.join("\n"));
  else if (result.failed.length === 0) toast("Nothing to do");
}

const STATE_LABEL: Record<PluginEntry["state"], string> = {
  missing: "Not installed",
  update: "Update available",
  current: "Up to date",
  local: "Local copy",
  "other-source": "Other source",
  broken: "Not running",
};

const STATE_TONE: Record<PluginEntry["state"], string> = {
  missing: "text-foreground",
  update: "text-foreground",
  current: "text-muted-foreground",
  local: "text-muted-foreground",
  "other-source": "text-muted-foreground",
  broken: "text-destructive",
};

function PluginRow({
  plugin,
  disabled,
  onUpdate,
}: {
  plugin: PluginEntry;
  disabled: boolean;
  onUpdate: () => void;
}) {
  const hint =
    plugin.state === "local" || plugin.state === "other-source"
      ? plugin.installedSource
      : plugin.state === "broken"
        ? plugin.detail
        : plugin.source;
  return (
    <li className="flex items-center gap-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate">
          {plugin.name ?? plugin.id}
          {plugin.name !== null && plugin.name !== plugin.id ? (
            <span className="ml-2 font-mono text-xs text-muted-foreground">{plugin.id}</span>
          ) : null}
        </div>
        {hint === null ? null : (
          <div className="truncate text-xs text-muted-foreground" title={hint}>
            {hint}
          </div>
        )}
      </div>
      <span className={cn("shrink-0 text-xs", STATE_TONE[plugin.state])}>
        {STATE_LABEL[plugin.state]}
      </span>
      {plugin.state === "update" ? (
        <Button size="sm" variant="outline" disabled={disabled} onClick={onUpdate}>
          Update
        </Button>
      ) : null}
    </li>
  );
}

function SettingsSection() {
  const { rpc, status, error } = useSyncStatus();
  const [running, setRunning] = useState<string | null>(null);
  const busy = running !== null || status?.busy === true;

  const run = (label: string, action: () => Promise<ActionResult | SyncStatus>) => {
    setRunning(label);
    action()
      .then((result) => {
        if ("done" in result) reportResult(result);
      }, (cause) => toast.error(errorText(cause)))
      .finally(() => setRunning(null));
  };

  if (status === null) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
  }
  const { total } = counts(status);
  const pending = summary(status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || total === 0} onClick={() => run("apply", () => rpc.call("apply"))}>
          <Icon name="Download" className="size-4" />
          {running === "apply" ? "Applying…" : total > 0 ? `Apply (${total})` : "Apply"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => run("check", () => rpc.call("check"))}>
          <Icon name="RefreshCw" className="size-4" />
          {running === "check" ? "Checking…" : "Check now"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {status.repository}@{status.branch}
        {status.checkedAt === null
          ? null
          : `, checked ${new Date(status.checkedAt).toLocaleString()}`}
        {pending === "" ? ". Everything matches the repository." : `. Pending: ${pending}.`}
      </p>
      {status.error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {status.error}
        </p>
      )}

      {status.plugins.length === 0 ? null : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card px-4">
          {status.plugins.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              disabled={busy}
              onUpdate={() => run("update", () => rpc.call("update", { id: plugin.id }))}
            />
          ))}
        </ul>
      )}

      {status.orphaned.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          Installed from this repository but no longer listed: {status.orphaned.join(", ")}. Remove
          them with <code>bb plugin remove &lt;id&gt;</code> if they are not needed.
        </p>
      )}
    </div>
  );
}

const TOAST_ID = "plugin-sync-changes";

/** Shows one toast per new set of pending changes, in every window, until acknowledged. */
function ChangesToast() {
  const { rpc, status } = useSyncStatus();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (status === null || status.busy) return;
    if (status.acknowledged) {
      if (shown.current !== null) toast.dismiss(TOAST_ID);
      shown.current = null;
      return;
    }
    if (shown.current === status.signature) return;
    shown.current = status.signature;
    const signature = status.signature;
    const acknowledge = () => {
      rpc.call("acknowledge", { signature }).catch(() => undefined);
    };
    toast(`Plugin changes: ${summary(status)}`, {
      id: TOAST_ID,
      description: `${status.repository}. Open Settings → Plugin Sync for details.`,
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: "Apply",
        onClick: () => {
          acknowledge();
          rpc.call("apply").then(reportResult, (cause) => toast.error(errorText(cause)));
        },
      },
      cancel: { label: "Later", onClick: acknowledge },
    });
  }, [rpc, status]);

  return null;
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "sync",
    title: "Plugin repository",
    description:
      "Apply installs missing plugins and updates outdated ones. Nothing changes until you press it.",
    component: SettingsSection,
  });
  app.slots.experimental_appOverlay({
    id: "changes-toast",
    component: ChangesToast,
  });
});
