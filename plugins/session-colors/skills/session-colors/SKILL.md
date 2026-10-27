---
name: session-colors
description: Set, clear, or read a bb thread's color tag (a colored dot before the title in the sidebar and in the thread header) when the user asks to color, mark, or tag a session or thread.
---

# Session colors

A thread can carry one color tag. The sidebar shows a colored dot before its title and the thread header shows the same dot; the tag persists across restarts.

Colors: `red`, `orange`, `yellow`, `green`, `cyan`, `blue`, `purple`, `pink`.

```sh
bb session-colors set blue                    # color the thread running the command
bb session-colors set green --thread thr_abc  # color another thread
bb session-colors clear [--thread <id>]
bb session-colors get [--thread <id>] [--json]
bb session-colors list [--json]               # every colored thread
bb session-colors palette [--json]
```

Map the user's wording to the nearest palette color (for example "violet" is `purple`, "teal" is `cyan`). Without `--thread` the command targets the current thread.
