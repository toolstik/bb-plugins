// bb-plugin-bulk-delete frontend.
//
// Multi-select in bb's own sidebar, without replacing it:
// - Shift+click a thread row (or "Select" in its menu) starts a selection;
//   while it is non-empty a plain click toggles a row, Shift+click selects the
//   range from the last clicked row, Escape clears it. Rows are found through
//   their `a[data-sidebar-thread-id]` anchor, the same hook session-colors uses.
// - A floating bar archives or deletes the selection after a confirmation.
// - "Delete idle children" in a parent's thread menu deletes every child that
//   is not working, after showing what goes and what stays.
// Deletion itself runs in server.ts, shared with the `bb bulk-delete` CLI.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  definePluginApp,
  experimental_THREAD_ACTION_GROUPS,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { DeletePlan, DeleteResult, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// State shared by the overlay and the thread menu actions.

interface BulkState {
  selected: ReadonlySet<string>;
  /** The last row clicked, where a Shift+click range starts. */
  anchorId: string | null;
  dialog:
    | { kind: "selection" }
    | { kind: "children"; parentThreadId: string }
    | null;
}

let state: BulkState = { selected: new Set(), anchorId: null, dialog: null };
const listeners = new Set<() => void>();

function setState(update: (current: BulkState) => BulkState) {
  state = update(state);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useBulkState(): BulkState {
  return useSyncExternalStore(subscribe, () => state);
}

function toggle(threadId: string) {
  setState((current) => {
    const selected = new Set(current.selected);
    if (selected.has(threadId)) selected.delete(threadId);
    else selected.add(threadId);
    return { ...current, selected, anchorId: threadId };
  });
}

function selectRange(threadId: string) {
  setState((current) => {
    const ids = visibleRowIds();
    const from = current.anchorId === null ? -1 : ids.indexOf(current.anchorId);
    const to = ids.indexOf(threadId);
    const selected = new Set(current.selected);
    if (from === -1 || to === -1) {
      selected.add(threadId);
    } else {
      for (const id of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        selected.add(id);
      }
    }
    return { ...current, selected, anchorId: threadId };
  });
}

function clearSelection() {
  setState((current) => ({ ...current, selected: new Set(), anchorId: null }));
}

function openDialog(dialog: BulkState["dialog"]) {
  setState((current) => ({ ...current, dialog }));
}

// Sidebar DOM.

const ROW_ANCHOR = "a[data-sidebar-thread-id]";

/** Thread ids of the sidebar rows on screen, top to bottom. */
function visibleRowIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ROW_ANCHOR))
    .map((anchor) => anchor.dataset.sidebarThreadId ?? "")
    .filter((id) => id !== "");
}

function rowAnchorOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>(ROW_ANCHOR)
    : null;
}

/** The whole sidebar row; see session-colors for why the chain is direct. */
function rowSelector(threadId: string): string {
  return `[data-sidebar-rename-row]:has(> span > a[data-sidebar-thread-id="${CSS.escape(threadId)}"])`;
}

function selectionCss(selected: ReadonlySet<string>): string {
  if (selected.size === 0) return "";
  const rows = [...selected].map(rowSelector).join(",\n");
  return `${rows} {
  background-color: color-mix(in oklab, var(--ink) 12%, transparent) !important;
  box-shadow: inset 2px 0 0 color-mix(in oklab, var(--ink) 70%, transparent);
}`;
}

/**
 * Click handling runs in the capture phase on the document, ahead of bb's
 * React handlers, so a selecting click never navigates. Cmd/Ctrl+click stays
 * bb's (open in split).
 */
function useSidebarClickSelection() {
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      // Keep Shift+click from selecting text across rows.
      if (event.shiftKey && rowAnchorOf(event.target) !== null) {
        event.preventDefault();
      }
    };
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const anchor = rowAnchorOf(event.target);
      const threadId = anchor?.dataset.sidebarThreadId;
      if (threadId === undefined || threadId === "") return;
      if (event.shiftKey) {
        if (state.selected.size === 0) toggle(threadId);
        else selectRange(threadId);
      } else if (state.selected.size > 0) {
        toggle(threadId);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        state.dialog === null &&
        state.selected.size > 0
      ) {
        clearSelection();
      }
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

