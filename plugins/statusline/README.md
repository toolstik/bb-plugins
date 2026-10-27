# bb-plugin-statusline

A bb plugin that adds a one-line status bar above the composer, like the Claude Code status line:

- `ctx` - how full the thread's context window is: percent and used/total tokens. The tooltip shows exact numbers, whether bb estimated them, and the auto-compaction threshold when the provider reports one.
- `5h`, `7d` - percent of the subscription window used and the local time it resets: `↻ 03:00`; `7d` adds the date when the reset is not today: `↻ 09.10 03:00`.

A model-specific window (the Fable weekly limit) shows only while the thread runs that model, and then replaces the general window of the same kind only when it is more used. The thread's model is the composer's model picker, else the model of the latest requested turn. The tooltip names which window is shown.

Context usage comes from `sdk.threads.context` and is polled every 5 s while the agent runs, every minute otherwise. Limits come from the plugin's server: its `usage_limits` RPC finds every bb usage source (`provider-usage.v1` RPC: the provider plugins and Account Pooler), reads each one's cached measurement for the thread's provider without forcing a new provider check, and returns the most recent successful one. One source can be throttled by Anthropic while another still has fresh numbers. The server caches the answer for 30 s; the frontend asks once a minute and after each finished turn, shared by all composers of a window. When no source has numbers, the last good ones stay on screen dimmed, with the error in the tooltip.

The bar shows in thread composers and in the new-thread composer (limits only, for the selected provider). Colors follow the thresholds of the Claude Code status line script `~/.claude/statusline-command.sh`: `ctx` is green below 40%, yellow from 40%, red from 50%; limit windows are green below 50%, yellow from 50%, red from 80%. The label, meter and percent take the color, the rest stays muted.

## Develop

```
npm install
bb plugin install .   # registers this directory in place
bb plugin dev         # rebuild and reload on every save
```
