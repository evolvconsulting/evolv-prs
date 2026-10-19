import { expect, test } from 'claude-code/testing'

import type { Detail, Divergence, Pr, Rules } from '../types'
import { branchLine, gateRows, gates, mermaid, tones } from '../hooks/diagram'

const PR: Pr = {
  number: 7, title: 't', author: 'dev', isBot: false, headRefName: 'feat/x', createdAt: '2026-10-01T00:00:00Z',
  isDraft: false, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
  additions: 10, deletions: 2, changedFiles: 1, reviewers: [], url: 'u',
}
const INFO: Detail = {
  number: 7, headRefOid: 'abc1234def', headRefName: 'feat/x', baseRefName: 'dev', additions: 10, deletions: 2,
  changedFiles: 1, commitCount: 1, labels: [], reviews: [{ author: 'ann', state: 'APPROVED', submittedAt: '', commit: 'abc1234def' }],
  checks: { passed: 4, failed: 1, pending: 0, failing: ['lint'] }, failedRuns: [], trailers: [], sensitive: [], filesChecked: 1,
  viewerOwns: null, body: '',
}
const RULES: Rules = {
  base: 'dev', state: 'rules', sources: ['rulesets'], approvals: 2, isCodeOwnerReview: true, isLastPushApproval: false,
  isDismissStale: false, requiredChecks: ['lint'], checkedAt: 0,
}
const BRANCH: Divergence = { base: 'dev', head: 'feat/x', sha: 'abc1234def', ahead: 5, behind: 3, checkedAt: 0 }

test('orders the gates and colours met, first blocker and the rest', async () => {
  const list = gates(PR, INFO, RULES)
  expect(list.map(gate => gate.label)).toEqual(['approvals 1/2', 'CODEOWNERS', 'checks 4/5', 'up to date', 'mergeable'])
  expect(tones(list)).toEqual(['blocker', 'pending', 'pending', 'met', 'met'])
  const ready = gates({ ...PR, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }, {
    ...INFO, reviews: [...INFO.reviews, { author: 'bo', state: 'APPROVED', submittedAt: '', commit: 'abc1234def' }],
    checks: { passed: 5, failed: 0, pending: 0, failing: [] },
  }, RULES)
  expect(tones(ready)).toEqual(['met', 'met', 'met', 'met', 'met'])
})

test('falls back to GitHub\'s verdicts without rules, and names each blocker', async () => {
  expect(gates(PR, INFO).map(gate => gate.label)).toEqual(['review required', 'checks 4/5', 'up to date', 'mergeable'])
  expect(gates({ ...PR, reviewDecision: '' }, INFO)[0]).toEqual({ name: 'approvals', label: 'no review needed', isMet: true })
  expect(gates({ ...PR, reviewDecision: 'CHANGES_REQUESTED' }, INFO, RULES)[0]?.label).toBe('changes requested')
  const stuck = gates({ ...PR, mergeStateStatus: 'BEHIND', isDraft: true }, { ...INFO, checks: { passed: 0, failed: 0, pending: 0, failing: [] } })
  expect(stuck.map(gate => `${gate.label}:${gate.isMet}`)).toEqual(['review required:false', 'no checks:true', 'behind base:false', 'draft:false'])
  expect(gates({ ...PR, mergeable: 'CONFLICTING' }, INFO).at(-1)?.label).toBe('conflicts')
  expect(gates({ ...PR, mergeStateStatus: 'DIRTY' }, INFO).at(-1)?.label).toBe('conflicts')
})

test('keeps the chain on one row when it fits, else one gate per row', async () => {
  const list = gates(PR, INFO, RULES)
  const chain = 'approvals 1/2 ─▶ CODEOWNERS ─▶ checks 4/5 ─▶ up to date ─▶ mergeable'
  expect(chain.length).toBe(68)
  expect(gateRows(list, 68)).toEqual([list])
  expect(gateRows(list, 67)).toEqual(list.map(gate => [gate]))
})

test('draws the branch line, and says when the compare failed', async () => {
  expect(branchLine(BRANCH)).toBe('dev ◀── 3 behind · 5 ahead ── feat/x')
  expect(branchLine(undefined)).toBe('branch: checking...')
  expect(branchLine({ ...BRANCH, error: 'gh: Not Found (HTTP 404)' })).toBe("branch: couldn't compare feat/x with dev (gh: Not Found (HTTP 404))")
})

test('writes both diagrams as fenced Mermaid', async () => {
  expect(mermaid(PR, INFO, gates(PR, INFO, RULES), BRANCH)).toBe([
    'Merge readiness of #7 at abc1234:',
    '',
    '```mermaid',
    'flowchart LR',
    '  g0["approvals 1/2"]:::blocker',
    '  g1["CODEOWNERS"]:::pending',
    '  g2["checks 4/5"]:::pending',
    '  g3["up to date"]:::met',
    '  g4["mergeable"]:::met',
    '  g0 --> g1 --> g2 --> g3 --> g4',
    '  classDef met fill:#dcfce7,stroke:#16a34a,color:#14532d',
    '  classDef blocker fill:#fee2e2,stroke:#dc2626,color:#7f1d1d',
    '  classDef pending fill:#f3f4f6,stroke:#9ca3af,color:#6b7280',
    '```',
    '',
    '```mermaid',
    'flowchart RL',
    '  head["feat/x"] -- "5 ahead · 3 behind" --> base["dev"]',
    '```',
  ].join('\n'))
  expect(mermaid(PR, INFO, gates(PR, INFO), { ...BRANCH, error: 'x' })).not.toContain('flowchart RL')
  expect(mermaid({ ...PR }, INFO, [{ name: 'approvals', label: 'say "hi"', isMet: true }])).toContain('g0["say #quot;hi#quot;"]:::met')
})
