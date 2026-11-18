# bb-plugin-statusline

A bb plugin that adds a one-line status bar above the composer, like the Claude Code status line:

- `ctx` - how full the thread's context window is: percent and used/total tokens. The tooltip shows exact numbers, whether bb estimated them, and the auto-compaction threshold when the provider reports one.
- `5h`, `7d` - percent of the subscription window used and the local time it resets: `↻ 03:00`; `7d` adds the date when the reset is not today: `↻ 09.10 03:00`.

A model-specific window (the Fable weekly limit) shows only while the thread runs that model, and then replaces the general window of the same kind only when it is more used. The thread's model is the composer's model picker, else the model of the latest requested turn. The tooltip names which window is shown.

Context usage comes from `sdk.threads.context` and is polled every 5 s while the agent runs, every minute otherwise. Limits come from the plugin's server: its `usage_limits` RPC finds every bb usage source (`provider-usage.v1` RPC: the provider plugins and Account Pooler), reads each one's cached measurement for the thread's provider without forcing a new provider check, and returns the most recent successful one. One source can be throttled by Anthropic while another still has fresh numbers. The server caches the answer for 30 s; the frontend asks once a minute and after each finished turn, shared by all composers of a window. On a failed refresh the last good measurement stays on screen, and its forecast remains visible until the period ends. The tooltip shows the refresh error.

The bar shows in thread composers and in the new-thread composer (limits only, for the selected provider). Context usage is green below 65%, yellow from 65% to below 80%, and red from 80%. Limit meter fill and the displayed percentage show actual usage.

## Develop

```
npm install
bb plugin install .   # registers this directory in place
bb plugin dev         # rebuild and reload on every save
```

LiteLLM Agents 0.1.2 exposes key/user dollar budgets through the same usage contract. For a custom monetary window the label is the API-provided dollar limit (for example `$30`), followed by the used percent; spent dollars appear only in the tooltip with precise amounts. These are shared account expenses, including other LiteLLM clients. Existing five-hour and weekly labels remain unchanged.

Segment details use a portaled tooltip on hover or keyboard focus, with a 200 ms hover delay and Escape to dismiss. Spending remains inside the tooltip.

From 10% actual usage, the limit meter, percentage, and label follow the forecast when available and actual usage otherwise. Both use the same thresholds before rounding. The color is green through 80%, yellow above 80% and below 98%, and red from 98%. The forecast indicator shows a yellow triangle or a red circle for the corresponding forecast zone. Below 10% actual usage the meter, percentage, and label stay green, and the warning icon still shows the forecast risk.

The tooltip shows the projected percentage and any expected excess above 100%. The calculation divides the used percentage by the fraction of the quota period elapsed. For example, 60% used halfway through projects 120%, or 20% over the allowance. Five-hour, daily, and weekly windows start one known duration before their reset time. The calculation uses the provider's measurement time or, if missing, the time the plugin received the measurement. It requires a known duration and a valid reset time in the future. No usage history is collected.

Run forecast checks with `node --experimental-strip-types --test forecast.test.ts` (Node 22.6+).
