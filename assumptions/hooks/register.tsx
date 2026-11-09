import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Assumption, Locale, Mode, Problem } from '../types'

const PANE = 'assumptions'
const problems = atom({ plugin: 'assumptions', key: 'problems' } as const, [], {
  shape: 'problems-2',
})
const updating = atom({ plugin: 'assumptions', key: 'updating' } as const, [])
const editing = atom({ plugin: 'assumptions', key: 'editing' } as const, null)
const locale = atom({ plugin: 'assumptions', key: 'locale' } as const, 'en')
const mode = atom({ plugin: 'assumptions', key: 'mode' } as const, 'all')
const STORE = 'problems'
const STORE_MODE = 'mode'
const STORE_LOCALE = 'locale'
const POLL_MS = 15_000
const many = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const STRINGS = {
  en: {
    title: 'AI assumptions',
    empty: 'No assumptions yet. They appear here after the AI replies.',
    summary: (scope: string, p: number, a: number) =>
      `${scope} · ${many(p, 'problem')} · ${many(a, 'assumption')}`,
    allTopics: 'All topics',
    inProject: (name: string) => `Project: ${name}`,
    modeAll: 'Now showing every topic discussed.',
    modeProject: (name: string) => `Now showing project ${name} only.`,
    modeUsage: 'Usage: /assumptions-mode [all|project]. With no argument it switches.',
    earlier: 'earlier session',
    notSaved: 'Could not save the list; it will be lost when this session ends.',
    band: (p: number, a: number) =>
      `${many(a, 'assumption')} across ${many(p, 'problem')} · View`,
    allClear: 'No open assumptions.',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    remove: 'Remove',
    edit: 'Edit',
    edited: 'edited',
    save: 'Save',
    cancel: 'Cancel',
    opened: 'Opened the assumptions list.',
    failed: (why: string) => `Could not update assumptions (${why})`,
    notTold: 'Saved, but the AI could not be told about this edit.',
  },
  zh: {
    title: 'AI 做過的假設',
    empty: '暫時未有假設，AI 回覆後會自動加入。',
    summary: (scope: string, p: number, a: number) =>
      `${scope} · ${p} 個問題 · ${a} 個假設`,
    allTopics: '全部話題',
    inProject: (name: string) => `項目：${name}`,
    modeAll: '現在顯示所有討論過的話題。',
    modeProject: (name: string) => `現在只顯示項目 ${name}。`,
    modeUsage: '用法：/assumptions-mode [all|project]。不加參數就切換。',
    earlier: '較早的對話',
    notSaved: '未能儲存清單，這個對話結束後會遺失。',
    band: (p: number, a: number) => `${p} 個問題 · ${a} 個假設 · 查看`,
    allClear: '沒有待確認的假設。',
    refresh: '更新',
    refreshing: '更新中…',
    remove: '移除',
    edit: '修改',
    edited: '已修改',
    save: '儲存',
    cancel: '取消',
    opened: '已打開假設清單。',
    failed: (why: string) => `未能更新假設（${why}）`,
    notTold: '已儲存，但未能通知 AI 這次修改。',
  },
} as const

const strings = async ($: EngineInterface) => STRINGS[await read($, locale)]

const make = (text: string): Assumption => ({
  id: crypto.randomUUID(),
  text,
  isEdited: false,
})
const sameTitle = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase()
const asList = (problem: Problem) =>
  `## ${problem.title}\n${problem.assumptions.map(a => `- ${a.text}`).join('\n')}`

const collectPrompt = (answer: string, known: string) =>
  `Do not continue the task. List the assumptions behind your reply below: things you took as true that the user did not state and no tool result confirmed (about requirements, intent, environment, data, scope).
Group them by the problem the user is trying to solve: a line "## <problem, at most 8 words>", then one "- <assumption>" line each, short, in the language the user writes in.
When a problem is already in the known list, reuse its title word for word. Skip assumptions already known. Output only those lines. If there are none, reply NONE.

<known>
${known}
</known>

<reply>
${answer}
</reply>`

