import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'pending',
  component: 'Pane',
  requestId: 'pending',
  surface: 'desktop',
  props: {
    title: 'Claude to-do',
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

const START = { cwd: '/work/alpha', surface: 'desktop', isInteractive: true } as const

const usage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

const world = (on: On, entries: Record<string, unknown> | null = {}) => {
  if (entries) {
    mock.store(on, entries)
  }

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

const answers = (on: On, replies: string[]) => {
  const asked: string[] = []
  on('turn.complete', () => ({ text: '' }))
  on('model.fork', (_, e) => {
    asked.push(e.prompt)

    return { value: { isAnswered: true, text: replies.shift() ?? 'NONE', usage } }
  })

  return asked
}

const chat = (sessionId: string, project: string, text: string, isManual = false) => ({
  sessionId,
  project,
  title: `${text} chat`,
  todos: [{ id: `${text}-1`, text, isManual }],
  dismissed: [],
})

const keyOf = async (
  ui: { find: (q: { type: 'Button'; text: RegExp }) => Promise<unknown> },
  text: RegExp,
) => ((await ui.find({ type: 'Button', text })) as { key: string }).key

test('each reply restates what is open, so finished work leaves', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  const asked = answers(on, ['## Login\n- Add tests\n- Add tests\n- Deploy', '## Login\n- Deploy', 'NONE'])

  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: 'first' })
  await clock.advance(1)

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /pending ·/ }))?.text).toBe('2 pending · 1 chat')
  expect(await ui.find({ type: 'Text', text: /Login/ })).toBeDefined()

  await $.turn.complete({ ...TURN, answer: 'second' })
  await clock.advance(1)
  expect(asked[1]).toContain('- Add tests')
  expect(await ui.find({ type: 'Text', text: /Add tests/ })).toBeUndefined()

  await $.turn.complete({ ...TURN, answer: 'third' })
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: /Nothing pending/ })).toBeDefined()
  await ui.unmount()
})

test('a done item does not come back in that chat', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  const asked = answers(on, ['## Work\n- Deploy', '## Work\n- Deploy\n- Write docs'])

  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: 'first' })
  await clock.advance(1)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: await keyOf(ui, /Done/) })
  await $.turn.complete({ ...TURN, answer: 'second' })
  await clock.advance(1)

  expect(asked[1]).toContain('<dismissed>\n- Deploy')
  expect(await ui.find({ type: 'Text', text: /Deploy/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Write docs/ })).toBeDefined()
  await ui.unmount()
})

test('Do it hands an item from another chat to this one', async ($, on) => {
  world(on, { chats: [chat('s0', '/work/alpha', 'Fix bug')] })
  const sent: { text: string; asUser?: boolean }[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e as never)

    return { text: e.text }
  })

  await $.session.start(START)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /earlier chat/ })).toBeDefined()

  await ui.press({ key: await keyOf(ui, /Do it/) })

  expect(sent[0]?.text).toContain('Fix bug')
  expect(await ui.find({ type: 'Text', text: /this chat/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /earlier chat/ })).toBeUndefined()
  await ui.unmount()
})

test('another project shows its name and cannot be run here', async ($, on) => {
  world(on, { chats: [chat('s0', '/work/beta', 'Fix bug')] })

  await $.session.start(START)
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Text', text: /beta/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Do it/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /Done/ })).toBeDefined()
  await ui.unmount()
})

const BAND = {
  plugin: 'pending',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 60, scroll: { offset: 0, bodyRows: 10 } },
} as never

test('the band keeps what is drawn beneath it', async ($, on) => {
  world(on, { chats: [chat('s0', '/work/alpha', 'Deploy')] })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>other mod</Text>
  })

  await $.session.start(START)
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Button', text: /1 pending/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /other mod/ })).toBeDefined()
  await ui.unmount()
})

test('a change from another chat shows up without reopening', async ($, on) => {
  const clock = mock.clock(on)
  world(on, null)
  let onDisk: unknown[] = []
  on('store.get', (_, e) => ({ value: e.key === 'chats' ? onDisk : undefined }))

  await $.session.start(START)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Nothing pending/ })).toBeDefined()

  onDisk = [chat('s0', '/work/alpha', 'Deploy')]
  await clock.advance(15_000)

  expect(await ui.find({ type: 'Text', text: /Deploy/ })).toBeDefined()
  await ui.unmount()
})

test('the label language comes back in the next session', async ($, on) => {
  world(on, { locale: 'zh', chats: [chat('s0', '/work/alpha', 'Deploy')] })

  await $.session.start(START)
  const ui = await $.ui.mount(PANE)

  expect(await ui.find({ type: 'Button', text: /完成/ })).toBeDefined()
  await ui.unmount()
})

test('an item the person added survives a reply', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  answers(on, ['NONE'])

  await $.session.start(START)
  const ui = await $.ui.mount(PANE)
  await ui.input({ key: 'add:0', text: 'Check the invoice' })
  expect(await ui.find({ type: 'Text', text: /Check the invoice/ })).toBeDefined()

  await $.turn.complete({ ...TURN, answer: 'first' })
  await clock.advance(1)
  expect(await ui.find({ type: 'Text', text: /Check the invoice/ })).toBeDefined()
  await ui.unmount()
})

const opens = (on: On) => {
  const opened: { id: string; focus?: true }[] = []
  mock.clock(on)
  on('ui.open', (_, e) => {
    opened.push(e)

    return { value: { isPlaced: true } }
  })

  return opened
}

test('a new chat opens the list without taking the keyboard', async ($, on) => {
  const opened = opens(on)
  world(on)

  await $.session.start(START)

  expect(opened.map(o => o.id)).toEqual(['pending'])
  expect(opened[0]?.focus).toBeUndefined()
})

test('a list closed by hand stays closed until /pending opens it again', async ($, on) => {
  const opened = opens(on)
  world(on, { autoOpen: false })

  await $.session.start(START)
  expect(opened.length).toBe(0)

  await $.command.run({ command: 'pending', args: '' } as never)
  await $.session.start(START)
  expect(opened.length).toBe(2)
})

test('an unreadable reply keeps the list, and subagents ask nothing', async ($, on) => {
  const clock = mock.clock(on)
  world(on, { chats: [chat('s1', '/work/alpha', 'Deploy')] })
  const asked = answers(on, ['I cannot tell.'])

  await $.session.start(START)
  await $.turn.complete({ ...TURN, answer: 'x', agentId: 'a1' })
  await clock.advance(1)
  expect(asked.length).toBe(0)

  await $.turn.complete({ ...TURN, answer: 'x' })
  await clock.advance(1)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Deploy/ })).toBeDefined()
  await ui.unmount()
})
