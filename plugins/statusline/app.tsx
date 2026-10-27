// bb-plugin-statusline - frontend entry.
//
// A one-line status bar above the composer, modeled on the Claude Code
// status line: how full the thread's context window is (percent and tokens)
// and how much of the provider's subscription windows (5-hour, weekly) is
// used, with the time each window resets.
//
// Context usage comes from sdk.threads.context, polled often while the agent
// runs. Limits come from the plugin's server (`usage_limits`), which picks the
// freshest cached measurement among bb's usage sources (the provider plugin,
// Account Pooler); one request per minute is shared by every composer in the
// window, and after a failure the last good numbers stay on screen.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { definePluginApp, useComposer, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { Limits, rpcContract, UsageWindow } from "./server";

const CONTEXT_POLL_RUNNING_MS = 5_000;
const CONTEXT_POLL_IDLE_MS = 60_000;
const LIMITS_POLL_MS = 60_000;
const LIMITS_MIN_INTERVAL_MS = 30_000;
const CLOCK_TICK_MS = 30_000;

type Sdk = ReturnType<typeof useSdk>;
type ContextUsage = NonNullable<Awaited<ReturnType<Sdk["threads"]["context"]>>["usage"]>;
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type OkUsage = NonNullable<Limits["usage"]>;

interface LimitsState {
  /** Last successful measurement, kept through later failures. */
  usage: OkUsage | null;
  /** Why the latest attempt failed, or null when it succeeded. */
  error: string | null;
  fetchedAt: number | null;
}

interface LimitsEntry {
  state: LimitsState;
  inflight: boolean;
  listeners: Set<() => void>;
}

// One entry per provider, shared by all composers of this app window.
const limitsByProvider = new Map<string, LimitsEntry>();

function limitsEntry(providerId: string): LimitsEntry {
  let entry = limitsByProvider.get(providerId);
  if (entry === undefined) {
    entry = { state: { usage: null, error: null, fetchedAt: null }, inflight: false, listeners: new Set() };
    limitsByProvider.set(providerId, entry);
  }
  return entry;
}

function refreshLimits(rpc: Rpc, providerId: string): void {
  const entry = limitsEntry(providerId);
  const last = entry.state.fetchedAt;
  if (entry.inflight || (last !== null && Date.now() - last < LIMITS_MIN_INTERVAL_MS)) return;
  entry.inflight = true;
  const previous = entry.state.usage;
  rpc
    .call("usage_limits", { providerId })
    .then(
      (result): Omit<LimitsState, "fetchedAt"> =>
        result.usage !== null ? { usage: result.usage, error: null } : { usage: previous, error: result.error },
      (cause: unknown) => ({ usage: previous, error: cause instanceof Error ? cause.message : String(cause) }),
    )
    .then((next) => {
      entry.state = { ...next, fetchedAt: Date.now() };
      entry.inflight = false;
      for (const listener of entry.listeners) listener();
    });
}

function useLimits(rpc: Rpc, providerId: string | null, isRunning: boolean): LimitsState | null {
  const [state, setState] = useState<LimitsState | null>(null);
  useEffect(() => {
    if (providerId === null) {
      setState(null);
      return;
    }
    const entry = limitsEntry(providerId);
    const sync = () => setState(entry.state);
    entry.listeners.add(sync);
    sync();
    refreshLimits(rpc, providerId);
    const timer = setInterval(() => refreshLimits(rpc, providerId), LIMITS_POLL_MS);
    return () => {
      entry.listeners.delete(sync);
      clearInterval(timer);
    };
  }, [rpc, providerId]);
  // A finished turn has spent quota.
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    if (wasRunning.current && !isRunning && providerId !== null) refreshLimits(rpc, providerId);
    wasRunning.current = isRunning;
  }, [rpc, providerId, isRunning]);
  return state;
}