const refreshPrompt = (problem: Problem, answer: string) => {
  const fixed = problem.assumptions.filter(a => a.isEdited)
  const open = problem.assumptions.filter(a => !a.isEdited)

  return `Do not continue the task. Re-check the assumptions below for the problem "${problem.title}" against the whole conversation so far.
Leave out any that were since confirmed, disproved or no longer matter; if the conversation says nothing about one, keep it. Keep the wording of those still open, and add any new ones. The user set the "fixed" ones: take them as true and do not repeat them.
Output only one "- <assumption>" line each, short, in the language the user writes in. If none remain open, reply NONE.

<open>
${open.map(a => `- ${a.text}`).join('\n')}
</open>

<fixed>
${fixed.map(a => `- ${a.text}`).join('\n')}
</fixed>

<latest-reply>
${answer}
</latest-reply>`
}

type Group = { title: string; lines: string[] }

const parse = (text: string) => {
  const groups: Group[] = []

  for (const line of text.split('\n')) {
    const heading = line.match(/^\s*#+\s+(.+)$/)?.[1]?.trim()
    const item = line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim()

    if (heading) {
      groups.push({ title: heading, lines: [] })
    } else if (item) {
      if (groups.length === 0) {
        groups.push({ title: 'General', lines: [] })
      }
      groups[groups.length - 1]?.lines.push(item)
    }
  }

  return groups
}

const merge = (
  list: readonly Problem[],
  groups: readonly Group[],
  project: string,
  sessionId: string,
) => {
  const seen = new Set(
    list
      .filter(p => p.project === project)
      .flatMap(p => p.assumptions.map(a => a.text)),
  )
  const merged = list.map(p => ({ ...p, assumptions: [...p.assumptions] }))

  for (const group of groups) {
    const fresh = group.lines.filter(text => !seen.has(text) && seen.add(text))

    if (fresh.length === 0) {
      continue
    }

    let problem = merged.find(
      p => p.project === project && sameTitle(p.title, group.title),
    )

    if (!problem) {
      problem = {
        id: crypto.randomUUID(),
        title: group.title,
        assumptions: [],
        project,
        sessionId,
      }
      merged.push(problem)
    }

    problem.sessionId = sessionId
    problem.assumptions.push(...fresh.map(make))
  }

  return merged
}

// Edited rows stay as the user wrote them; the rest become what the model said
// is still open, keeping the id of any line it repeated.
const rebuilt = (problem: Problem, lines: readonly string[]): Problem => {
  const fixed = problem.assumptions.filter(a => a.isEdited)
  const taken = new Set(fixed.map(a => a.text))
  const open = lines.filter(text => !taken.has(text) && taken.add(text))

  return {
    ...problem,
    assumptions: [
      ...fixed,
      ...open.map(
        text => problem.assumptions.find(a => a.text === text) ?? make(text),
      ),
    ],
  }
}

const open = async ($: EngineInterface) =>
  $.ui.open({
    id: PANE,
    title: (await strings($)).title,
    focus: true,
    closeOnEscape: true,
  })

// The fork replays the last request, which predates the final reply, so the
// reply has to travel in the prompt.
let lastAnswer = ''
let project = ''
let queue: Promise<void> = Promise.resolve()

const projectOf = async ($: EngineInterface, cwd: string) => {
  // The common dir, so a worktree counts as the repository it belongs to.
  const git = await $.process
    .run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    .catch(() => undefined)

  return git?.exitCode === 0 ? git.stdout.trim().replace(/\/\.git$/, '') : cwd
}

const nameOf = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const stored = async ($: EngineInterface) => {
  const value = await $.store.get(STORE)

  return Array.isArray(value) ? (value as Problem[]) : []
}

// Other sessions write to the same store. Only a real change may redraw.
const load = async ($: EngineInterface) => {
  const list = await stored($)

  if (JSON.stringify(list) !== JSON.stringify(await read($, problems))) {
    await update($, problems, () => list)
  }
}

// The store is the truth, so another session's cards survive this one's write.
// ponytail: two sessions writing in the same instant can still lose one write;
// the store has no compare-and-set to close that.
const change = ($: EngineInterface, fn: (list: readonly Problem[]) => Problem[]) => {
  queue = queue
    .catch(() => undefined)
    .then(async () => {
      const changed = fn(await stored($)).slice(-200)
      await update($, problems, () => changed)

      try {
        await $.store.set(STORE, changed)
      } catch {
        $.ui.toast((await strings($)).notSaved)
      }
    })

  return queue
}

const visible = async ($: EngineInterface) => {
  const list = await read($, problems)

  return (await read($, mode)) === 'project'
    ? list.filter(p => p.project === project)
    : list
}

const collect = async ($: EngineInterface, answer: string) => {
  // ponytail: any CJK reply reads as zh, so Japanese gets the zh labels; add
  // a language option when another locale is wanted.
  const found: Locale = /[㐀-鿿]/.test(answer) ? 'zh' : 'en'

  if (found !== (await read($, locale))) {
    await update($, locale, () => found)
    await $.store.set(STORE_LOCALE, found).catch(() => undefined)
  }

  const sessionId = await $.session.id()
  // Only this session's rows go in full: the prompt is paid for every turn.
  const known = (await read($, problems))
    .filter(p => p.project === project)
    .map(p => (p.sessionId === sessionId ? asList(p) : `## ${p.title}`))
    .join('\n')
  const reply = await $.model.fork({ prompt: collectPrompt(answer, known) })

  if (!reply.isAnswered) {
    if (reply.reason !== 'nothing-to-fork') {
      $.ui.log(`assumptions: ${(await strings($)).failed(reply.reason)}`)
    }

    return
  }

  const groups = parse(reply.text)

  if (groups.length > 0) {
    await change($, list => merge(list, groups, project, sessionId))
  }
}

const refresh = async ($: EngineInterface, id: string) => {
  const problem = (await read($, problems)).find(p => p.id === id)

  if (!problem || (await read($, updating)).includes(id)) {
    return
  }

  const t = await strings($)
  await update($, updating, list => [...list, id])

  try {
    const reply = await $.model.fork({
      prompt: refreshPrompt(problem, lastAnswer),
    })

    if (!reply.isAnswered) {
      $.ui.toast(t.failed(reply.reason))

      return
    }

    const lines = parse(reply.text).flatMap(group => group.lines)

    // No list and no NONE is a reply gone wrong, not an all-clear.
    if (lines.length === 0 && !/\bNONE\b/.test(reply.text)) {
      $.ui.toast(t.failed('unreadable reply'))

      return
    }

    await change($, list =>
      list.map(p => (p.id === id ? rebuilt(p, lines) : p)),
    )
  } finally {
    await update($, updating, list => list.filter(one => one !== id))
  }
}

const save = async (
  $: EngineInterface,
  problem: Problem,
  row: Assumption,
  value: string,
) => {
  const text = value.trim()
  await update($, editing, () => null)

  if (text === '' || text === row.text) {
    return
  }

  await change($, list =>
    list.map(p =>
      p.id !== problem.id
        ? p
        : {
            ...p,
            assumptions: p.assumptions.map(a =>
              a.id === row.id ? { ...a, text, isEdited: true } : a,
            ),
          },
    ),
  )

  // Another project's card means nothing to this conversation.
  if (problem.project !== project) {
    return
  }

  // A correction the model never reads would change only the screen.
  const told = await $.session
    .append({
      message: {
        type: 'user',
        content: [
          {
            type: 'text',
            text: `The user corrected an assumption you made. Treat the corrected version as true from now on.\nAssumed: ${row.text}\nCorrected: ${text}`,
          },
        ],
      },
    })
    .catch(() => ({ deny: 'failed' }))

  if ('deny' in told) {
    $.ui.toast((await strings($)).notTold)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'assumptions',
      description: 'Show the assumptions the AI made, grouped by problem',
    })
    await $.command.register({
      name: 'assumptions-mode',
      description: 'Switch the assumptions list between all topics and this project',
      argumentHint: '[all|project]',
    })
    project = await projectOf($, e.cwd)
    await load($)
    $.clock.every(POLL_MS, () => void load($))
    const savedLocale = await $.store.get(STORE_LOCALE)

    if (savedLocale === 'en' || savedLocale === 'zh') {
      await update($, locale, () => savedLocale)
    }

    const savedMode = await $.store.get(STORE_MODE)

    if (savedMode === 'all' || savedMode === 'project') {
      await update($, mode, () => savedMode)
    }

    // A reload drops any refresh that was running; its mark must not stay.
    await update($, updating, () => [])
    await update($, editing, () => null)

    return next(e)
  })

  on('command.run', { command: 'assumptions' }, async $ => {
    await open($)

    return { text: (await strings($)).opened }
  })

  on('command.run', { command: 'assumptions-mode' }, async ($, e) => {
    const t = await strings($)
    const wanted = e.args.trim()

    if (wanted !== '' && wanted !== 'all' && wanted !== 'project') {
      return { text: t.modeUsage }
    }

    const current = await read($, mode)
    const chosen: Mode = wanted || (current === 'all' ? 'project' : 'all')
    await update($, mode, () => chosen)
    await $.store.set(STORE_MODE, chosen)

    return { text: chosen === 'all' ? t.modeAll : t.modeProject(nameOf(project)) }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer' && e.answer !== '') {
      lastAnswer = e.answer
      // On a timer, so the turn ends without waiting for the extra model call.
      $.clock.after(0, () => void collect($, e.answer))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await visible($)
    const count = list.reduce((sum, p) => sum + p.assumptions.length, 0)

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
          {t.band(list.length, count)}
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // The mobile app has no text field, so its rows stay read-only.
    const Input = 'Input' in elements ? elements.Input : undefined
    const list = await visible($)
    const shownMode = await read($, mode)
    const sessionId = await $.session.id()
    const busy = await read($, updating)
    const edited = await read($, editing)
    const t = await strings($)

    const scope =
      shownMode === 'all' ? t.allTopics : t.inProject(nameOf(project))

    if (list.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>{scope}</Text>
          <Text dimColor>{t.empty}</Text>
        </Box>
      )
    }

    const count = list.reduce((sum, p) => sum + p.assumptions.length, 0)

    const drawRow = (problem: Problem, row: Assumption) =>
      Input && edited === row.id ? (
        <Box key={`row:${row.id}`} flexDirection="column" gap={1}>
          <Input
            key={`input:${row.id}`}
            value={row.text}
            submitLabel={t.save}
            autoFocus
            onSubmit={value => save($, problem, row, value)}
          />
          <Box gap={1}>
            <Button
              key={`cancel:${row.id}`}
              label={t.cancel}
              onPress={() => update($, editing, () => null)}
            />
            <Button
              key={`remove:${row.id}`}
              label={t.remove}
              onPress={async () => {
                await update($, editing, () => null)
                await change($, all =>
                  all.map(p =>
                    p.id !== problem.id
                      ? p
                      : {
                          ...p,
                          assumptions: p.assumptions.filter(
                            a => a.id !== row.id,
                          ),
                        },
                  ),
                )
              }}
            />
          </Box>
        </Box>
      ) : (
        <Box key={`row:${row.id}`} gap={1} justifyContent="space-between">
          <Box flexShrink={1} flexGrow={1}>
            <Text>• {row.text}</Text>
          </Box>
          <Box gap={1} flexShrink={0} alignItems="center">
            {row.isEdited && <Text color="success">{t.edited}</Text>}
            {Input && (
              <Button
                key={`edit:${row.id}`}
                label={t.edit}
                onPress={() => update($, editing, () => row.id)}
              />
            )}
          </Box>
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>{t.summary(scope, list.length, count)}</Text>
        {list.map(problem => (
          <Box
            key={`card:${problem.id}`}
            flexDirection="column"
            gap={1}
            borderStyle="round"
            borderDimColor
            paddingX={1}
          >
            <Box gap={1} justifyContent="space-between" alignItems="center">
              <Box flexShrink={1} flexGrow={1} flexDirection="column">
                <Text bold>{problem.title}</Text>
                {problem.project !== project && (
                  <Text dimColor>{nameOf(problem.project)}</Text>
                )}
              </Box>
              <Box gap={1} flexShrink={0} alignItems="center">
                {problem.sessionId !== sessionId ? (
                  <Text dimColor>{t.earlier}</Text>
                ) : busy.includes(problem.id) ? (
                  <Text dimColor>{t.refreshing}</Text>
                ) : (
                  <Button
                    key={`refresh:${problem.id}`}
                    label={t.refresh}
                    variant="primary"
                    onPress={() => refresh($, problem.id)}
                  />
                )}
                <Button
                  key={`drop:${problem.id}`}
                  label={t.remove}
                  onPress={() =>
                    change($, all =>
                      all.filter(p => p.id !== problem.id),
                    )
                  }
                />
              </Box>
            </Box>
            {problem.assumptions.length === 0 && (
              <Text dimColor>{t.allClear}</Text>
            )}
            {problem.assumptions.map(row => drawRow(problem, row))}
          </Box>
        ))}
      </Box>
    )
  })
}
