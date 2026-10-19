import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Action, AuditEntry, Detail, Pr, Snapshot } from '../types'
import { COMMANDS, HELP, KEYS, helpText } from './keys'
import {
  DETAIL_FIELDS, FEEDBACK_LABELS, FIELDS, age, agentSignals, approvalWarnings, canMerge, codeownersMatcher,
  created, diffKey, feedbackBody, isBehind, isLarge, merge, mergeWarnings, newPrs, parseDetail, parsePrs, review, reviewState, when,
} from './prs'

const PANE = 'pr-pane'
const POLL_MS = 60_000
const BODY_LINES = 8
const REVIEW_ROWS = 6
const AUDIT_MAX = 500
const RERUN_WARN_AT = 2
const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']
const LIST_LIMIT = 100

const snapshot = atom({ plugin: 'pr-pane', key: 'snapshot' } as const, null)
const seen = atom({ plugin: 'pr-pane', key: 'seen' } as const, null)
const seededAt = atom({ plugin: 'pr-pane', key: 'seededAt' } as const, null)
const selected = atom({ plugin: 'pr-pane', key: 'selected' } as const, null)
const detail = atom({ plugin: 'pr-pane', key: 'detail' } as const, null)
const action = atom({ plugin: 'pr-pane', key: 'action' } as const, null)
const view = atom({ plugin: 'pr-pane', key: 'view' } as const, 'list')
const who = atom({ plugin: 'pr-pane', key: 'who' } as const, null)
const diffViewed = atom({ plugin: 'pr-pane', key: 'diffViewed' } as const, [])
const audit = atom({ plugin: 'pr-pane', key: 'audit' } as const, [])
const reruns = atom({ plugin: 'pr-pane', key: 'reruns' } as const, {})

// CODEOWNERS from the default branch, loaded once per module load.
let owned: ((path: string) => boolean) | undefined
// Whether the pane held the keyboard at its last draw; tells a focus entering from one moving inside.
let wasFocused = false
// Settles once the viewer, repo and CODEOWNERS are loaded; guarded actions wait on it.
let ready: Promise<void> = Promise.resolve()
// One refresh at a time; a refresh asked for meanwhile runs once more after it.
let refreshing: Promise<void> | null = null
let isRefreshAgain = false

async function gh($: EngineInterface, argv: string[], timeoutMs = 30_000): Promise<{ ok: boolean; out: string }> {
  try {
    const ran = await $.process.run(['gh', ...argv], { timeoutMs })

    return ran.exitCode === 0
      ? { ok: true, out: ran.stdout }
      : { ok: false, out: ran.stderr.trim() || `gh exited ${ran.exitCode}` }
  } catch (err) {
    return { ok: false, out: `gh did not run: ${String(err)}` }
  }
}

