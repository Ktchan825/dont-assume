import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Chat, Locale, Todo } from '../types'

const PANE = 'pending'
const STORE = 'chats'
const STORE_LOCALE = 'locale'
// false once the person closes the list by hand; opening it again clears that.
const STORE_AUTO = 'autoOpen'
// false while collecting is off: no extra model call after each reply.
const STORE_COLLECT = 'collect'
const POLL_MS = 15_000
const chats = atom({ plugin: 'pending', key: 'chats' } as const, [], {
  shape: 'chats-1',
})
const locale = atom({ plugin: 'pending', key: 'locale' } as const, 'en')

const STRINGS = {
  en: {
    title: 'Claude to-do',
    empty: 'Nothing pending. Items appear here after Claude replies.',
    summary: (c: number, n: number) => `${n} pending · ${c} chat${c === 1 ? '' : 's'}`,
    band: (n: number) => `${n} pending for Claude · View`,
    thisChat: 'this chat',
    earlier: 'earlier chat',
    run: 'Do it',
    done: 'Done',
    add: 'Add',
    placeholder: 'Add a to-do for Claude',
    prompt: (text: string) => `Please do this pending item now: ${text}`,
    notSaved: 'Could not save the list; it will be lost when this session ends.',
    notSent: 'Could not send this to Claude.',
    failed: (why: string) => `Could not update pending items (${why})`,
    opened: 'Opened the to-do list.',
    off: 'Collecting is off in every chat: no extra model call after replies. The list stays. /pending on turns it back on.',
    on: 'Collecting is on: one extra model call after each reply.',
    usage: 'Usage: /pending [on|off]. With no argument it opens the list.',
  },
  zh: {
    title: 'Claude 待辦',
    empty: '暫時沒有待辦事項，Claude 回覆後會自動加入。',
    summary: (c: number, n: number) => `${n} 項待辦 · ${c} 個對話`,
    band: (n: number) => `Claude 有 ${n} 項待辦 · 查看`,
    thisChat: '目前對話',
    earlier: '較早的對話',
    run: '去做',
    done: '完成',
    add: '加入',
    placeholder: '加一項待辦給 Claude',
    prompt: (text: string) => `請現在處理這項待辦：${text}`,
    notSaved: '未能儲存清單，這個對話結束後會遺失。',
    notSent: '未能交給 Claude。',
    failed: (why: string) => `未能更新待辦（${why}）`,
    opened: '已打開待辦清單。',
    off: '已在所有對話停止收集：回覆後不再多一次 model call，清單保留。/pending on 可重新開啟。',
    on: '已開啟收集：每次回覆後多一次 model call。',
    usage: '用法：/pending [on|off]。不加參數就打開清單。',
  },
} as const

const strings = async ($: EngineInterface) => STRINGS[await read($, locale)]

const make = (text: string, isManual: boolean): Todo => ({
  id: crypto.randomUUID(),
  text,
  isManual,
})

const collectPrompt = (answer: string, chat: Chat | undefined) =>
  `Do not continue the task. List what is still pending in this conversation as of your reply below: work you said you would do or left unfinished, follow-ups, and anything waiting on the user. Leave out what is done or was dropped.
First a line "## <what this conversation is about, at most 8 words>", then one "- <pending item>" line each, short, in the language the user writes in. Keep the wording of any known item still open. Never list a dismissed item. Output only those lines. If nothing is pending, reply NONE.

<known>
${(chat?.todos ?? []).map(t => `- ${t.text}`).join('\n')}
</known>

<dismissed>
${(chat?.dismissed ?? []).map(text => `- ${text}`).join('\n')}
</dismissed>

<reply>
${answer}
</reply>`