function useContextUsage(sdk: Sdk, threadId: string | null, isRunning: boolean): ContextUsage | null {
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  useEffect(() => {
    setUsage(null);
  }, [threadId]);
  useEffect(() => {
    if (threadId === null) return;
    const controller = new AbortController();
    const load = () => {
      sdk.threads.context({ threadId, signal: controller.signal }).then(
        (result) => {
          if (!controller.signal.aborted) setUsage(result.usage);
        },
        () => {},
      );
    };
    load();
    const timer = setInterval(load, isRunning ? CONTEXT_POLL_RUNNING_MS : CONTEXT_POLL_IDLE_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [sdk, threadId, isRunning]);
  return usage;
}

function useThreadProviderId(sdk: Sdk, threadId: string | null): string | null {
  const [providerId, setProviderId] = useState<string | null>(null);
  useEffect(() => {
    setProviderId(null);
    if (threadId === null) return;
    const controller = new AbortController();
    sdk.threads.get({ threadId, signal: controller.signal }).then(
      (thread) => {
        if (!controller.signal.aborted) setProviderId(thread.providerId);
      },
      () => {},
    );
    return () => controller.abort();
  }, [sdk, threadId]);
  return providerId;
}

/** Model of the thread: the composer's picker, else the model of the latest requested turn. */
function useThreadModel(sdk: Sdk, threadId: string | null, picked: string | null, isRunning: boolean): string | null {
  const [lastTurnModel, setLastTurnModel] = useState<string | null>(null);
  useEffect(() => {
    setLastTurnModel(null);
  }, [threadId]);
  useEffect(() => {
    if (threadId === null || picked !== null) return;
    const controller = new AbortController();
    sdk.threads.events
      .list({ threadId, types: ["client/turn/requested"], order: "desc", limit: "1", signal: controller.signal })
      .then(
        (rows) => {
          const data = rows[0]?.data as { execution?: { model?: unknown } } | undefined;
          const model = data?.execution?.model;
          if (!controller.signal.aborted && typeof model === "string") setLastTurnModel(model);
        },
        () => {},
      );
    return () => controller.abort();
  }, [sdk, threadId, picked, isRunning]);
  return picked ?? lastTurnModel;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 2)}M`;
  if (tokens >= 1_000) return `${+(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}k`;
  return String(tokens);
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Reset moment rounded to the nearest whole minute: limits reset on a whole
 * minute, but the provider reports it a fraction of a second off either way,
 * e.g. 00:59:59.710 or 01:00:00.300 for a reset at 01:00.
 */
function resetDate(iso: string): Date | null {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : new Date(Math.round(at / 60_000) * 60_000);
}

/** Local reset time; windows longer than five hours add "dd.MM" when the reset is not today. */
function formatReset(iso: string, kind: string | undefined, now: number): string | null {
  const date = resetDate(iso);
  if (date === null) return null;
  if (kind === "five-hour" || sameDay(date, new Date(now))) return formatClock(date);
  const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }).replace("/", ".");
  return `${day} ${formatClock(date)}`;
}

function windowLabel(window: UsageWindow): string {
  switch (window.kind) {
    case "five-hour":
      return "5h";
    case "daily":
      return "1d";
    case "weekly":
      return "7d";
    default:
      return window.label;
  }
}

// Same thresholds as the Claude Code status line script
// (~/.claude/statusline-command.sh): green below yellowFrom, yellow up to
// redFrom, red from it.
interface Thresholds {
  yellowFrom: number;
  redFrom: number;
}
const CONTEXT_THRESHOLDS: Thresholds = { yellowFrom: 40, redFrom: 50 };
const LIMIT_THRESHOLDS: Thresholds = { yellowFrom: 50, redFrom: 80 };

type Level = "green" | "yellow" | "red";

function level(percent: number, { yellowFrom, redFrom }: Thresholds): Level {
  const rounded = Math.round(percent);
  if (rounded >= redFrom) return "red";
  if (rounded >= yellowFrom) return "yellow";
  return "green";
}

const TEXT_COLOR: Record<Level, string> = {
  green: "text-green-500",
  yellow: "text-yellow-500",
  red: "text-red-500",
};
const FILL_COLOR: Record<Level, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
};

function Meter({ percent, tone }: { percent: number; tone: Level }) {
  return (
    <span aria-hidden className="relative inline-block h-1.5 w-10 overflow-hidden rounded-full bg-border">
      <span
        className={`absolute inset-y-0 left-0 rounded-full ${FILL_COLOR[tone]}`}
        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
      />
    </span>
  );
}

/** Label and percent in the threshold color, the details muted. */
function Segment({
  title,
  label,
  percent,
  thresholds,
  details,
}: {
  title: string;
  label: string;
  percent: number;
  thresholds: Thresholds;
  details: ReactNode;
}) {
  const tone = level(percent, thresholds);
  return (
    <span title={title} className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
      <span className={TEXT_COLOR[tone]}>{label}</span>
      <Meter percent={percent} tone={tone} />
      <span className={TEXT_COLOR[tone]}>
        {Math.round(percent)}%
      </span>
      {details}
    </span>
  );
}

function ContextSegment({ usage }: { usage: ContextUsage }) {
  const window = usage.modelContextWindow;
  const percent = window > 0 ? (usage.usedTokens / window) * 100 : 0;
  const compactAt = usage.snapshot?.autoCompactAtTokens ?? null;
  const title = [
    `Context: ${usage.usedTokens.toLocaleString("en-US")} of ${window.toLocaleString("en-US")} tokens`,
    usage.estimated ? "estimated" : null,
    compactAt === null ? null : `auto-compact at ${compactAt.toLocaleString("en-US")}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <Segment
      title={title}
      label="ctx"
      percent={percent}
      thresholds={CONTEXT_THRESHOLDS}
      details={
        <span>
          {formatTokens(usage.usedTokens)}/{formatTokens(window)}
        </span>
      }
    />
  );
}

