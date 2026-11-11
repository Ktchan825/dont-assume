# dont-assume

Two mods that keep you in step with what Claude is doing.

| Mod | What it does |
| --- | --- |
| [assumptions](./assumptions) | Lists what the AI assumed, grouped by the problem you are solving. Correct any line and the AI is told. |
| [pending](./pending) | A todo list for Claude: what is still open in each of your chats, in one place. |

## Install

At the prompt of a terminal session:

```
/plugin install assumptions --marketplace Ktchan825/dont-assume
/plugin install pending --marketplace Ktchan825/dont-assume
```

Answer `y` to add the marketplace, then choose a scope.

From a shell:

```bash
claude plugin install assumptions --marketplace Ktchan825/dont-assume
```

```bash
claude plugin install pending --marketplace Ktchan825/dont-assume
```

In the desktop app, click + next to the prompt box, then Plugins, Add marketplace with `Ktchan825/dont-assume`, then Add plugin.

## Before you install

- Each mod makes one extra model call after every reply, which counts toward your usage. Turn it off in every chat with `/assumptions off` or `/pending off`, and back on with `on`.
- Short summaries of your conversations are stored on your own machine, under `~/.claude/plugins/store/`. Neither mod sends them anywhere else.
- Both lists are the AI's own account, so they can miss things.

## License

MIT
