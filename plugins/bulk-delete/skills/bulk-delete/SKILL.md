---
name: bulk-delete
description: Delete several bb threads at once, or every idle child thread of a parent thread (for example finished subagents), with `bb bulk-delete`.
---

# Bulk delete threads

Deletion is permanent. Every command only previews by default; add `--yes` to delete. Confirm with the user before running with `--yes` unless they already asked for the deletion.

```sh
bb bulk-delete children [--thread <parent-id>] [--yes] [--json]
bb bulk-delete threads <id>... [--with-children] [--yes] [--json]
```

`children` deletes the direct children of a parent thread (the current thread by default) that are not working, together with their own children. A thread counts as working while it runs a turn, waits for an answer or approval, has queued messages, or runs background agents, commands, workflows, or goals. A child whose subtree contains a working thread is kept whole. The thread running the command is never deleted.

`threads` deletes the given threads whatever their state. With `--with-children` it also deletes their descendants, keeping working ones and the ancestors between them and the given thread.

bb's own `bb thread delete` does not delete sidebar children of a deleted thread; this command does, bottom-up.

In the app: Shift+click sidebar rows (or "Select" in a thread's menu) to select several threads, then Archive or Delete in the floating bar; a parent's thread menu has "Delete idle children…".
