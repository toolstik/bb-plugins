# bb-plugin-bulk-delete

Multi-select and bulk deletion of bb threads.

- `server.ts`: planning and deletion (shared by UI and CLI), RPC methods, the `bb bulk-delete` CLI.
- `app.tsx`: sidebar multi-select (app overlay), the floating action bar, confirmation dialogs, and two thread menu actions ("Select", "Delete idle children…").
- `skills/bulk-delete/SKILL.md`: tells agents how to use the CLI.

## Usage

In the sidebar, Shift+click a thread row to start a selection. While it is non-empty, a click toggles a row, Shift+click selects the range from the last clicked row, Escape clears. Cmd/Ctrl+click keeps bb's own behavior. The floating bar at the bottom left archives or deletes the selection.

```sh
bb bulk-delete children                      # preview idle children of the current thread
bb bulk-delete children --thread thr_x --yes # delete them
bb bulk-delete threads thr_a thr_b --with-children --yes
```

A thread is "working" while it runs a turn, waits for an answer, has queued messages, or runs background agents, commands, workflows, or goals. Working children are kept, along with the ancestors that would otherwise orphan them.

bb's own delete cascades only through lifecycle owners, so deleting a parent leaves its sidebar children behind. This plugin walks `parentThreadId` itself and deletes each subtree bottom-up.

## Develop

```sh
npm install --include=dev
npx tsc --noEmit
bb plugin build
bb plugin install .
```
