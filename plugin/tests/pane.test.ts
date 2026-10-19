import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PROPS = { title: 'Pull requests', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as const

// Stands in for the engine beneath the plugin: gh fails, nothing is stored, and the pane calls are recorded.
function engine(on: On, isShowing = false) {
  const calls = { opened: 0, closed: 0, stored: [] as unknown[] }
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'offline', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('clock.now', async () => ({ value: Date.parse('2026-10-19T12:00:00Z') }))
  on('clock.every', async () => ({ value: undefined }))
  on('store.get', async () => ({ value: null }))
  on('store.set', async ($, e) => {
    calls.stored.push(e.value)
    return { value: undefined }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.panes', async () => ({
    value: isShowing ? [{ id: 'pr-pane', title: 'Pull requests', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', async () => {
    calls.opened++
    return { value: { isPlaced: true } }
  })
  on('ui.close', async () => {
    calls.closed++
    return { value: undefined }
  })

  return calls
}

// Round trips through the host until the refreshes the plugin started unawaited have finished; the test
// environment is torn down when the body returns, and work still running then fails the file.
async function drain($: Engine): Promise<void> {
  for (let i = 0; i < 50; i++) await $.command.run({ ...TYPED, command: 'prs', args: 'help' })
}

test('opens the pane at session start by default', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  expect(calls.opened).toBe(1)
  await drain($)
})

test('autoOpen off skips the pane but keeps the command', { options: { autoOpen: false } }, async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  expect(calls.opened).toBe(0)
  await $.command.run({ ...TYPED, command: 'prs', args: '' })
  expect(calls.opened).toBe(1)
  await drain($)
})

test('/prs closes a showing pane; show and hide are explicit', async ($, on) => {
  const calls = engine(on, true)
  await $.session.start(START)
  await $.command.run({ ...TYPED, command: 'prs', args: '' })
  expect(calls.closed).toBe(1)
  await $.command.run({ ...TYPED, command: 'prs', args: 'show' })
  expect(calls.opened).toBe(2)
  await $.command.run({ ...TYPED, command: 'prs', args: 'hide' })
  expect(calls.closed).toBe(2)
  await drain($)
})

test('z folds the pane to one line and back, and remembers it', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await drain($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pr-pane', surface, component: 'Pane', props: PROPS, requestId: 'pr-pane' })
    await ui.press({ key: 'collapse' })
    expect(await ui.find({ text: 'offline' })).toBeDefined()
    expect(await ui.find({ key: 'refresh' })).toBeUndefined()
    await ui.press({ key: 'expand' })
    expect(await ui.find({ key: 'collapse' })).toBeDefined()
  }
  expect(calls.stored.filter(value => typeof value === 'boolean')).toEqual([true, false, true, false])
})
