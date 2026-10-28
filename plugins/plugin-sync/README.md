# bb-plugin-plugin-sync

Installs and updates the plugins listed in a GitHub repository (default `toolstik/bb-plugins`, branch `main`). See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for what it does.

## Install

```
bb plugin install git:https://github.com/toolstik/bb-plugins.git@main --subdirectory plugins/plugin-sync
```

Then open Settings → Plugin Sync and press **Sync**, or run `bb plugin-sync sync`.

## Repository format

- `.bb/plugins.json`: the repository's own plugins. Each entry `name` must equal the plugin id.
- `sync.json` (optional):

```json
{
  "external": [{ "id": "handoff", "source": "git:https://github.com/vburojevic/bb-plugin-handoff.git@semver:^0.7.0" }],
  "keyboard": [
    { "command": "thread.new", "shortcut": null },
    { "command": "plugin:new-chat-personal/new-chat", "shortcut": { "key": "O", "mod": true, "shift": true } }
  ]
}
```

`shortcut: null` unbinds the command; omitted modifiers are false.
