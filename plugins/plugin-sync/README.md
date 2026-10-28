# bb-plugin-plugin-sync

Installs and updates the plugins listed in a GitHub repository (default `toolstik/bb-plugins`, branch `main`). See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for what it does.

## Install

```
bb marketplace add git:github.com/toolstik/bb-plugins@main
bb plugin install plugin-sync@toolstik
```

Then open Settings → Plugin Sync and press **Apply**, or run `bb plugin-sync apply`.

## Repository format

`marketplace.json` at the repository root: a bb marketplace manifest (schema version 2) listing every plugin to install. Git and npm sources are supported; entries whose git URL is this repository count as its own plugins.