const parse = (text: string) => {
  const lines = text.split('\n')
  const title = lines
    .map(line => line.match(/^\s*#+\s+(.+)$/)?.[1]?.trim())
    .find(Boolean)
  const items = lines.flatMap(line => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim() ?? [])

  return { title, items }
}

const nameOf = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const blank = (sessionId: string, project: string): Chat => ({
  sessionId,
  project,
  title: nameOf(project),
  todos: [],
  dismissed: [],
})

// Each reply restates what is open in its chat, so finished work leaves by
// itself. What the person added stays until they act on it.
const replaced = (
  list: readonly Chat[],
  sessionId: string,
  project: string,
  title: string | undefined,
  items: readonly string[],
) => {
  const current = list.find(c => c.sessionId === sessionId)

  if (!current && items.length === 0) {
    return [...list]
  }

  const chat = current ?? blank(sessionId, project)
  const manual = chat.todos.filter(t => t.isManual)
  const taken = new Set([...manual.map(t => t.text), ...chat.dismissed])
  const open = items.filter(text => !taken.has(text) && taken.add(text))

  return [
    ...list.filter(c => c.sessionId !== sessionId),
    {
      ...chat,
      title: title ?? chat.title,
      todos: [
        ...manual,
        ...open.map(text => chat.todos.find(t => t.text === text) ?? make(text, false)),
      ],
    },
  ]
}

const withChat = (
  list: readonly Chat[],
  sessionId: string,
  project: string,
  fn: (chat: Chat) => Chat,
) => [
  ...list.filter(c => c.sessionId !== sessionId),
  fn(list.find(c => c.sessionId === sessionId) ?? blank(sessionId, project)),
]

let lastProject = ''
let added = 0
let queue: Promise<void> = Promise.resolve()

const projectOf = async ($: EngineInterface, cwd: string) => {
  // The common dir, so a worktree counts as the repository it belongs to.
  const git = await $.process
    .run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    .catch(() => undefined)

  return git?.exitCode === 0 ? git.stdout.trim().replace(/\/\.git$/, '') : cwd
}

const stored = async ($: EngineInterface) => {
  const value = await $.store.get(STORE)

  return Array.isArray(value) ? (value as Chat[]) : []
}

const countOf = (list: readonly Chat[]) =>
  list.reduce((sum, c) => sum + c.todos.length, 0)

// Other chats write to the same store. Only a real change may redraw.
const load = async ($: EngineInterface) => {
  const list = await stored($)

  if (JSON.stringify(list) !== JSON.stringify(await read($, chats))) {
    await update($, chats, () => list)
  }
}

// ponytail: two chats writing in the same instant can lose one write; the store
// has no compare-and-set to close that.
const change = ($: EngineInterface, fn: (list: readonly Chat[]) => Chat[]) => {
  queue = queue
    .catch(() => undefined)
    .then(async () => {
      const list = fn(await stored($)).slice(-100)
      await update($, chats, () => list)

      try {
        await $.store.set(STORE, list)
      } catch {
        $.ui.toast((await strings($)).notSaved)
      }
    })

  return queue
}

const collect = async ($: EngineInterface, answer: string) => {
  const found: Locale = /[㐀-鿿]/.test(answer) ? 'zh' : 'en'

  if (found !== (await read($, locale))) {
    await update($, locale, () => found)
    await $.store.set(STORE_LOCALE, found).catch(() => undefined)
  }

  const sessionId = await $.session.id()
  const chat = (await read($, chats)).find(c => c.sessionId === sessionId)
  const reply = await $.model.fork({ prompt: collectPrompt(answer, chat) })

  if (!reply.isAnswered) {
    if (reply.reason !== 'nothing-to-fork') {
      $.ui.log(`pending: ${(await strings($)).failed(reply.reason)}`)
    }

    return
  }

  const { title, items } = parse(reply.text)

  // No list and no NONE is a reply gone wrong, not an all-clear.
  if (items.length > 0 || /\bNONE\b/.test(reply.text)) {
    await change($, list => replaced(list, sessionId, lastProject, title, items))
  }
}

const finish = ($: EngineInterface, chat: Chat, todo: Todo) =>
  change($, list =>
    list.map(c =>
      c.sessionId !== chat.sessionId
        ? c
        : {
            ...c,
            todos: c.todos.filter(t => t.id !== todo.id),
            // Otherwise the next reply could list it again.
            dismissed: todo.isManual ? c.dismissed : [...c.dismissed, todo.text].slice(-50),
          },
    ),
  )

// The item joins this chat as Claude's own, so its next reply says whether it
// is still open.
const run = async ($: EngineInterface, chat: Chat, todo: Todo) => {
  const sessionId = await $.session.id()
  const t = await strings($)

  await change($, list =>
    withChat(
      list.map(c =>
        c.sessionId === chat.sessionId
          ? { ...c, todos: c.todos.filter(one => one.id !== todo.id) }
          : c,
      ),
      sessionId,
      lastProject,
      c => ({ ...c, todos: [...c.todos, { ...todo, isManual: false }] }),
    ),
  )

  await $.prompt.submit({ text: t.prompt(todo.text), asUser: true }).catch(() => {
    $.ui.toast(t.notSent)
  })
}

const add = async ($: EngineInterface, value: string) => {
  const text = value.trim()

  if (text === '') {
    return
  }

  const sessionId = await $.session.id()
  added += 1
  await change($, list =>
    withChat(list, sessionId, lastProject, c => ({
      ...c,
      todos: [...c.todos, make(text, true)],
    })),
  )
}

const open = async ($: EngineInterface) => {
  await load($)
  await $.store.set(STORE_AUTO, true).catch(() => undefined)

  return $.ui.open({
    id: PANE,
    title: (await strings($)).title,
    focus: true,
    closeOnEscape: true,
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pending',
      description: 'Show what is still pending across your chats; on/off switches collecting',
      argumentHint: '[on|off]',
    })
    lastProject = await projectOf($, e.cwd)
    const saved = await $.store.get(STORE_LOCALE)

    if (saved === 'en' || saved === 'zh') {
      await update($, locale, () => saved)
    }

    await load($)
    $.clock.every(POLL_MS, () => void load($))

    // Without focus, so it never takes the keyboard from the prompt. The
    // engine seats it only where the window is wide enough.
    if ((await $.store.get(STORE_AUTO)) !== false) {
      await $.ui.open({ id: PANE, title: (await strings($)).title, closeOnEscape: true })
    }

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      await $.store.set(STORE_AUTO, false).catch(() => undefined)
    }

    return next(e)
  })

  on('command.run', { command: 'pending' }, async ($, e) => {
    const t = await strings($)
    const wanted = e.args.trim().toLowerCase()

    if (wanted === 'on' || wanted === 'off') {
      await $.store.set(STORE_COLLECT, wanted === 'on')

      return { text: t[wanted] }
    }

    if (wanted !== '') {
      return { text: t.usage }
    }

    await open($)

    return { text: t.opened }
  })

  on('turn.complete', async ($, e, next) => {
    // Read each time, so switching it in another chat applies here too.
    const isOn = (await $.store.get(STORE_COLLECT).catch(() => true)) !== false

    if (isOn && e.agentId === undefined && e.reason === 'answer' && e.answer !== '') {
      // On a timer, so the turn ends without waiting for the extra model call.
      $.clock.after(0, () => void collect($, e.answer))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const count = countOf(await read($, chats))

    if (count === 0 || e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)
    const t = await strings($)
    // Wrapped, so another mod's band stays drawn beside this one.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        {below}
        <Button key="open" plain onPress={() => void open($)}>
          {t.band(count)}
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // The mobile app has no text field, so it cannot add items.
    const Input = 'Input' in elements ? elements.Input : undefined
    const sessionId = await $.session.id()
    const t = await strings($)
    const shown = (await read($, chats)).filter(c => c.todos.length > 0).reverse()

    const adder = Input && (
      <Input
        key={`add:${added}`}
        value=""
        placeholder={t.placeholder}
        submitLabel={t.add}
        onSubmit={value => add($, value)}
      />
    )

    if (shown.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          {adder}
          <Text dimColor>{t.empty}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {adder}
        <Text dimColor>{t.summary(shown.length, countOf(shown))}</Text>
        {shown.map(chat => (
          <Box
            key={`card:${chat.sessionId}`}
            flexDirection="column"
            gap={1}
            borderStyle="round"
            borderDimColor
            paddingX={1}
          >
            <Box gap={1} justifyContent="space-between" alignItems="center">
              <Box flexShrink={1} flexGrow={1}>
                <Text bold>{chat.title}</Text>
              </Box>
              <Text dimColor>
                {chat.project !== lastProject
                  ? nameOf(chat.project)
                  : chat.sessionId === sessionId
                    ? t.thisChat
                    : t.earlier}
              </Text>
            </Box>
            {chat.todos.map(todo => (
              <Box key={`row:${todo.id}`} gap={1} justifyContent="space-between">
                <Box flexShrink={1} flexGrow={1}>
                  <Text>• {todo.text}</Text>
                </Box>
                <Box gap={1} flexShrink={0} alignItems="center">
                  {/* Another project's work would run in the wrong folder here. */}
                  {chat.project === lastProject && (
                    <Button
                      key={`run:${todo.id}`}
                      label={t.run}
                      variant="primary"
                      onPress={() => run($, chat, todo)}
                    />
                  )}
                  <Button
                    key={`done:${todo.id}`}
                    label={t.done}
                    onPress={() => finish($, chat, todo)}
                  />
                </Box>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
