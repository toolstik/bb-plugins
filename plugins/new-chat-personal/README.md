# bb-plugin-new-chat-personal

bb remembers the project of the last root composer, and the New thread shortcut takes the project of the thread you are looking at. So the sidebar New thread button often opens a chat inside some project. This plugin makes it always open a chat without a project.

What changes:

- A plain click on New thread in the sidebar opens the composer with no project. Cmd/Ctrl+click (open in split) stays as is.
- The "New chat without project" command does the same from the keyboard or the palette.

What stays: the + next to a project starts a chat in that project, and the composer's project picker works as usual.

## Install

```
bb plugin install new-chat-personal@toolstik
```

On its first load the plugin moves Cmd+Shift+O from bb's own New thread (which picks the current thread's project) to its "New chat without project" command. It does this once per install, so a shortcut you change later in Settings → Keyboard stays as you set it.

## Remove

```
bb plugin disable new-chat-personal
bb settings keyboard reset thread.new
bb settings keyboard reset plugin:new-chat-personal/new-chat
```
