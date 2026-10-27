# bb-plugin-clean-copy

When you copy text from the bb window, the browser inlines the computed theme styles (text color, background, font) into the clipboard HTML, so pasting into Google Docs, Notion, Word or mail carries the dark theme along. This plugin replaces that HTML with a clean version of the selection.

Kept: paragraphs, headings, lists (including numbering start), bold, italic, underline, strikethrough, links, images, tables, blockquotes, inline code and code blocks. Task-list checkboxes become `[x]` / `[ ]`.

Quotes: text selected entirely inside a blockquote pastes as ordinary text, without the quote. A blockquote that is part of a larger selection keeps its quote formatting.

Dropped: every `style` and `class` attribute, color and font markup, syntax highlighting, buttons and icons.

Not touched: inputs, the composer, terminals and code editors.

To paste completely unformatted text use the target app's "Paste and Match Style" (`Cmd+Shift+V` / `Cmd+Option+Shift+V`).

## Install

```
bb plugin install git:https://github.com/toolstik/bb-plugins.git@main --subdirectory plugins/clean-copy
```

To return to the default browser behavior, disable the plugin in Settings → Plugins or with `bb plugin disable clean-copy`.