async function loadContext($: EngineInterface): Promise<void> {
  const [user, repo] = await Promise.all([
    gh($, ['api', 'user', '--jq', '.login']),
    gh($, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']),
  ])
  await update($, who, () => ({
    viewer: user.ok ? user.out.trim() : 'unknown',
    repo: repo.ok ? repo.out.trim() : 'unknown',
  }))
  const files = await Promise.all(CODEOWNERS_PATHS.map(path =>
    gh($, ['api', `repos/{owner}/{repo}/contents/${path}`, '-H', 'Accept: application/vnd.github.raw'])))
  const file = files.find(one => one.ok)
  if (file !== undefined) owned = codeownersMatcher(file.out)
  const stored = await $.store.get('audit')
  if (Array.isArray(stored)) await update($, audit, () => stored as AuditEntry[])
  const counts = await $.store.get('reruns')
  if (counts !== null && typeof counts === 'object') await update($, reruns, () => counts as Record<string, number>)
}

function refresh($: EngineInterface): Promise<void> {
  if (refreshing !== null) {
    isRefreshAgain = true
    return refreshing
  }
  refreshing = (async () => {
    do {
      isRefreshAgain = false
      await refreshOnce($)
    } while (isRefreshAgain)
  })().finally(() => {
    refreshing = null
  })

  return refreshing
}

async function refreshOnce($: EngineInterface): Promise<void> {
  const checkedAt = await $.clock.now()
  const ran = await gh($, ['pr', 'list', '--state', 'open', '--limit', String(LIST_LIMIT), '--json', FIELDS])
  const next: Snapshot = ran.ok
    ? { prs: parsePrs(ran.out), error: null, checkedAt }
    : { prs: [], error: ran.out, checkedAt }
  await update($, snapshot, () => next)
  if (next.error !== null) return

  const known = await read($, seen)
  // First successful check this session seeds the list without toasting.
  if (known === null) await update($, seededAt, () => checkedAt)
  else {
    const since = (await read($, seededAt)) ?? checkedAt
    for (const pr of newPrs(next.prs, known, since)) {
      const tag = agentSignals(pr).length > 0 ? ' [agent]' : ''
      $.ui.toast(`New PR #${pr.number}${tag}: ${pr.title} (${pr.author})`, { timeoutMs: 8000 })
    }
  }
  await update($, seen, list => [...new Set([...(list ?? []), ...next.prs.map(pr => pr.number)])])

  const open = await read($, selected)
  if (open !== null) {
    if (next.prs.some(pr => pr.number === open)) await loadDetail($, open)
    else await select($, null)
  }
}

async function loadDetail($: EngineInterface, n: number): Promise<Detail | null> {
  const [ran, listed] = await Promise.all([
    gh($, ['pr', 'view', String(n), '--json', DETAIL_FIELDS]),
    gh($, ['api', '--paginate', `repos/{owner}/{repo}/pulls/${n}/files?per_page=100`, '--jq', '.[].filename']),
  ])
  // A slower response for a PR no longer selected must not overwrite the current one.
  if ((await read($, selected)) !== n) return null
  const paths = listed.ok ? listed.out.split('\n').filter(line => line !== '') : undefined
  const value = ran.ok ? parseDetail(ran.out, owned, paths) : { number: n, error: ran.out }
  await update($, detail, () => value)

  return 'error' in value ? null : value
}

// Reloads the PR (after CODEOWNERS has loaded) and checks no commit landed since the person
// last saw it, so a guarded action judges and acts on exactly the commit they looked at.
async function freshDetail($: EngineInterface, n: number, seenSha: string): Promise<Detail | null> {
  await ready
  const info = await loadDetail($, n)
  if (info === null) {
    await setAction($, { number: n, kind: 'error', text: `Couldn't reload #${n}; nothing was done.` })
    return null
  }
  if (info.headRefOid !== seenSha) {
    await setAction($, {
      number: n,
      kind: 'error',
      text: `#${n} has new commits (${seenSha.slice(0, 7)} → ${info.headRefOid.slice(0, 7)}). Reloaded; review it again. Nothing was done.`,
    })
    return null
  }

  return info
}

async function select($: EngineInterface, n: number | null): Promise<void> {
  await update($, selected, () => n)
  await update($, action, () => null)
  await update($, view, () => 'list' as const)
  if (n === null) {
    await update($, detail, () => null)
    return
  }
  await loadDetail($, n)
}

async function setAction($: EngineInterface, value: Action | null): Promise<void> {
  await update($, action, () => value)
}

async function record($: EngineInterface, n: number, what: string, ok: boolean, note?: string): Promise<void> {
  const ctx = await read($, who)
  const info = await read($, detail)
  const entry: AuditEntry = {
    at: new Date(await $.clock.now()).toISOString(),
    actor: ctx?.viewer ?? 'unknown',
    repo: ctx?.repo ?? 'unknown',
    pr: n,
    sha: info !== null && !('error' in info) && info.number === n ? info.headRefOid.slice(0, 12) : '',
    action: what,
    result: ok ? 'ok' : 'error',
    ...(note === undefined ? {} : { note: note.slice(0, 200) }),
  }
  await update($, audit, list => [...list, entry].slice(-AUDIT_MAX))
  await $.store.set('audit', await read($, audit))
}

// Runs gh writes for PR n in order, logs the action, reports it inline, then refreshes.
async function runGh($: EngineInterface, n: number, what: string, argvs: string[][], busy: string, done: string): Promise<boolean> {
  await setAction($, { number: n, kind: 'busy', text: busy })
  for (const argv of argvs) {
    const ran = await gh($, argv, 120_000)
    if (!ran.ok) {
      await record($, n, what, false, ran.out)
      await setAction($, { number: n, kind: 'error', text: ran.out })
      return false
    }
  }
  await record($, n, what, true)
  $.ui.toast(done)
  await setAction($, { number: n, kind: 'done', text: done })
  await refresh($)

  return true
}

async function runReview($: EngineInterface, n: number): Promise<void> {
  try {
    // Only the number goes to /code-review; PR text never enters a prompt from here.
    await $.command.run({ command: 'code-review', args: String(n) })
    await record($, n, 'code-review', true)
  } catch (err) {
    await record($, n, 'code-review', false, String(err))
    await setAction($, { number: n, kind: 'error', text: `/code-review did not start: ${String(err)}` })
  }
}

async function viewDiff($: EngineInterface, info: Detail): Promise<boolean> {
  const ran = await gh($, ['pr', 'diff', String(info.number), '--web'])
  if (!ran.ok) {
    await setAction($, { number: info.number, kind: 'error', text: `The diff didn't open, so it isn't marked viewed: ${ran.out}` })
    return false
  }
  await update($, diffViewed, list => [...new Set([...list, diffKey(info)])])

  return true
}

async function approve($: EngineInterface, pr: Pr, seenSha: string, isForced: boolean): Promise<void> {
  const ctx = await read($, who)
  if (ctx !== null && ctx.viewer === pr.author) {
    await setAction($, { number: pr.number, kind: 'error', text: `You opened #${pr.number}; GitHub won't let you approve it.` })
    return
  }
  await setAction($, { number: pr.number, kind: 'busy', text: `Checking #${pr.number} is unchanged...` })
  const info = await freshDetail($, pr.number, seenSha)
  if (info === null) return
  const warnings = approvalWarnings(pr, info, (await read($, diffViewed)).includes(diffKey(info)))
  if (warnings.length > 0 && !isForced) {
    await setAction($, { number: pr.number, kind: 'confirm-approve', text: '', warnings, sha: info.headRefOid })
    return
  }
  const what = warnings.length > 0 ? 'approve (past warnings)' : 'approve'
  const note = warnings.length > 0 ? warnings.join(' ') : undefined
  const ok = await runGh($, pr.number, what, [['pr', 'review', String(pr.number), '--approve']],
    `Approving #${pr.number}...`, `Approved PR #${pr.number}`)
  if (ok && note !== undefined) await record($, pr.number, 'approve warnings', true, note)
}

async function confirmMerge($: EngineInterface, pr: Pr, seenSha: string): Promise<void> {
  await setAction($, { number: pr.number, kind: 'busy', text: `Checking #${pr.number} is unchanged...` })
  const info = await freshDetail($, pr.number, seenSha)
  if (info === null) return
  const warnings = mergeWarnings(pr, info, (await read($, diffViewed)).includes(diffKey(info)))
  await setAction($, { number: pr.number, kind: 'confirm-merge', text: '', warnings, sha: info.headRefOid })
}

// --match-head-commit makes GitHub refuse the merge if anything was pushed after the confirm.
async function runMerge($: EngineInterface, n: number, method: '--merge' | '--squash', sha: string): Promise<void> {
  await runGh($, n, `merge ${method}`, [['pr', 'merge', String(n), method, '--match-head-commit', sha]],
    `Merging #${n} at ${sha.slice(0, 7)}...`, `Merged PR #${n}`)
}

async function rerun($: EngineInterface, n: number, runIds: string[], isForced: boolean): Promise<void> {
  const ctx = await read($, who)
  const counts = await read($, reruns)
  const keyOf = (id: string) => `${ctx?.repo ?? '?'}#${id}`
  const most = Math.max(0, ...runIds.map(id => counts[keyOf(id)] ?? 0))
  if (most >= RERUN_WARN_AT && !isForced) {
    await setAction($, {
      number: n,
      kind: 'confirm-rerun',
      text: `Re-run ${most} times already. A check that keeps failing then passing is likely flaky: fix or quarantine it.`,
    })
    return
  }
  const ok = await runGh($, n, `rerun ${runIds.join(',')}`, runIds.map(id => ['run', 'rerun', id, '--failed']),
    `Re-running failed jobs on #${n} (same commit)...`, `Re-ran failed jobs on PR #${n}`)
  if (ok) {
    await update($, reruns, map => {
      const next = { ...map }
      for (const id of runIds) next[keyOf(id)] = (next[keyOf(id)] ?? 0) + 1
      return next
    })
    await $.store.set('reruns', await read($, reruns))
  }
}

async function sendFeedback($: EngineInterface, pr: Pr, act: Action, body: string): Promise<void> {
  if (body.trim() === '') {
    await setAction($, { ...act, text: 'Feedback is empty; nothing sent.' })
    return
  }
  const isChanges = act.kind === 'compose-changes'
  const label = act.label ?? (isChanges ? 'issue' : 'suggestion')
  const isBlocking = act.isBlocking ?? isChanges
  await runGh($, pr.number, `${isChanges ? 'request-changes' : 'comment'} ${label}${isBlocking ? ' blocking' : ''}`,
    [['pr', 'review', String(pr.number), isChanges ? '--request-changes' : '--comment', '--body', feedbackBody(label, isBlocking, body)]],
    `Sending feedback to ${pr.author}...`,
    isChanges ? `Requested changes on PR #${pr.number}` : `Commented on PR #${pr.number}`)
}

function auditLine(one: AuditEntry): string {
  const sha = one.sha === '' ? '' : ` @${one.sha.slice(0, 7)}`
  const note = one.note === undefined ? '' : ` — ${one.note}`

  return `${one.at.slice(0, 16).replace('T', ' ')} ${one.actor} ${one.repo}#${one.pr}${sha} ${one.action} ${one.result}${note}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prs',
      description: 'Open PRs pane for this repo (/prs help lists the hotkeys)',
      argumentHint: '[help|log|refresh]',
    })
    ready = loadContext($)
    void ready.then(() => refresh($))
    $.clock.every(POLL_MS, () => void refresh($))
    void $.ui.open({ id: PANE, title: 'Pull requests' })

    return next(e)
  })

  on('command.run', { command: 'prs' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'help') return { text: helpText() }
    if (arg === 'log') {
      const list = (await read($, audit)).slice(-20)
      return { text: list.length === 0 ? 'No pr-pane actions logged yet.' : list.map(auditLine).join('\n') }
    }
    void refresh($)
    if (arg === 'refresh') return { text: 'Refreshing open PRs.' }
    await $.ui.open({ id: PANE, title: 'Pull requests' })

    return { text: 'Pull requests pane opened. Press h in the pane, or run /prs help, for hotkeys.' }
  })

  // Esc never reaches a plugin: it hands the keys back. Help and log are drawn only while the
  // pane holds the keys, so Esc closes them; coming back resets to the list.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!wasFocused && (await read($, view)) !== 'list') await update($, view, () => 'list' as const)

    return next(e)
   }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // The mobile surface has no Input or Select; feedback and close reasons need them.
    const Input = 'Input' in elements ? elements.Input : null
    const Select = 'Select' in elements ? elements.Select : null
    const noInput = <Text dimColor>Typing isn't available on this surface; use the terminal or desktop.</Text>
    const snap = await read($, snapshot)
    const open = await read($, selected)
    const info = await read($, detail)
    const act = await read($, action)
    const stored = await read($, view)
    wasFocused = e.props.isFocused
    const mode = e.props.isFocused ? stored : 'list'
    const viewed = await read($, diffViewed)
    const width = Math.max(20, e.props.bodyColumns)
    const rule = <Text dimColor>{'─'.repeat(width)}</Text>

    const header = (
      <Box>
        <Text dimColor>
          {snap === null ? 'checking' : `${snap.prs.length} open · checked ${new Date(snap.checkedAt).toISOString().slice(11, 16)} UTC`}{' '}
        </Text>
        <Button key="refresh" plain hotkey={KEYS.refresh} label="refresh" onPress={() => refresh($)} />
        <Text> </Text>
        <Button key="log" plain hotkey={KEYS.log} label="log" onPress={() => update($, view, v => (v === 'log' ? 'list' : 'log'))} />
        <Text> </Text>
        <Button key="help" plain hotkey={KEYS.help} label="help" onPress={() => update($, view, v => (v === 'help' ? 'list' : 'help'))} />
      </Box>
    )

    if (mode === 'help') {
      return (
        <Box flexDirection="column" width={width}>
          {header}
          {rule}
          <Text bold>Commands</Text>
          {COMMANDS.map(one => (
            <Text wrap="truncate-end">
              <Text color="suggestion">{one.usage.padEnd(14)}</Text>
              {one.what}
            </Text>
          ))}
          {HELP.map(group => (
            <Box key={`help-${group.section}`} flexDirection="column" marginTop={1}>
              <Text bold>{group.section}</Text>
              {group.rows.map(row => (
                <Text wrap="truncate-end">
                  <Text color="suggestion">{row.key.padEnd(12)}</Text>
                  {row.what}
                </Text>
              ))}
            </Box>
          ))}
          <Box marginTop={1}>
            <Text dimColor>ctrl+x tab focuses the pane · Esc closes this and returns to the prompt </Text>
            <Button key="help-back" hotkey={KEYS.back} label="back" onPress={() => update($, view, () => 'list' as const)} />
          </Box>
        </Box>
      )
    }

    if (mode === 'log') {
      const list = (await read($, audit)).slice(-15).reverse()
      return (
        <Box flexDirection="column" width={width}>
          {header}
          {rule}
          <Text bold>Action log (newest first; /prs log prints 20)</Text>
          {list.length === 0 && <Text dimColor>No actions logged yet.</Text>}
          {list.map(one => (
            <Text wrap="truncate-end" color={one.result === 'error' ? 'error' : undefined}>
              {auditLine(one)}
            </Text>
          ))}
          <Box marginTop={1}>
            <Button key="log-back" hotkey={KEYS.back} label="back" onPress={() => update($, view, () => 'list' as const)} />
          </Box>
        </Box>
      )
    }

    if (snap === null) {
      return (
        <Box flexDirection="column" width={width}>
          {header}
          <Text dimColor>Checking open PRs...</Text>
        </Box>
      )
    }

    const pr = snap.prs.find(one => one.number === open)
    const full = info !== null && !('error' in info) && pr !== undefined && info.number === pr.number ? info : null
    const mine = act !== null && pr !== undefined && act.number === pr.number ? act : null

    return (
      <Box flexDirection="column" width={width}>
        {header}
        {snap.error !== null && <Text color="error">{snap.error}</Text>}
        {snap.error === null && snap.prs.length === 0 && <Text dimColor>No open PRs.</Text>}
        {snap.prs.map((one, index) => {
          const r = review(one)
          const m = merge(one)
          const isOpen = one.number === open
          const isAgent = agentSignals(one, isOpen && full !== null ? full : undefined).length > 0

          return (
            <Box key={`pr-${one.number}`} flexDirection="column" marginTop={1}>
              <Button
                key={`row-${one.number}`}
                plain
                {...(index < 9 ? { hotkey: String(index + 1) } : {})}
                onPress={() => select($, isOpen ? null : one.number)}
              >
                <Text bold color={isOpen ? 'suggestion' : undefined}>
                  {isOpen ? '▾' : '▸'} #{one.number}
                </Text>{' '}
                {one.title}
              </Button>
              <Text wrap="truncate-end">
                <Text dimColor>{one.author} · {created(one.createdAt, snap.checkedAt)} · </Text>
                <Text color={r.color}>{r.label}</Text>
                <Text dimColor> · </Text>
                <Text color={m.color}>{m.label}</Text>
                {isAgent && <Text color="claude"> · agent</Text>}
                {isLarge(one) && <Text color="warning"> · large ({one.additions + one.deletions} lines)</Text>}
              </Text>
              {one.reviewers.length > 0 && (
                <Text wrap="truncate-end">
                  <Text dimColor>reviewed: </Text>
                  {one.reviewers.map((rv, at) => (
                    <Text>
                      {at > 0 && <Text dimColor> · </Text>}
                      {rv.author} <Text color={reviewState(rv.state).color}>{reviewState(rv.state).label}</Text>
                      <Text dimColor> {age(rv.submittedAt, snap.checkedAt)}</Text>
                    </Text>
                  ))}
                </Text>
              )}
            </Box>
          )
        })}

        {pr !== undefined && (
          <Box key="detail" flexDirection="column" marginTop={1}>
            {rule}
            <Text bold wrap="truncate-end">
              #{pr.number} {pr.title}
            </Text>
            {info === null || info.number !== pr.number ? (
              <Text dimColor>Loading details...</Text>
            ) : 'error' in info ? (
              <Text color="error">{info.error}</Text>
            ) : (
              <Box flexDirection="column">
                <Text wrap="truncate-end">
                  <Text dimColor>{info.headRefName} → {info.baseRefName} · {info.headRefOid.slice(0, 7)} · </Text>
                  <Text color="diffAdded">+{info.additions}</Text>{' '}
                  <Text color="diffRemoved">-{info.deletions}</Text>
                  <Text dimColor> · {info.changedFiles} files · {info.commitCount} commits</Text>
                  {viewed.includes(diffKey(info)) && <Text color="success"> · diff viewed</Text>}
                </Text>
                {agentSignals(pr, info).length > 0 && (
                  <Text color="claude" wrap="truncate-end">agent: {agentSignals(pr, info).join(' · ')}</Text>
                )}
                {info.sensitive.length > 0 && (
                  <Text color="warning" wrap="truncate-end">sensitive paths: {info.sensitive.join(', ')}</Text>
                )}
                <Text wrap="truncate-end">
                  <Text dimColor>checks: </Text>
                  <Text color="success">{info.checks.passed} passed</Text>
                  {info.checks.failed > 0 && <Text color="error">, {info.checks.failed} failed</Text>}
                  {info.checks.pending > 0 && <Text color="warning">, {info.checks.pending} pending</Text>}
                </Text>
                {info.checks.failing.length > 0 && (
                  <Text color="error" wrap="truncate-end">failing: {info.checks.failing.join(', ')}</Text>
                )}
                {info.reviews.length === 0 ? (
                  <Text dimColor>reviews: none yet</Text>
                ) : (
                  <Box flexDirection="column">
                    <Text dimColor>reviews (newest first):</Text>
                    {info.reviews.slice(0, REVIEW_ROWS).map(rv => (
                      <Text wrap="truncate-end">
                        {'  '}{rv.author} <Text color={reviewState(rv.state).color}>{reviewState(rv.state).label}</Text>
                        <Text dimColor> · {when(rv.submittedAt, snap.checkedAt)}</Text>
                        {rv.commit !== '' && rv.commit !== info.headRefOid && <Text color="warning"> · on older commit {rv.commit.slice(0, 7)}</Text>}
                      </Text>
                    ))}
                    {info.reviews.length > REVIEW_ROWS && <Text dimColor>{'  '}+{info.reviews.length - REVIEW_ROWS} earlier</Text>}
                  </Box>
                )}
                {info.labels.length > 0 && <Text dimColor wrap="truncate-end">labels: {info.labels.join(', ')}</Text>}
                {info.body.trim() !== '' && (
                  <Box flexDirection="column" marginTop={1}>
                    {info.body.trim().split('\n').slice(0, BODY_LINES).map(line => (
                      <Text wrap="truncate-end">{line || ' '}</Text>
                    ))}
                  </Box>
                )}
              </Box>
            )}

            <Box marginTop={1}>
              <Text dimColor>review </Text>
              <Button key="review" hotkey={KEYS.review} label="code review" variant="primary" onPress={() => runReview($, pr.number)} />
              <Text> </Text>
              {full !== null && <Button key="diff" hotkey={KEYS.diff} label="diff" onPress={() => viewDiff($, full)} />}
              <Text> </Text>
              {full !== null && <Button key="approve" hotkey={KEYS.approve} label="approve" onPress={() => approve($, pr, full.headRefOid, false)} />}
              <Text> </Text>
              <Button key="comment" hotkey={KEYS.comment} label="comment" onPress={() => setAction($, { number: pr.number, kind: 'compose-comment', text: '', label: 'suggestion', isBlocking: false })} />
              <Text> </Text>
              <Button key="changes" hotkey={KEYS.changes} label="request changes" onPress={() => setAction($, { number: pr.number, kind: 'compose-changes', text: '', label: 'issue', isBlocking: true })} />
            </Box>
            <Box>
              <Text dimColor>ship   </Text>
              {canMerge(pr) && full !== null && <Button key="merge" hotkey={KEYS.merge} label="merge" onPress={() => confirmMerge($, pr, full.headRefOid)} />}
              {canMerge(pr) && full !== null && <Text> </Text>}
              {isBehind(pr) && (
                <Button
                  key="update-branch"
                  hotkey={KEYS.update}
                  label="update branch"
                  onPress={() => runGh($, pr.number, 'update-branch', [['pr', 'update-branch', String(pr.number)]], `Updating #${pr.number} from ${full?.baseRefName ?? 'base'}...`, `Updated branch of PR #${pr.number}`)}
                />
              )}
              {isBehind(pr) && <Text> </Text>}
              {full !== null && full.failedRuns.length > 0 && (
                <Button key="rerun" hotkey={KEYS.rerun} label="re-run failed" onPress={() => rerun($, pr.number, full.failedRuns, false)} />
              )}
              {full !== null && full.failedRuns.length > 0 && <Text> </Text>}
              <Button key="web" hotkey={KEYS.open} label="open" onPress={() => void gh($, ['pr', 'view', String(pr.number), '--web'])} />
              <Text> </Text>
              <Button key="close-pr" hotkey={KEYS.close} label="close PR" onPress={() => setAction($, { number: pr.number, kind: 'confirm-close', text: '' })} />
              <Text> </Text>
              <Button key="back" hotkey={KEYS.back} label="back" onPress={() => select($, null)} />
            </Box>
            {full !== null && full.failedRuns.length > 0 && (
              <Text dimColor>re-run tests the same commit with the original actor's permissions</Text>
            )}

            {mine !== null && mine.kind === 'confirm-approve' && full !== null && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="warning">Before approving #{pr.number}:</Text>
                {(mine.warnings ?? []).map(line => <Text color="warning" wrap="truncate-end">• {line}</Text>)}
                <Box>
                  <Button key="approve-diff" label="view diff first" variant="primary" onPress={() => viewDiff($, full).then(() => setAction($, null))} />
                  <Text> </Text>
                  <Button key="approve-anyway" label="approve anyway" onPress={() => approve($, pr, mine.sha ?? full.headRefOid, true)} />
                  <Text> </Text>
                  <Button key="approve-cancel" label="cancel" onPress={() => setAction($, null)} />
                </Box>
              </Box>
            )}
            {mine !== null && mine.kind === 'confirm-rerun' && full !== null && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="warning" wrap="wrap">{mine.text}</Text>
                <Box>
                  <Button key="rerun-anyway" label="re-run anyway" onPress={() => rerun($, pr.number, full.failedRuns, true)} />
                  <Text> </Text>
                  <Button key="rerun-cancel" label="cancel" onPress={() => setAction($, null)} />
                </Box>
              </Box>
            )}
            {mine !== null && mine.kind === 'confirm-merge' && mine.sha !== undefined && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="warning">
                  Merge #{pr.number} at {mine.sha.slice(0, 7)} into {full?.baseRefName ?? 'base'}? This can't be undone.
                </Text>
                {(mine.warnings ?? []).map(line => <Text color="warning" wrap="truncate-end">• {line}</Text>)}
                <Text dimColor>
                  merge commit keeps each commit and author · squash folds {full?.commitCount ?? 'all'} commits into one
                </Text>
                <Box>
                  <Button key="merge-commit" label="merge commit" onPress={() => runMerge($, pr.number, '--merge', mine.sha ?? '')} />
                  <Text> </Text>
                  <Button key="merge-squash" label="squash" onPress={() => runMerge($, pr.number, '--squash', mine.sha ?? '')} />
                  <Text> </Text>
                  <Button key="merge-cancel" label="cancel" onPress={() => setAction($, null)} />
                </Box>
              </Box>
            )}
            {mine !== null && mine.kind === 'confirm-close' && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="warning">Close #{pr.number} without merging? Add an optional reason.</Text>
                {Input === null ? noInput : (
                  <Input
                    key="close-reason"
                    autoFocus
                    placeholder="Reason (optional)"
                    submitLabel="close PR"
                    onSubmit={(reason: string) =>
                      runGh($, pr.number, 'close', [['pr', 'close', String(pr.number), ...(reason.trim() === '' ? [] : ['--comment', reason.trim()])]], `Closing #${pr.number}...`, `Closed PR #${pr.number}`)
                    }
                  />
                )}
                <Button key="close-cancel" label="cancel" onPress={() => setAction($, null)} />
              </Box>
            )}
            {mine !== null && (mine.kind === 'compose-comment' || mine.kind === 'compose-changes') && (
              <Box flexDirection="column" marginTop={1}>
                <Text color={mine.kind === 'compose-changes' ? 'warning' : undefined}>
                  {mine.kind === 'compose-changes' ? `Request changes on #${pr.number}: tell ${pr.author} what to fix.` : `Comment on #${pr.number} for ${pr.author}.`}
                </Text>
                {Input === null || Select === null ? noInput : (
                  <Box flexDirection="column">
                    <Box>
                      <Select
                        key="feedback-label"
                        label="label"
                        value={mine.label}
                        options={FEEDBACK_LABELS.map(value => ({ value }))}
                        onSelect={(value: string) => setAction($, { ...mine, label: value })}
                      />
                      <Text> </Text>
                      <Button
                        key="feedback-blocking"
                        label={mine.isBlocking === true ? 'blocking' : 'non-blocking'}
                        onPress={() => setAction($, { ...mine, isBlocking: mine.isBlocking !== true })}
                      />
                    </Box>
                    <Text dimColor wrap="truncate-end">
                      sent as **{mine.label ?? 'issue'} ({mine.isBlocking === true ? 'blocking' : 'non-blocking'}):** your text
                    </Text>
                    <Input
                      key={mine.kind}
                      autoFocus
                      rows={3}
                      placeholder="Feedback for the author"
                      submitLabel={mine.kind === 'compose-changes' ? 'request changes' : 'comment'}
                      onSubmit={(body: string) => sendFeedback($, pr, mine, body)}
                    />
                  </Box>
                )}
                {mine.text !== '' && <Text color="error">{mine.text}</Text>}
                <Button key="compose-cancel" label="cancel" onPress={() => setAction($, null)} />
              </Box>
            )}
            {mine !== null && (mine.kind === 'busy' || mine.kind === 'done' || mine.kind === 'error') && (
              <Text color={mine.kind === 'error' ? 'error' : mine.kind === 'done' ? 'success' : 'warning'} wrap="truncate-end">
                {mine.text}
              </Text>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
