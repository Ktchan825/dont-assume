# Pending

A todo list for Claude: what is still pending in each of your chats, in one place.

After each reply, the mod asks Claude what is still open in that chat: work it left unfinished, follow-ups, and anything waiting on you. Each chat gets one card, and items leave by themselves once Claude says they are done.

## What you can do

- **Open the list.** It opens by itself in each new chat when the window is wide enough. Otherwise click the line above the prompt box, or run `/pending`.
- **Close it.** Press Esc or close the pane. New chats then leave it closed until you open it again.
- **Do it.** Sends the item to Claude in the chat you are in. Only offered for items from the current project.
- **Done.** Removes the item, and Claude will not list it again in that chat.
- **Add.** Type your own item. It stays until you press Do it or Done.

## Good to know

- Each reply costs one extra model call, which reuses the prompt cache. `/pending off` stops it in every chat and keeps the list; `/pending on` starts it again.
- The list is Claude's own account, so it can miss things or list too much.
- The list is kept on your machine, for the latest 100 chats. New items from another open chat appear within about 15 seconds.
- Subagents and interrupted turns are not collected.

## License

MIT
