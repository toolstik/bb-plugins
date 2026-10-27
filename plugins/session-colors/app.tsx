// bb-plugin-session-colors frontend.
//
// Two surfaces share the server's threadId → color map:
// - an app-wide overlay that renders a <style> element drawing a color dot
//   before the title of colored rows in bb's sidebar thread list (rows are
//   matched through their `data-sidebar-thread-id` anchor);
// - a thread header control that shows the current color and opens the
//   palette.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import {
  SESSION_COLORS,
  sessionColorVar,
  type SessionColor,
  type SessionColorId,
} from "./colors";
import type { SessionColorMap, rpcContract } from "./server";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** A palette color pulled toward the active theme's foreground. */
function themedColor(id: SessionColorId): string {
  return `color-mix(in oklab, var(${sessionColorVar(id)}) 88%, var(--ink))`;
}

/** The color map, kept current by the server's "colors-changed" signal. */
function useSessionColors() {
  const rpc = useRpc<typeof rpcContract>();
  const [colors, setColors] = useState<SessionColorMap>({});
  const refetch = useCallback(() => {
    rpc.call("colors_list").then(
      (result) => setColors(result.colors),
      () => {
        // Keep the last known colors; the next signal or reconnect retries.
      },
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("colors-changed", refetch);

  // Signals are not replayed, so catch up after every reconnect.
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previousConnection.current !== "connected") {
      refetch();
    }
    previousConnection.current = connection;
  }, [connection, refetch]);

  const setColor = useCallback(
    (threadId: string, color: SessionColorId | null) => {
      setColors((current) => {
        const next = { ...current };
        if (color === null) delete next[threadId];
        else next[threadId] = color;
        return next;
      });
      rpc.call("colors_set", { threadId, color }).catch(refetch);
    },
    [rpc, refetch],
  );
  return { colors, setColor };
}

function paletteCss(): string {
  const light = SESSION_COLORS.map(
    (color) => `${sessionColorVar(color.id)}: ${color.light};`,
  ).join(" ");
  const dark = SESSION_COLORS.map(
    (color) => `${sessionColorVar(color.id)}: ${color.dark};`,
  ).join(" ");
  return `:root { ${light} }\n:root.dark { ${dark} }`;
}

/**
 * The whole sidebar row of a thread. bb's row is a positioned
 * `[data-sidebar-rename-row]` whose own anchor sits two levels down; nested
 * child rows are siblings, so the direct-child chain matches only this row.
 */
function rowSelector(threadId: string): string {
  return `[data-sidebar-rename-row]:has(> span > a[data-sidebar-thread-id="${CSS.escape(threadId)}"])`;
}

function rowsCss(colors: SessionColorMap): string {
  const byColor = new Map<SessionColorId, string[]>();
  for (const [threadId, color] of Object.entries(colors)) {
    const selectors = byColor.get(color) ?? [];
    selectors.push(rowSelector(threadId));
    byColor.set(color, selectors);
  }
  if (byColor.size === 0) return "";

  const rules: string[] = [];
  for (const [color, selectors] of byColor) {
    rules.push(`${selectors.join(",\n")} { --session-color: ${themedColor(color)}; }`);
  }
  const all = [...byColor.values()].flat();
  // A dot before the title. The row background stays bb's, so a colored row
  // never reads as the selected or hovered one. The dot is the first flex item
  // of the span that follows the row's anchor (provider icon, then title).
  rules.push(
    `${all.map((selector) => `${selector} > span > a + span::before`).join(",\n")} {
  content: "";
  flex: none;
  width: 8px;
  height: 8px;
  margin-right: 8px;
  border-radius: 9999px;
  background-color: var(--session-color);
}`,
  );
  return rules.join("\n");
}

function SessionColorStyles() {
  const { colors } = useSessionColors();
  return (
    <style data-session-colors="">{`${paletteCss()}\n${rowsCss(colors)}`}</style>
  );
}

function Swatch({
  color,
  selected,
  onSelect,
}: {
  color: SessionColor;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={color.label}
      aria-pressed={selected}
      title={color.label}
      onClick={onSelect}
      className={cn(
        "flex size-7 cursor-pointer items-center justify-center rounded-full outline-none",
        "hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring",
        selected && "ring-1 ring-foreground/40",
      )}
    >
      <span
        className="block size-4 rounded-full"
        style={{ backgroundColor: themedColor(color.id) }}
      />
    </button>
  );
}

function SessionColorHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const { colors, setColor } = useSessionColors();
  const [open, setOpen] = useState(false);
  const current = colors[threadId] ?? null;
  const currentLabel =
    SESSION_COLORS.find((color) => color.id === current)?.label ?? "None";

  const choose = (color: SessionColorId | null) => {
    setColor(threadId, color);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Session color: ${currentLabel}`}
          title={`Session color: ${currentLabel}`}
          className={cn(
            "flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none",
            "hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
            "data-[state=open]:bg-state-active",
          )}
        >
          {current === null ? (
            <span className="block size-3 rounded-full border border-dashed border-current" />
          ) : (
            <span
              className="block size-3 rounded-full"
              style={{ backgroundColor: themedColor(current) }}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-2"
        mobileTitle="Session color"
      >
        <div className="mb-1.5 px-1 text-xs text-muted-foreground">
          Session color
        </div>
        <div className="grid grid-cols-4 gap-1">
          {SESSION_COLORS.map((color) => (
            <Swatch
              key={color.id}
              color={color}
              selected={color.id === current}
              onSelect={() => choose(color.id)}
            />
          ))}
        </div>
        <button
          type="button"
          disabled={current === null}
          onClick={() => choose(null)}
          className={cn(
            "mt-1.5 w-full cursor-pointer rounded-md px-2 py-1 text-left text-xs text-muted-foreground outline-none",
            "hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          No color
        </button>
      </PopoverContent>
    </Popover>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "row-colors",
    component: SessionColorStyles,
  });
  app.slots.experimental_threadHeaderAction({
    id: "session-color",
    title: "Session color",
    component: SessionColorHeaderAction,
  });
});
