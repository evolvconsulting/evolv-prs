import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PROPS = { title: 'Pull requests', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as const

// Stands in for the engine beneath the plugin: gh fails, nothing is stored, the pane calls are recorded, and
// the /config row holds what config.set wrote (`deny` refuses every write, as a policy-locked row does).
function engine(on: On, isShowing = false, deny?: string) {
  const calls = { opened: 0, closed: 0, stored: [] as unknown[], autoOpen: false }
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
  on('config.list', async () => ({
    value: [{
      key: 'pr-pane.autoOpen', label: 'Open the pane at session start', kind: 'boolean', value: calls.autoOpen,
      provider: { plugin: 'pr-pane', tier: 'user' }, isLocked: deny !== undefined,
    }],
  }))
  on('config.set', async ($, e) => {
    if (deny !== undefined) return { deny }
    expect(e.key).toBe('pr-pane.autoOpen')
    calls.autoOpen = e.value === true
    return { value: e.value }
  })

  return calls
}

// Round trips through the host until the refreshes the plugin started unawaited have finished; the test
// environment is torn down when the body returns, and work still running then fails the file.
async function drain($: Engine): Promise<void> {
  for (let i = 0; i < 50; i++) await $.command.run({ ...TYPED, command: 'prs', args: 'help' })
}

test('leaves the pane closed at session start by default; /prs opens it', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  expect(calls.opened).toBe(0)
  await $.command.run({ ...TYPED, command: 'prs', args: '' })
  expect(calls.opened).toBe(1)
  await drain($)
})

test('autoOpen on opens the pane at session start', { options: { autoOpen: true } }, async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  expect(calls.opened).toBe(1)
  await drain($)
})

test('/prs autoOpen writes the /config row and reports it', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  const say = async (args: string) => (await $.command.run({ ...TYPED, command: 'prs', args })).text
  expect(await say('autoOpen')).toContain('Auto-open is off')
  expect(await say('autoOpen enable')).toContain('Auto-open is now on')
  expect(calls.autoOpen).toBe(true)
  expect(await say('autoopen')).toContain('Auto-open is on')
  expect(await say('autoOpen disable')).toContain('Auto-open is now off')
  expect(calls.autoOpen).toBe(false)
  expect(await say('autoOpen maybe')).toBe('Usage: /prs autoOpen [enable|disable]')
  expect(calls.opened).toBe(0)
  await drain($)
})

test('/prs autoOpen says so when the row is locked', async ($, on) => {
  engine(on, false, 'Set by your organization.')
  await $.session.start(START)
  const run = await $.command.run({ ...TYPED, command: 'prs', args: 'autoOpen enable' })
  expect(run.text).toBe('Auto-open is unchanged: Set by your organization.')
  expect((await $.command.run({ ...TYPED, command: 'prs', args: 'autoOpen' })).text).toContain('can\'t be changed here')
  await drain($)
})

test('/prs closes a showing pane; show and hide are explicit', async ($, on) => {
  const calls = engine(on, true)
  await $.session.start(START)
  await $.command.run({ ...TYPED, command: 'prs', args: '' })
  expect(calls.closed).toBe(1)
  await $.command.run({ ...TYPED, command: 'prs', args: 'show' })
  expect(calls.opened).toBe(1)
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
