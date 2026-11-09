import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'assumptions',
  component: 'Pane',
  requestId: 'assumptions',
  props: {
    title: 'AI assumptions',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const TURN = {
  durationMs: 1,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
} as const

const usage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

// What every test needs beneath the plugin: a project, a session and a store.
const world = (on: On, entries: Record<string, unknown> = {}) => {
  mock.store(on, entries)
  on('session.id', () => ({ value: 's1' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '/work/alpha/.git\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
}

// A person's command also carries origin and presentation, which this mod ignores.
const runMode = (
  $: { command: { run: (input: never) => Promise<{ text?: string }> } },
  args: string,
) =>
  $.command.run({ command: 'assumptions-mode', args } as never)

const START = { cwd: '/work/alpha', surface: 'desktop', isInteractive: true } as const

const card = (title: string, project: string, sessionId: string) => ({
  id: title,
  title,
  project,
  sessionId,
  assumptions: [{ id: `${title}-1`, text: `${title} rule`, isEdited: false }],
})

const answers = (on: On, replies: string[]) => {
  const asked: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('model.fork', (_, e) => {
    asked.push(e.prompt)

    return { value: { isAnswered: true, text: replies.shift() ?? 'NONE', usage } }
  })

  return asked
}

const keyOf = async (
  ui: { find: (q: { type: 'Button'; text: RegExp }) => Promise<unknown> },
  text: RegExp,
) => ((await ui.find({ type: 'Button', text })) as { key: string }).key

test('a reply groups its assumptions under problems, without repeats', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  const asked = answers(on, [
    'Here you go\n## Login page\n- Uses Next.js\n- Uses Next.js\n## Billing\n- Stripe test mode',
    '## login page\n- Uses Next.js\n- Email only',
  ])

  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: 'final reply' })
  await clock.advance(1)
  await $.turn.complete({ ...TURN, answer: 'second reply' })
  await clock.advance(1)

  expect(asked[0]).toContain('final reply')
  expect(asked[1]).toContain('## Login page')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /2 problems/ }))?.text).toBe(
      'All topics · 2 problems · 3 assumptions',
    )
    expect(await ui.find({ type: 'Text', text: /Email only/ })).toBeDefined()
    await ui.unmount()
  }
})

test('an edit is kept through a refresh and reaches the model', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  const rows = mock.session(on)
  const asked = answers(on, [
    '## Login\n- Uses Next.js\n- Email only',
    '- Email only\n- Runs on Vercel',
  ])

  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: 'final reply' })
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const edit = await keyOf(ui, /Edit/)
  await ui.press({ key: edit })
  await ui.input({ key: edit.replace('edit:', 'input:'), text: 'Uses Remix' })

  expect(JSON.stringify(rows.appended())).toContain('Corrected: Uses Remix')

  await ui.press({ key: await keyOf(ui, /Refresh/) })

  expect(asked[1]).toContain('final reply')
  expect(await ui.find({ type: 'Text', text: /Uses Remix/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Runs on Vercel/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Uses Next/ })).toBeUndefined()
  await ui.unmount()
})

test('a failed refresh keeps the list and frees the button', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  const replies = [
    { isAnswered: true, text: '## Login\n- Uses Next.js', usage },
    { isAnswered: false, reason: 'empty-reply', usage },
  ]
  on('turn.complete', () => ({ text: '' }))
  on('model.fork', () => ({ value: replies.shift() as never }))

  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: 'final reply' })
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: await keyOf(ui, /Refresh/) })

  expect(await ui.find({ type: 'Text', text: /Uses Next/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Refresh/ })).toBeDefined()
  await ui.unmount()
})

test('a Chinese reply switches the labels', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  answers(on, ['## 登入\n- 用 Next.js'])

  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: '完成咗' })
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /更新/ })).toBeDefined()
  await ui.unmount()
})

test('a subagent or an interrupted turn asks nothing', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  const asked = answers(on, [])

  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: 'x', agentId: 'a1' })
  await $.turn.complete({ ...TURN, answer: 'x', reason: 'aborted', isAborted: true })
  await clock.advance(1)

  expect(asked.length).toBe(0)
})

test('the mode command narrows the list to this project and back', async ($, on) => {
  world(on, {
    problems: [card('Ours', '/work/alpha', 's0'), card('Theirs', '/work/beta', 's0')],
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Theirs rule/ })).toBeDefined()

  const said = await runMode($, 'project')
  expect(said.text).toContain('alpha')
  expect(await ui.find({ type: 'Text', text: /Theirs rule/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Ours rule/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Project: alpha/ })).toBeDefined()

  await runMode($, '')
  expect(await ui.find({ type: 'Text', text: /Theirs rule/ })).toBeDefined()

  const wrong = await runMode($, 'nope')
  expect(wrong.text).toContain('Usage')
  await ui.unmount()
})

test('a saved mode comes back in the next session', async ($, on) => {
  world(on, { mode: 'project', problems: [card('Theirs', '/work/beta', 's0')] })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Theirs rule/ })).toBeUndefined()
  await ui.unmount()
})

test('a card from an earlier session cannot be refreshed', async ($, on) => {
  world(on, { problems: [card('Old', '/work/alpha', 's0')] })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Button', text: /Refresh/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /earlier session/ })).toBeDefined()
  await ui.unmount()
})

test('a new reply keeps the cards of other projects', async ($, on) => {
  const clock = mock.clock(on)
  world(on, { problems: [card('Theirs', '/work/beta', 's0')] })
  answers(on, ['## Ours\n- New rule'])

  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: 'final reply' })
  await clock.advance(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Theirs rule/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /New rule/ })).toBeDefined()
  await ui.unmount()
})

test('an empty list says so', async ($, on) => {
  world(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /No assumptions yet/ })).toBeDefined()
  await ui.unmount()
})