// Confirmation dialogs.

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function reportResult(result: DeleteResult) {
  const kept =
    result.skipped.length > 0 ? `, kept ${plural(result.skipped.length, "working thread")}` : "";
  if (result.failed.length === 0) {
    toast.success(`Deleted ${plural(result.deleted.length, "thread")}${kept}`);
  } else {
    toast.error(
      `Deleted ${result.deleted.length}, failed ${result.failed.length}: ${result.failed[0]?.error ?? ""}`,
    );
  }
}

function PlanList({ plan }: { plan: DeletePlan }) {
  // Parents above their children, as the sidebar shows them.
  const targets = [...plan.targets].reverse();
  return (
    <div className="max-h-72 space-y-3 overflow-y-auto text-sm">
      {targets.length > 0 ? (
        <ul className="space-y-1">
          {targets.map((target) => (
            <li
              key={target.id}
              className="flex items-center gap-2"
              style={{ paddingLeft: `${target.depth * 16}px` }}
            >
              <Icon name="Trash2" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{target.title}</span>
              {target.busy ? (
                <span className="shrink-0 text-xs text-destructive">working</span>
              ) : target.archived ? (
                <span className="shrink-0 text-xs text-muted-foreground">archived</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.skipped.length > 0 ? (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">
            Kept ({plan.skipped.length})
          </div>
          <ul className="space-y-1">
            {plan.skipped.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-muted-foreground">
                <Icon name="Check" className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 text-xs">{item.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Leaves a thread route that is about to disappear. */
function useLeaveDeleted() {
  const { threadId } = useBbContext();
  const navigate = useBbNavigate();
  return useCallback(
    (deleted: readonly string[]) => {
      if (threadId !== null && threadId !== undefined && deleted.includes(threadId)) {
        navigate.toCompose();
      }
    },
    [threadId, navigate],
  );
}

function DeleteSelectionDialog({ threadIds }: { threadIds: readonly string[] }) {
  const rpc = useRpc<typeof rpcContract>();
  const leaveDeleted = useLeaveDeleted();
  const [withChildren, setWithChildren] = useState(true);
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    rpc.call("plan_delete", { threadIds: [...threadIds], withChildren }).then(
      (next) => {
        if (!cancelled) setPlan(next);
      },
      (cause) => {
        if (!cancelled) setError(errorMessage(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadIds, withChildren]);

  const busyPicked = plan?.targets.filter((target) => target.busy && target.depth === 0).length ?? 0;
  const run = async () => {
    setPending(true);
    try {
      const result = await rpc.call("delete_threads", {
        threadIds: [...threadIds],
        withChildren,
      });
      leaveDeleted(result.deleted);
      reportResult(result);
      clearSelection();
      openDialog(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete {plural(threadIds.length, "thread")}?</DialogTitle>
        <DialogDescription>
          Deletion is permanent: messages and thread storage are removed.
        </DialogDescription>
      </DialogHeader>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={withChildren}
          onCheckedChange={(checked) => setWithChildren(checked === true)}
        />
        Also delete their child threads (working ones are kept)
      </label>
      {plan === null ? (
        <p className="text-sm text-muted-foreground">Checking threads…</p>
      ) : (
        <PlanList plan={plan} />
      )}
      {busyPicked > 0 ? (
        <p className="text-sm text-destructive">
          {plural(busyPicked, "selected thread")} still working and will be stopped.
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={() => openDialog(null)} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={run}
          disabled={pending || plan === null || plan.targets.length === 0}
        >
          {pending ? "Deleting…" : `Delete ${plan?.targets.length ?? ""}`}
        </Button>
      </DialogFooter>
    </>
  );
}

function DeleteChildrenDialog({ parentThreadId }: { parentThreadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const leaveDeleted = useLeaveDeleted();
  const [plan, setPlan] = useState<DeletePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    rpc.call("plan_children", { parentThreadId }).then(
      (next) => {
        if (!cancelled) setPlan(next);
      },
      (cause) => {
        if (!cancelled) setError(errorMessage(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, parentThreadId]);

  const run = async () => {
    setPending(true);
    try {
      const result = await rpc.call("delete_children", { parentThreadId });
      leaveDeleted(result.deleted);
      reportResult(result);
      openDialog(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete idle child threads?</DialogTitle>
        <DialogDescription>
          Children that are running, waiting for an answer, or have queued work
          are kept, together with their own children.
        </DialogDescription>
      </DialogHeader>
      {plan === null ? (
        <p className="text-sm text-muted-foreground">Checking children…</p>
      ) : plan.targets.length === 0 && plan.skipped.length === 0 ? (
        <p className="text-sm text-muted-foreground">This thread has no children.</p>
      ) : (
        <PlanList plan={plan} />
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={() => openDialog(null)} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={run}
          disabled={pending || plan === null || plan.targets.length === 0}
        >
          {pending ? "Deleting…" : `Delete ${plan?.targets.length ?? ""}`}
        </Button>
      </DialogFooter>
    </>
  );
}

// The overlay: selection styles, the floating bar, and the dialogs.

function SelectionBar({ count }: { count: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const [pending, setPending] = useState(false);
  const archive = async () => {
    setPending(true);
    try {
      const result = await rpc.call("archive_threads", {
        threadIds: [...state.selected],
      });
      if (result.failed.length === 0) {
        toast.success(`Archived ${plural(result.archived.length, "thread")}`);
      } else {
        toast.error(`Archived ${result.archived.length}, failed ${result.failed.length}`);
      }
      clearSelection();
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <div
      role="toolbar"
      aria-label="Selected threads"
      className={cn(
        "fixed bottom-3 left-3 z-50 flex items-center gap-1 rounded-lg border border-border bg-popover p-1 pl-3 text-sm text-popover-foreground shadow-lg",
      )}
    >
      <span className="mr-1 whitespace-nowrap">{count} selected</span>
      <Button size="sm" variant="ghost" onClick={archive} disabled={pending}>
        <Icon name="Archive" />
        Archive
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => openDialog({ kind: "selection" })}
        disabled={pending}
      >
        <Icon name="Trash2" />
        Delete…
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Clear selection (Esc)"
        onClick={clearSelection}
      >
        <Icon name="X" />
      </Button>
    </div>
  );
}

function BulkOverlay() {
  useSidebarClickSelection();
  const { selected, dialog } = useBulkState();
  // Snapshot the selection when the dialog opens, so the list stays stable.
  const selectionIds = useMemo(
    () => (dialog?.kind === "selection" ? [...selected] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialog],
  );
  return (
    <>
      <style data-bulk-delete="">{selectionCss(selected)}</style>
      {selected.size > 0 ? <SelectionBar count={selected.size} /> : null}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) openDialog(null);
        }}
      >
        <DialogContent className="max-w-lg">
          {dialog?.kind === "selection" ? (
            <DeleteSelectionDialog threadIds={selectionIds} />
          ) : dialog?.kind === "children" ? (
            <DeleteChildrenDialog parentThreadId={dialog.parentThreadId} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Child counts per parent from the sidebar's own data (visible threads only). */
function useChildCounts(): ReadonlyMap<string, number> {
  const { threads } = experimental_useSidebarThreads();
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads) {
      if (thread.parentThreadId === null) continue;
      counts.set(thread.parentThreadId, (counts.get(thread.parentThreadId) ?? 0) + 1);
    }
    return counts;
  }, [threads]);
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "bulk-select",
    component: BulkOverlay,
  });

  app.slots.experimental_threadAction({
    id: "select",
    title: "Select",
    icon: "Check",
    group: experimental_THREAD_ACTION_GROUPS.organize,
    useData: () => useBulkState().selected,
    item: ({ thread, data }) => ({
      label: data.has(thread.id) ? "Deselect" : "Select",
      detail: data.size === 0 ? "Then click or Shift+click rows" : `${data.size} selected`,
      icon: "Check",
      run: () => toggle(thread.id),
    }),
  });

  app.slots.experimental_threadAction({
    id: "delete-idle-children",
    title: "Delete idle children",
    icon: "Trash2",
    group: experimental_THREAD_ACTION_GROUPS.lifecycle,
    useData: () => useChildCounts(),
    item: ({ thread, data }) => {
      const count = data.get(thread.id) ?? 0;
      if (count === 0) return null;
      return {
        label: "Delete idle children…",
        detail: count === 1 ? "1 child" : `${count} children`,
        icon: "Trash2",
        variant: "destructive",
        run: () => openDialog({ kind: "children", parentThreadId: thread.id }),
      };
    },
  });
});
