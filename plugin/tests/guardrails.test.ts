import { expect, test } from 'claude-code/testing'

import type { Detail, Pr } from '../types'
import { HELP, KEYS, helpText } from '../hooks/keys'
import {
  age, agentSignals, agentTrailers, approvalWarnings, codeownersMatcher, created, feedbackBody, isLarge, mergeWarnings, parseDetail,
  parsePrs, reviewState, sensitivePaths, when,
} from '../hooks/prs'

const PR: Pr = {
  number: 7, title: 't', author: 'dev', isBot: false, headRefName: 'feat/x', createdAt: '2026-10-01T00:00:00Z',
  isDraft: false, reviewDecision: '', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  additions: 10, deletions: 2, changedFiles: 1, reviewers: [], url: 'u',
}
const INFO: Detail = {
  number: 7, headRefOid: 'abc', headRefName: 'feat/x', baseRefName: 'dev', additions: 10, deletions: 2,
  changedFiles: 1, commitCount: 1, labels: [], reviews: [], checks: { passed: 1, failed: 0, pending: 0, failing: [] },
  failedRuns: [], trailers: [], sensitive: [], filesChecked: 1, viewerOwns: null, body: '',
}

test('flags bot authors, agent branches and agent trailers', async () => {
  const [bot] = parsePrs(JSON.stringify([{ ...PR, author: { login: 'copilot-swe-agent[bot]', is_bot: true } }])) as [Pr]
  expect(bot.isBot).toBe(true)
  expect(agentSignals({ ...PR, headRefName: 'claude/fix-123' })).toEqual(['agent branch claude/fix-123'])
  expect(agentSignals(PR)).toEqual([])
  expect(agentTrailers(['Fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>', 'Assisted-by: Copilot'])).toHaveLength(2)
  expect(agentTrailers(['Co-authored-by: Jane <jane@example.com>'])).toEqual([])
})

test('finds workflow, CODEOWNERS, auth and owned paths', async () => {
  const owned = codeownersMatcher('# owners\n/plugins/edk/ @team\n*.sql @data\ndocs/**/secret.md @sec\n')
  expect(owned('plugins/edk/a.ts')).toBe(true)
  expect(owned('x/y.sql')).toBe(true)
  expect(owned('docs/a/b/secret.md')).toBe(true)
  expect(owned('README.md')).toBe(false)
  expect(sensitivePaths(['.github/workflows/ci.yml', 'CODEOWNERS', 'src/auth/login.ts', '.env.local', 'README.md'])).toEqual([
    '.github/workflows/ci.yml', 'CODEOWNERS', 'src/auth/login.ts', '.env.local',
  ])
})

test('pauses approval only when there is a reason', async () => {
  expect(approvalWarnings(PR, INFO, false)).toEqual([])
  const agent = { ...PR, headRefName: 'copilot/x', additions: 900 }
  const risky = { ...INFO, sensitive: ['.github/workflows/ci.yml'], checks: { passed: 0, failed: 1, pending: 0, failing: ['ci'] } }
  const warnings = approvalWarnings(agent, risky, false)
  expect(warnings).toHaveLength(4)
  expect(approvalWarnings(agent, risky, true)).toHaveLength(3)
  expect(isLarge(agent)).toBe(true)
})

test('formats Conventional Comments feedback', async () => {
  expect(feedbackBody('issue', true, ' null check missing ')).toBe('**issue (blocking):** null check missing')
  expect(feedbackBody('nitpick', false, 'rename')).toBe('**nitpick (non-blocking):** rename')
})

test('hotkeys are unique letters and all documented', async () => {
  const keys = Object.values(KEYS)
  expect(new Set(keys).size).toBe(keys.length)
  for (const key of keys) expect(/^[a-z]$/.test(key)).toBe(true)
  const documented = HELP.flatMap(group => group.rows.map(row => row.name))
  for (const name of Object.keys(KEYS)) expect(documented).toContain(name)
  for (const key of keys) expect(helpText()).toContain(`  ${key} `)
})

test('lists reviewers newest first with when they reviewed', async () => {
  const [pr] = parsePrs(JSON.stringify([{
    ...PR,
    author: { login: 'dev' },
    latestReviews: [
      { author: { login: 'ann' }, state: 'COMMENTED', submittedAt: '2026-10-17T09:00:00Z', commit: { oid: '' } },
      { author: { login: 'jd' }, state: 'APPROVED', submittedAt: '2026-10-19T15:17:07Z', commit: { oid: 'abc' } },
    ],
  }])) as [Pr]
  expect(pr.reviewers.map(rv => rv.author)).toEqual(['jd', 'ann'])
  const now = Date.parse('2026-10-19T18:00:00Z')
  expect(when(pr.reviewers[0]!.submittedAt, now)).toBe('2026-10-19 15:17 UTC (today)')
  expect(age(pr.reviewers[1]!.submittedAt, now)).toBe('2d ago')
  expect(reviewState('CHANGES_REQUESTED').label).toBe('requested changes')
})

test('a catch-all CODEOWNERS default marks nothing sensitive', async () => {
  const owned = codeownersMatcher('* @org/eng\n/** @org/all\n/.github/ @org/platform\n')
  expect(owned('README.md')).toBe(false)
  expect(owned('.github/dependabot.yml')).toBe(true)
})

test('checks every file from the full list, and says when the list was cut', async () => {
  const raw = JSON.stringify({
    number: 7, headRefOid: 'abc', headRefName: 'x', baseRefName: 'dev', additions: 1, deletions: 0, changedFiles: 150,
    commits: [], labels: [], reviews: [], statusCheckRollup: [], body: '',
    files: Array.from({ length: 100 }, (_, i) => ({ path: `src/f${i}.ts` })),
  })
  const full = [...Array.from({ length: 119 }, (_, i) => `src/f${i}.ts`), '.github/workflows/release.yml']
  expect(parseDetail(raw, undefined, full).sensitive).toEqual(['.github/workflows/release.yml'])
  const cut = parseDetail(raw)
  expect(cut.filesChecked).toBe(100)
  expect(approvalWarnings({ ...PR, changedFiles: 150 }, cut, true).some(w => w.startsWith('Only 100 of 150'))).toBe(true)
})

test('merge warns about missing approval and failing checks, as approve does', async () => {
  const failing = { ...INFO, checks: { passed: 0, failed: 1, pending: 0, failing: ['ci'] } }
  expect(mergeWarnings({ ...PR, reviewDecision: 'APPROVED' }, INFO, true)).toEqual([])
  const warnings = mergeWarnings({ ...PR, reviewDecision: 'REVIEW_REQUIRED' }, failing, true)
  expect(warnings[0]).toBe('No approving review.')
  expect(warnings.some(w => w.includes('checks failing: ci'))).toBe(true)
})

test('age counts UTC calendar days, matching the date beside it', async () => {
  const now = Date.parse('2026-10-19T01:00:00Z')
  expect(created('2026-10-18T23:00:00Z', now)).toBe('2026-10-18 (1d ago)')
  expect(created('2026-10-19T00:30:00Z', now)).toBe('2026-10-19 (today)')
  expect(age('2026-10-17T02:00:00Z', Date.parse('2026-10-19T01:00:00Z'))).toBe('2d ago')
})
