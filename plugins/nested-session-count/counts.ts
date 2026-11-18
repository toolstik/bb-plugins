type Thread = { id: string; parentThreadId: string | null; isHidden: boolean };

export function countChildren(threads: readonly Thread[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (!thread.isHidden && thread.parentThreadId) {
      counts.set(thread.parentThreadId, (counts.get(thread.parentThreadId) ?? 0) + 1);
    }
  }
  return counts;
}

export function countStyles(counts: ReadonlyMap<string, number>): string {
  // Scope to this thread's content so nested wrappers do not hide the button.
  return [...counts].map(([id, count]) => {
    const button = `[data-sidebar-rename-row] > span:has(> a[data-sidebar-thread-id="${CSS.escape(id)}"]) button[aria-expanded][data-sidebar-rename-anchor]`;
    // The host uses ::after to extend the button's touch target.
    return `${button} {
      width: auto; min-width: 20px; gap: 3px; opacity: 1; visibility: visible;
    }
    ${button}::before {
      content: "${count}"; order: 1; font-size: 11px; line-height: 1;
      font-variant-numeric: tabular-nums; font-weight: 400;
      color: var(--muted-foreground); pointer-events: none;
    }`;
  }).join("\n");
}
