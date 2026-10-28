# bb-plugin-plugin-sync

Installs and updates the plugins listed in a GitHub repository (default `toolstik/bb-plugins`, branch `main`). See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for what it does.

## Install

```
bb marketplace add git:github.com/toolstik/bb-plugins@main
bb plugin install plugin-sync@toolstik
```

Then open Settings → Plugin Sync and press **Apply**, or run `bb plugin-sync apply`.

## Repository format

- `marketplace.json`: a bb marketplace manifest (schema version 2) listing every plugin to install. Git and npm sources are supported; entries whose git URL is this repository count as its own plugins.
- `sync.json` (optional):

```json
{
  "keyboard": [
    { "command": "thread.new", "shortcut": null },
    { "command": "plugin:new-chat-personal/new-chat", "shortcut": { "key": "O", "mod": true, "shift": true } }
  ]
}
```

`shortcut: null` unbinds the command; omitted modifiers are false.
