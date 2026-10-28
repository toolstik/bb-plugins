---
name: plugin-sync
description: Check, install, or update the bb plugins listed in the user's GitHub plugin repository with `bb plugin-sync`.
---

# Plugin Sync

The plugin compares this bb with a GitHub repository (settings `repository`, default `toolstik/bb-plugins`, and `branch`, default `main`). The repository lists the plugins in `marketplace.json` (a bb marketplace manifest).

- `bb plugin-sync status [--json]` re-checks sources and prints one line per plugin: `missing`, `update`, `current`, `local` (installed from a local path, never touched), `other-source`, or `broken`; then plugins that the repository no longer lists. Exits 1 if the repository can't be read.
- `bb plugin-sync apply [--json]` installs missing plugins and updates every listed plugin that has a newer version. It never removes plugins.
- `bb plugin-sync update <id> [--json]` updates one plugin. Updating `plugin-sync` itself runs last as a background job and reloads the plugin.

Install and update run plugin code with full trust: run `apply` and `update` only when the user asks for them. An hourly check and a toast in the app tell the user about new changes; the user applies them from the toast, from Settings → Plugin Sync, or by asking you.
