import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// Characters a shell reads as a redirect, pipe, separator, background, expansion or comment.
const SHELL_META = /[<>|;&$`#]/

// Every hint line must paste into a shell as printed: each command starts its line (a leading space keeps it out
// of shell history), its only pipe is the leading `echo '{...}' |` with a real boolean value, and no other text
// holds a shell metacharacter. `isErrorFirst` skips line 0 when it carries an engine error's own text.
function expectPasteable(text: string | undefined, values: string[], isErrorFirst = false): void {
  expect(text).toBeDefined()
  const lines = (text ?? '').split('\n').slice(isErrorFirst ? 1 : 0)
  const commands = lines.filter(line => line.includes('claude plugin configure'))
  expect(commands.map(line => /^echo '\{"autoOpen":"(true|false)"\}' \| (.*)$/.exec(line)?.[1])).toEqual(values)
  for (const line of commands) expect(SHELL_META.test(line.replace(/^echo '[^']*' \| /, ''))).toBe(false)
  for (const line of lines.filter(one => !commands.includes(one))) expect(SHELL_META.test(line)).toBe(false)
}

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PROPS = { title: 'Pull requests', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as const

type Gh = (argv: string[]) => { ok: true; out: string } | { ok: false; err: string }

type Stubs = {
  isShowing?: boolean
  // config.set refuses every write with this reason, as a policy-locked row does.
  deny?: string
  // No /config row, and config.set rejects, as a -p session.
  isHeadless?: boolean
  // config.set throws with this message.
  reject?: string
  // Answers each gh call; left out, every gh call fails.
  gh?: Gh
}

// Stands in for the engine beneath the plugin: nothing is stored, the pane calls and gh argv are recorded, the
// clock reads `calls.now`, and the /config row holds what config.set wrote.
function engine(on: On, { isShowing = false, deny, isHeadless = false, reject, gh }: Stubs = {}) {
  const calls = {
    opened: 0, closed: 0, stored: [] as unknown[], autoOpen: false, gh: [] as string[][], copied: [] as string[],
    now: Date.parse('2026-10-19T12:00:00Z'),
  }
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('command.register', async ($, e) => ({ value: { command: e.name } }))
  on('process.run', async ($, e) => {
    const argv = [...e.argv].slice(1)
    calls.gh.push(argv)
    const answer = gh?.(argv) ?? { ok: false, err: 'offline' }
    return {
      value: answer.ok
        ? { exitCode: 0, stdout: answer.out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: 1, stdout: '', stderr: answer.err, isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('clock.now', async () => ({ value: calls.now }))
  on('clock.every', async () => ({ value: undefined }))
  on('store.get', async () => ({ value: null }))
  on('store.set', async ($, e) => {
    calls.stored.push(e.value)
    return { value: undefined }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.copy', async ($, e) => {
    calls.copied.push(e.text)
    return { value: { isCopied: true } }
  })
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
    value: isHeadless ? [] : [{
      key: 'pr-pane.autoOpen', label: 'Open the pane at session start', kind: 'boolean', value: calls.autoOpen,
      provider: { plugin: 'pr-pane', tier: 'user' }, isLocked: deny !== undefined,
    }],
  }))
  on('config.set', async ($, e) => {
    if (isHeadless) throw new Error('no /config row has the key pr-pane.autoOpen')
    if (reject !== undefined) throw new Error(reject)
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
  engine(on, { deny: 'Set by your organization.' })
  await $.session.start(START)
  const run = await $.command.run({ ...TYPED, command: 'prs', args: 'autoOpen enable' })
  expect(run.text).toBe('Auto-open is unchanged: Set by your organization.')
  expect((await $.command.run({ ...TYPED, command: 'prs', args: 'autoOpen' })).text).toContain('can\'t be changed here')
  await drain($)
})

test('/prs closes a showing pane; show and hide are explicit', async ($, on) => {
  const calls = engine(on, { isShowing: true })
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

test('/prs autoOpen without a /config row reports the options and changes nothing', { options: { autoOpen: true } }, async ($, on) => {
  const calls = engine(on, { isHeadless: true })
  await $.session.start(START)
  const say = async (args: string) => (await $.command.run({ ...TYPED, command: 'prs', args })).text
  const status = await say('autoOpen')
  expect(status).toContain("Auto-open is on: the pane opens at session start, from the plugin's options")
  expectPasteable(status, ['true', 'false'])
  for (const verb of ['enable', 'disable']) {
    const text = await say(`autoOpen ${verb}`)
    expect(text).toContain('Auto-open is unchanged: this session has no /config row for it.')
    expect(text).toContain(`echo '{"autoOpen":"${verb === 'enable'}"}' | claude plugin configure pr-pane@evolv-marketplace --values-stdin`)
    expectPasteable(text, [String(verb === 'enable')])
  }
  expect(calls.autoOpen).toBe(false)
  await drain($)
})

test('/prs autoOpen reports a rejected write instead of failing', async ($, on) => {
  engine(on, { reject: 'the row only changes in its dialog' })
  await $.session.start(START)
  const run = await $.command.run({ ...TYPED, command: 'prs', args: 'autoOpen enable' })
  expect(run.text).toContain('Auto-open is unchanged:')
  // The kit skips a throwing hook and rejects with its own text, so only the outcome is checked.
  expect(run.text).toContain(`echo '{"autoOpen":"true"}' | claude plugin configure pr-pane@evolv-marketplace --values-stdin`)
  expectPasteable(run.text, ['true'], true)
  await drain($)
})

// One PR, #7, into dev, whose ruleset needs one approval from someone other than the last pusher; the viewer
// (`rev`) authored the head commit.
function repo(rules: unknown, codeowners?: string, teams: string[] = []): Gh {
  const PR = {
    number: 7, title: 'Fix', author: { login: 'dev' }, headRefName: 'feat/x', createdAt: '2026-10-19T10:00:00Z',
    isDraft: false, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
    additions: 1, deletions: 0, changedFiles: 1, latestReviews: [], url: 'u',
  }
  const DETAIL = {
    number: 7, headRefOid: 'abc1234def', headRefName: 'feat/x', baseRefName: 'dev', additions: 1, deletions: 0,
    changedFiles: 1, commits: [], files: [{ path: 'src/a.ts' }], labels: [], reviews: [], statusCheckRollup: [], body: '',
  }

  return argv => {
    const [verb, sub] = argv
    const path = argv.find(arg => arg.startsWith('repos/')) ?? ''
    if (verb === 'api' && sub === 'user') return { ok: true, out: 'rev\n' }
    if (verb === 'repo') return { ok: true, out: 'o/r\n' }
    if (verb === 'pr' && sub === 'list') return { ok: true, out: JSON.stringify([PR]) }
    if (verb === 'pr' && sub === 'view' && argv[2] === '7') return { ok: true, out: JSON.stringify({ ...PR, ...DETAIL, state: 'OPEN' }) }
    if (path.endsWith('/files?per_page=100')) return { ok: true, out: 'src/a.ts\n' }
    if (path.endsWith('/rules/branches/dev')) return { ok: true, out: JSON.stringify(rules) }
    if (path.endsWith('/commits/abc1234def')) return { ok: true, out: 'rev rev\n' }
    if (path.endsWith('/compare/dev...abc1234def')) return { ok: true, out: '5 3\n' }
    if (verb === 'pr' && sub === 'comment') return { ok: true, out: 'https://github.com/o/r/pull/7#issuecomment-1\n' }
    if (path.endsWith('/contents/.github/CODEOWNERS') && codeowners !== undefined) return { ok: true, out: codeowners }
    if (sub === '--paginate' && argv.includes('user/teams')) return { ok: true, out: teams.map(team => `${team}\n`).join('') }
    return { ok: false, err: 'gh: Not Found (HTTP 404)' }
  }
}

test('the detail view shows the rules, refuses the last pusher, and refetches rules only after 10 minutes', async ($, on) => {
  const calls = engine(on, {
    gh: repo([{ type: 'pull_request', parameters: { required_approving_review_count: 1, require_last_push_approval: true } }]),
  })
  const fetches = () => calls.gh.filter(argv => argv.some(arg => arg.endsWith('/rules/branches/dev'))).length
  await $.session.start(START)
  await drain($)
  const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'pr-pane' })
  await ui.press({ key: 'row-7' })
  expect(await ui.find({ text: /rules on dev: needs 1 approval \(has 0\) · the last pusher can't approve \[rulesets\]/ })).toBeDefined()
  expect(fetches()).toBe(1)

  await ui.press({ key: 'approve' })
  expect(await ui.find({ text: /you authored or committed the head commit abc1234, so GitHub won't count your approval/ })).toBeDefined()
  expect(calls.gh.some(argv => argv[0] === 'pr' && argv[1] === 'review')).toBe(false)

  await ui.press({ key: 'refresh' })
  expect(fetches()).toBe(1)
  calls.now += 11 * 60_000
  await ui.press({ key: 'refresh' })
  expect(fetches()).toBe(2)
  await drain($)
})

// The branch requires a code owner's review; CODEOWNERS gives src/ to org/core and the rest to org/web.
for (const [teams, isWarned] of [[['org/web'], true], [['org/core'], false]] as const) {
  test(`approve ${isWarned ? 'warns' : "doesn't warn"} a member of ${teams[0]} about code owner review`, async ($, on) => {
    const required = [{ type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: true } }]
    const calls = engine(on, { gh: repo(required, '* @org/web\n/src/ @org/core\n', [...teams]) })
    await $.session.start(START)
    await drain($)
    const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'pr-pane' })
    await ui.press({ key: 'row-7' })
    await ui.press({ key: 'approve' })
    const warning = await ui.find({ text: /dev requires a code owner's review, and you don't own any changed path/ })
    expect(warning !== undefined).toBe(isWarned)
    // src/a.ts is owned in CODEOWNERS, which approve already treats as sensitive, so both cases pause to confirm.
    expect(await ui.find({ text: /Touches workflow, CODEOWNERS or auth paths: src\/a.ts/ })).toBeDefined()
    expect(calls.gh.some(argv => argv[0] === 'pr' && argv[1] === 'review')).toBe(false)
    await drain($)
  })
}

test('the detail view draws the gates on one row, or one per row when narrow, and the branch line', async ($, on) => {
  engine(on, { gh: repo([{ type: 'pull_request', parameters: { required_approving_review_count: 2 } }]) })
  await $.session.start(START)
  await drain($)
  for (const [columns, rows] of [[80, 1], [40, 4]] as const) {
    const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'Pane', props: { ...PROPS, bodyColumns: columns }, requestId: 'pr-pane' })
    await ui.press({ key: 'row-7' })
    const chain = await ui.find({ text: 'approvals 0/2 ─▶ no checks ─▶ up to date ─▶ mergeable' })
    const stacked = await Promise.all(['└▶ no checks', '└▶ up to date', '└▶ mergeable'].map(text => ui.find({ text })))
    expect(chain !== undefined).toBe(rows === 1)
    expect(stacked.filter(one => one !== undefined)).toHaveLength(rows === 1 ? 0 : 3)
    expect(await ui.find({ text: 'dev ◀── 3 behind · 5 ahead ── feat/x' })).toBeDefined()
    await ui.press({ key: 'row-7' })
    await ui.unmount()
  }
  await drain($)
})

test('/prs diagram prints and copies the Mermaid; only --post comments on the PR, and logs it', async ($, on) => {
  const calls = engine(on, { gh: repo([]) })
  await $.session.start(START)
  await drain($)
  const run = async (args: string) => (await $.command.run({ ...TYPED, command: 'prs', args })).text ?? ''
  const printed = await run('diagram 7')
  expect(printed).toContain('```mermaid\nflowchart LR')
  expect(printed).toContain('Copied to the clipboard. Run /prs diagram 7 --post to post it as a comment on #7.')
  expect(calls.copied).toHaveLength(1)
  const comments = () => calls.gh.filter(argv => argv[0] === 'pr' && argv[1] === 'comment')
  expect(comments()).toHaveLength(0)
  expect(await run('diagram 7 --now')).toBe('Usage: /prs diagram <n> [--post]')
  expect(await run('diagram 8')).toBe("#8 isn't an open PR in this repo: gh: Not Found (HTTP 404).")
  expect(comments()).toHaveLength(0)

  expect(await run('diagram #7 --post')).toContain('Posted as a comment on #7.')
  expect(comments()).toHaveLength(1)
  expect(comments()[0]?.slice(0, 4)).toEqual(['pr', 'comment', '7', '--body'])
  expect(comments()[0]?.[4]).toContain('```mermaid')
  expect(await run('log')).toContain('rev o/r#7 @abc1234 post diagram ok')
  await drain($)
})

