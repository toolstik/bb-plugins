Open Obsidian notes from bb chats in Obsidian.

## What you get

- In threads whose workspace lies inside an Obsidian vault, agents get an instruction to write every note they mention as a Markdown file link: `[Note Name](<path/to/Note Name.md>)`.
- A plain click on a chat link to a note of a vault opens the note in Obsidian. If a tab already shows that note, Obsidian switches to it; otherwise the note opens in a new tab (or in the active tab when it is empty). bb's panel stays as it is.
- Every other link, including Markdown files outside a vault, opens the way bb opens it by default. Cmd/Ctrl/Shift/Alt-click and the right-click menu are left to bb too.

## How it works

The plugin reads the list of vaults from Obsidian's own registry (`obsidian.json`), so it needs no settings. A workspace counts as a vault when it lies inside a registered vault folder. bb renders a chat link to a local file with a `file://` address; the plugin catches the click on such a link before bb, and when the file is a `.md` note inside a vault (not under `.obsidian/`), opens it in Obsidian.

The `obsidian://` URI cannot tell whether a note is already open, so the plugin opens notes through the Obsidian CLI (`obsidian-cli eval`, which runs a short script inside the running app) and then raises the vault's window with `obsidian://open?vault=...`. When the CLI is missing or Obsidian is not running, the plugin falls back to `obsidian://open?path=...&paneType=tab`, which always opens a new tab. The CLI needs Obsidian 1.12 or newer with the command line interface turned on in Obsidian's settings.

The server must run on the same machine as Obsidian. Instructions apply when an agent session starts, so a session that was already running picks them up after a restart.
