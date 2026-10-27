# bb-plugin-session-colors

Color-tag bb threads the way Claude Code's `/color` does. A colored thread gets a colored dot before its title in the sidebar thread list and in the thread header. The row background is left alone, so a colored thread never looks like the selected one.

The palette has eight muted colors: red, orange, yellow, green, cyan, blue, purple, pink. Each one has separate light and dark values and is mixed with the active theme's foreground color, so it follows light/dark mode and custom palettes (Nord, Solarized, Gruvbox and others).

Colors are stored in the plugin's storage on the bb server and survive app and server restarts. A deleted thread loses its color.

## Usage

- In the app: click the dot (dashed circle when no color is set) in the thread header and pick a color or "No color".
- From a terminal or an agent: `bb session-colors set blue` colors the current thread; see `bb session-colors --help` for `clear`, `get`, `list`, `palette` and the `--thread <id>` option.

## Install

```
bb plugin install git:https://github.com/toolstik/bb-plugins.git@main --subdirectory plugins/session-colors
```

To turn it off, disable the plugin in Settings → Plugins or run `bb plugin disable session-colors`.
