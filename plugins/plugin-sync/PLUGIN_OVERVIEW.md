Keeps the plugin set of every bb you use in line with one GitHub repository, without scripts or scheduled jobs.

## What you get

- A Plugin repository section in this plugin's settings that lists every plugin the repository names, with its state: not installed, update available, up to date, or a local copy.
- **Apply** installs the plugins that are missing, applies the keyboard shortcuts the repository lists, and updates plugins that have a newer version. Each outdated plugin also has its own **Update** button.
- An hourly check. When it finds new plugins, updates, or shortcuts that differ, a toast appears once with **Apply** and **Later**.
- `bb plugin-sync status`, `bb plugin-sync apply`, and `bb plugin-sync update <id>` for the same actions from a shell.

## How it works

The plugin reads `.bb/plugins.json` and an optional `sync.json` from the repository's branch on raw.githubusercontent.com. Plugins of the repository install from git with their subdirectory and track the branch; `sync.json` adds third-party plugins by install source and keyboard overrides. Plugins installed from a local path are treated as working copies and never touched. Nothing is removed.

## Requirements

A public GitHub repository. Set its owner/name and branch in the plugin settings.
