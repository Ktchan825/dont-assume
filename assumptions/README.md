# Assumptions

See what the AI assumed while working with you, grouped by the problem you are trying to solve.

After each reply, the mod asks the AI which things it took as true without you saying so or a tool confirming them. They appear as cards, one per problem.

## What you can do

- **Open the list.** Click the line above the prompt box, or run `/assumptions`. Press Esc to close it.
- **Correct an assumption.** Press **Edit**, change the text and save. The AI is told about the correction and treats it as true from its next reply. Edited rows are marked and kept.
- **Refresh a problem.** Press **Refresh** on a card. The AI re-checks that problem against the whole conversation, dropping what has since been settled and adding anything new.
- **Remove** a single assumption from its edit row, or a whole card from its header.
- **Switch view.** `/assumptions-mode all` shows every topic discussed, across projects and sessions. `/assumptions-mode project` shows only the current project. With no argument it switches. Your choice is remembered.

Labels follow the language of the conversation (English or Chinese). On the mobile app the list is read-only.

## Good to know

- Collecting assumptions makes one extra model call after each reply, and Refresh makes one per press. Both reuse the prompt cache and count toward your session's usage. `/assumptions off` stops collecting in every chat and keeps the list; `/assumptions on` starts it again.
- The list is the AI's own account, made after the fact, so it can miss things. Treat it as a prompt to check, not as a complete record.
- The list is kept on your machine across sessions, up to the latest 200 cards. Subagents and interrupted turns are not collected.
- Refresh appears only on cards touched in the current conversation, because it re-checks against that conversation.
- Git worktrees count as the repository they belong to. Outside git, a project is its folder.

## License

MIT