test('/prs diagram reads a PR the list does not hold', async ($, on) => {
  const listed = repo([])
  engine(on, { gh: argv => (argv[0] === 'pr' && argv[1] === 'list' ? { ok: true, out: '[]' } : listed(argv)) })
  await $.session.start(START)
  await drain($)
  const text = (await $.command.run({ ...TYPED, command: 'prs', args: 'diagram 7' })).text ?? ''
  expect(text).toContain('Merge readiness of #7 at abc1234:')
  expect(text).toContain('head["feat/x"] -- "5 ahead · 3 behind" --> base["dev"]')
  await drain($)
})

test('/prs layout reports the layout and width from the command, and how to dock the pane', async ($, on) => {
  engine(on)
  await $.session.start(START)
  const layout = async (isFullscreen: boolean, columns: number) =>
    (await $.command.run({ ...TYPED, presentation: { isFullscreen, columns }, command: 'prs', args: 'layout' })).text
  expect(await layout(false, 120)).toContain('Layout: default, 120 columns.')
  expect(await layout(false, 120)).toContain('run /tui fullscreen')
  expect(await layout(true, 90)).toContain('widen the terminal')
  expect(await layout(true, 160)).toBe('Layout: fullscreen, 160 columns. The pane docks beside the conversation.')
  await drain($)
})

