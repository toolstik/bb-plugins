# Nested Session Count

Adds a small direct-child session count beside each sidebar disclosure arrow,
for expanded and collapsed parents. Uses BB’s live active-thread cache and
excludes hidden helper sessions. Counts update when sessions are added,
reparented, archived, or deleted. No network polling or persisted changes.

The enhancement targets the current Thread list plugin DOM. A future BB
markup change may require updating the CSS selector. Archived-only lists are
not supported by this version.

Build: `bb plugin build`. Disable: `bb plugin disable nested-session-count`.