function WindowSegment({ window, now, stale }: { window: UsageWindow; now: number; stale: boolean }) {
  const percent = window.usedPercent;
  const reset = window.resetsAt === null ? null : formatReset(window.resetsAt, window.kind, now);
  const resetAt = window.resetsAt === null ? null : resetDate(window.resetsAt);
  const title = [
    `${window.label}: ${Math.round(percent)}% used`,
    resetAt === null
      ? null
      : `resets ${resetAt.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
    stale ? "stale" : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <Segment
      title={title}
      label={windowLabel(window)}
      percent={percent}
      thresholds={LIMIT_THRESHOLDS}
      details={reset === null ? null : <span>↻ {reset}</span>}
    />
  );
}

function matchesModel(windowModel: string, model: string | null): boolean {
  return model !== null && model.toLowerCase().includes(windowModel.toLowerCase());
}

/**
 * Windows worth showing for the current model. A model-specific window (the
 * Fable weekly limit) is hidden unless the thread runs that model; when it
 * does, it competes with the general window of the same kind and only the
 * more used of the two stays.
 */
function visibleWindows(windows: UsageWindow[], model: string | null): UsageWindow[] {
  const general = windows.filter((window) => !window.model);
  const specific = windows.filter((window) => window.model && matchesModel(window.model, model));
  const result = [...general];
  for (const window of specific) {
    const index = result.findIndex((other) => other.kind !== undefined && other.kind === window.kind);
    if (index === -1) result.push(window);
    else if (window.usedPercent > result[index].usedPercent) result[index] = window;
  }
  return result;
}

function LimitsSegments({ limits, model, now }: { limits: LimitsState; model: string | null; now: number }) {
  const { usage, error } = limits;
  if (usage === null) {
    if (error === null) return null;
    return (
      <span title={error} className="whitespace-nowrap text-muted-foreground/70">
        limits unavailable
      </span>
    );
  }
  const stale = error !== null;
  const windows = visibleWindows(usage.windows as UsageWindow[], model);
  return (
    <span
      title={stale ? `Last refresh failed: ${error}` : undefined}
      className={`inline-flex flex-wrap items-center gap-x-4 gap-y-1 ${stale ? "opacity-60" : ""}`}
    >
      {windows.map((window, index) => (
        <WindowSegment key={`${window.label}-${index}`} window={window} now={now} stale={stale} />
      ))}
    </span>
  );
}

function StatusLine() {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const threadId = composer.scope.kind === "new-thread" ? null : composer.scope.threadId;
  const threadProviderId = useThreadProviderId(sdk, threadId);
  const providerId = threadId === null ? (composer.selection?.providerId ?? null) : threadProviderId;
  const context = useContextUsage(sdk, threadId, composer.isRunning);
  const limits = useLimits(rpc, providerId, composer.isRunning);
  const model = useThreadModel(sdk, threadId, composer.selection?.model ?? null, composer.isRunning);
  const now = useNow();
  if (context === null && (limits === null || (limits.usage === null && limits.error === null))) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1 font-mono text-[11px] tabular-nums leading-4">
      {context === null ? null : <ContextSegment usage={context} />}
      {limits === null ? null : <LimitsSegments limits={limits} model={model} now={now} />}
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "statusline",
    scopes: ["thread", "new-thread"],
    banners: [{ id: "statusline", chrome: "bare", component: StatusLine }],
  });
});