test('the tips show until /prs layout is run, then stop, and the pane tip only while inline', async ($, on) => {
  const calls = engine(on)
  await $.session.start(START)
  await drain($)
  for (const placement of ['inline', 'dock'] as const) {
    const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'Pane', props: { ...PROPS, placement }, requestId: 'pr-pane' })
    expect((await ui.find({ text: /Tip: run \/tui fullscreen/ })) !== undefined).toBe(placement === 'inline')
    await ui.unmount()
  }
  const opened = (await $.command.run({ ...TYPED, command: 'prs', args: 'show' })).text ?? ''
  expect(opened).toContain('Tip: For the pane docked beside the conversation, run /tui fullscreen')
  await $.command.run({ ...TYPED, command: 'prs', args: 'layout' })
  expect(calls.stored).toContain(true)
  expect((await $.command.run({ ...TYPED, command: 'prs', args: 'show' })).text).not.toContain('Tip:')
  const ui = await $.ui.mount({ plugin: 'pr-pane', surface: 'terminal', component: 'Pane', props: { ...PROPS, placement: 'inline' }, requestId: 'pr-pane' })
  expect(await ui.find({ text: /Tip: run \/tui fullscreen/ })).toBeUndefined()
  await drain($)
})

test('a headless run gets no layout tip', async ($, on) => {
  engine(on)
  await $.session.start({ ...START, surface: null, isInteractive: false })
  expect((await $.command.run({ ...TYPED, command: 'prs', args: 'show' })).text).not.toContain('Tip:')
  await drain($)
})
