import { expect, test } from 'claude-code/testing'

import type { Pr } from '../types'
import { canMerge, created, failedRunIds, isBehind, merge, newPrs, parseDetail, parsePrs, review, summarizeChecks, summary } from '../hooks/prs'

const RAW = JSON.stringify([
  { number: 18, title: 'A', author: { login: 'phil' }, createdAt: '2026-10-16T12:00:00Z', isDraft: false,
    reviewDecision: 'APPROVED', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', url: 'u' },
  { number: 9, title: 'B', author: { login: 'phil' }, createdAt: '2026-10-05T12:00:00Z', isDraft: false,
    reviewDecision: '', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', url: 'u' },
])

test('classifies approval and mergeability', async () => {
  const [a, b] = parsePrs(RAW) as [Pr, Pr]
  expect(a.author).toBe('phil')
  expect(review(a).label).toBe('approved')
  expect(merge(a).label).toBe('can merge')
  expect(canMerge(a)).toBe(true)
  expect(review(b).label).toBe('no review')
  expect(merge(b).label).toBe('conflicts')
  expect(canMerge(b)).toBe(false)
})

test('finds only PRs not seen before', async () => {
  const prs = parsePrs(RAW)
  const seeded = Date.parse('2026-10-01T00:00:00Z')
  expect(newPrs(prs, [18], seeded).map(pr => pr.number)).toEqual([9])
  expect(newPrs(prs, [18, 9], seeded)).toEqual([])
  // #9 predates seeding: unseen only because it slid into the --limit window, so no toast.
  expect(newPrs(prs, [18], Date.parse('2026-10-19T00:00:00Z'))).toEqual([])
})

test('formats the created date with its age', async () => {
  expect(created('2026-10-16T12:00:00Z', Date.parse('2026-10-19T13:00:00Z'))).toBe('2026-10-16 (3d ago)')
  expect(created('2026-10-19T08:00:00Z', Date.parse('2026-10-19T13:00:00Z'))).toBe('2026-10-19 (today)')
})

test('summarizes checks and parses detail', async () => {
  const checks = summarizeChecks([
    { name: 'Manifests validate', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Strict (advisory)', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'Build', status: 'IN_PROGRESS', conclusion: '' },
    { context: 'ci/legacy', state: 'SUCCESS' },
  ])
  expect(checks).toEqual({ passed: 2, failed: 1, pending: 1, failing: ['Strict (advisory)'] })

  const info = parseDetail(JSON.stringify({
    number: 9, headRefName: 'feat', baseRefName: 'dev', additions: 3, deletions: 1, changedFiles: 2,
    labels: [{ name: 'docs' }], reviews: [{ author: { login: 'jd' }, state: 'APPROVED' }],
    statusCheckRollup: [], body: 'hi',
  }))
  expect(info.labels).toEqual(['docs'])
  expect(info.reviews).toEqual([{ author: 'jd', state: 'APPROVED', submittedAt: '', commit: '' }])
})

test('finds the Actions runs behind failed checks, once each', async () => {
  const runs = failedRunIds([
    { name: 'a', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/37379799173/job/1' },
    { name: 'b', conclusion: 'FAILURE', detailsUrl: 'https://github.com/o/r/actions/runs/37379799173/job/2' },
    { name: 'c', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/o/r/actions/runs/99/job/3' },
    { context: 'external', state: 'FAILURE', detailsUrl: 'https://ci.example.com/build/7' },
  ])
  expect(runs).toEqual(['37379799173'])
})

test('offers update branch only when behind', async () => {
  const [a] = parsePrs(RAW) as [Pr, Pr]
  expect(isBehind(a)).toBe(false)
  expect(isBehind({ ...a, mergeStateStatus: 'BEHIND' })).toBe(true)
})

test('summarizes the list in one line, zero counts left out', async () => {
  const [a, b] = parsePrs(RAW) as [Pr, Pr]
  expect(summary([a, b])).toBe('2 open · 1 approved · 1 conflicts')
  expect(summary([a, { ...b, mergeable: 'MERGEABLE', mergeStateStatus: 'UNSTABLE' }])).toBe('2 open · 1 approved · 1 checks failing')
  expect(summary([])).toBe('0 open')
})
