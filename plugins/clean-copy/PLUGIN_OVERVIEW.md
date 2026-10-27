Copy text out of bb chats without the app's colors and backgrounds.

## What you get

- Copying a selection from the bb window puts clean rich text on the clipboard: paragraphs, headings, lists, bold, italic, links, tables and code blocks keep their structure, while text color, background, fonts and syntax highlighting are dropped.
- Plain text on the clipboard stays the same as before.

## How it works

A frontend content script handles the copy event, rebuilds the selection from semantic tags only and replaces the clipboard HTML. Inputs, the composer, terminals and code editors keep their own copy behavior. Nothing leaves the machine.
