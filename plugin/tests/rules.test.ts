import { expect, test } from 'claude-code/testing'

import type { Detail, Pr, Review } from '../types'
import {
  approvalCount, approvalWarnings, codeownersOwners, isLastPusher, mergeWarnings, ownsAny, parseRules, rulesLine, unmetRules,
} from '../hooks/prs'

const NOW = Date.parse('2026-10-19T12:00:00Z')
const NOT_FOUND = { ok: false, out: 'gh: Not Found (HTTP 404)' }
const PR: Pr = {
  number: 7, title: 't', author: 'dev', isBot: false, headRefName: 'feat/x', createdAt: '2026-10-01T00:00:00Z',
  isDraft: false, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
  additions: 10, deletions: 2, changedFiles: 1, reviewers: [], url: 'u',
}
const INFO: Detail = {
  number: 7, headRefOid: 'head', headRefName: 'feat/x', baseRefName: 'dev', additions: 10, deletions: 2,
  changedFiles: 1, commitCount: 1, labels: [], reviews: [], checks: { passed: 1, failed: 0, pending: 0, failing: [] },
  failedRuns: [], trailers: [], sensitive: [], filesChecked: 1, viewerOwns: null, body: '',
}
const review = (author: string, state: string, commit = 'head'): Review => ({ author, state, submittedAt: '', commit })
const ok = (value: unknown) => ({ ok: true, out: JSON.stringify(value) })
// The shape GitHub returned for microsoft/vscode main, plus a required_status_checks rule like astral-sh/uv's.
const RULESET = ok([
  { type: 'deletion', parameters: null },
  {
    type: 'pull_request',
    parameters: {
      required_approving_review_count: 2, require_code_owner_review: true, require_last_push_approval: true,
      dismiss_stale_reviews_on_push: true, required_review_thread_resolution: false,
    },
  },
  { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci', integration_id: 1 }, { context: 'lint' }] } },
])

test('a 403 is a private repo on a free plan, where GitHub enforces nothing', async () => {
  const rules = parseRules('dev', { ok: false, out: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)' }, NOT_FOUND, NOW)
  expect(rules.state).toBe('unreadable')
  expect(rulesLine(rules, INFO)).toBe('rules: not readable here (private repo on a free plan; GitHub enforces none)')
})

test('a 404, or rulesets that require nothing, read as none', async () => {
  expect(rulesLine(parseRules('dev', NOT_FOUND, NOT_FOUND, NOW), INFO)).toBe('rules: none on dev')
  const empty = parseRules('dev', ok([]), NOT_FOUND, NOW)
  expect(empty.state).toBe('none')
  expect(empty.sources).toEqual(['rulesets'])
  expect(parseRules('dev', ok([{ type: 'deletion', parameters: null }]), NOT_FOUND, NOW).state).toBe('none')
})

test('any other failure is an error, not a claim that there are no rules', async () => {
  const rules = parseRules('dev', { ok: false, out: 'gh: Server Error (HTTP 500)' }, NOT_FOUND, NOW)
  expect(rules.state).toBe('error')
  expect(rulesLine(rules, INFO)).toContain("rules: couldn't read them")
  expect(parseRules('dev', { ok: true, out: 'not json' }, NOT_FOUND, NOW).state).toBe('error')
})

test('reads every pull_request parameter and the required checks from rulesets', async () => {
  const rules = parseRules('dev', RULESET, NOT_FOUND, NOW)
  expect(rules).toEqual({
    base: 'dev', state: 'rules', sources: ['rulesets'], approvals: 2, isCodeOwnerReview: true, isLastPushApproval: true,
    isDismissStale: true, requiredChecks: ['ci', 'lint'], checkedAt: NOW,
  })
  const failing = { ...INFO, reviews: [review('ann', 'APPROVED')], checks: { passed: 1, failed: 1, pending: 0, failing: ['lint'] } }
  expect(rulesLine(rules, failing)).toBe(
    "rules on dev: needs 2 approvals (has 1) · CODEOWNERS review required · the last pusher can't approve · required: ci, lint (lint failing) [rulesets]",
  )
})

test('several pull_request rules combine: the highest count and any flag', async () => {
  const rules = parseRules('dev', ok([
    { type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: true } },
    { type: 'pull_request', parameters: { required_approving_review_count: 3, require_last_push_approval: false } },
  ]), NOT_FOUND, NOW)
  expect([rules.approvals, rules.isCodeOwnerReview, rules.isLastPushApproval]).toEqual([3, true, false])
})

test('classic branch protection adds to rulesets when it answers, and names itself', async () => {
  const protection = ok({
    required_pull_request_reviews: { required_approving_review_count: 1, require_code_owner_reviews: false, require_last_push_approval: true, dismiss_stale_reviews: false },
    required_status_checks: { strict: true, contexts: ['legacy'], checks: [{ context: 'ci', app_id: null }] },
  })
  const both = parseRules('main', ok([{ type: 'pull_request', parameters: { required_approving_review_count: 2 } }]), protection, NOW)
  expect(both.sources).toEqual(['rulesets', 'branch protection'])
  expect([both.approvals, both.isLastPushApproval, both.requiredChecks]).toEqual([2, true, ['legacy', 'ci']])
  expect(rulesLine(both, INFO)).toContain('[rulesets + branch protection]')
  expect(parseRules('main', NOT_FOUND, protection, NOW).sources).toEqual(['branch protection'])
})

test('counts approvals as GitHub does: latest deciding review, head commit only when stale reviews are dismissed', async () => {
  const rules = parseRules('dev', RULESET, NOT_FOUND, NOW)
  const reviews = [
    review('ann', 'COMMENTED'), review('ann', 'APPROVED'),
    review('bo', 'APPROVED', 'old'),
    review('cy', 'DISMISSED'), review('cy', 'APPROVED'),
  ]
  expect(approvalCount({ ...INFO, reviews }, rules)).toBe(1)
  expect(approvalCount({ ...INFO, reviews }, { ...rules, isDismissStale: false })).toBe(2)
})

test('merge lists the unmet rules in place of "No approving review"', async () => {
  const rules = parseRules('dev', RULESET, NOT_FOUND, NOW)
  const failing = { ...INFO, reviews: [review('ann', 'APPROVED')], checks: { passed: 1, failed: 1, pending: 0, failing: ['lint'] } }
  expect(unmetRules(PR, failing, rules)).toEqual(['dev needs 2 approvals; it has 1 on the head commit.', 'Required checks failing: lint.'])
  const warnings = mergeWarnings(PR, failing, true, rules)
  expect(warnings).not.toContain('No approving review.')
  expect(warnings.filter(line => line.includes('lint'))).toEqual(['Required checks failing: lint.'])
  const enough = { ...failing, reviews: [review('ann', 'APPROVED'), review('bo', 'APPROVED')], checks: INFO.checks }
  expect(unmetRules(PR, enough, rules)).toEqual(["dev needs a code owner's approval, and GitHub still reports review required."])
  expect(mergeWarnings(PR, INFO, true, parseRules('dev', NOT_FOUND, NOT_FOUND, NOW))[0]).toBe('No approving review.')
})

test('warns before approving when a code owner must review and the viewer owns nothing changed', async () => {
  const rules = parseRules('dev', RULESET, NOT_FOUND, NOW)
  expect(approvalWarnings(PR, { ...INFO, viewerOwns: false }, true, rules)[0]).toContain("you don't own any changed path")
  expect(approvalWarnings(PR, { ...INFO, viewerOwns: true }, true, rules)).toEqual([])
  expect(approvalWarnings(PR, INFO, true, rules)).toEqual([])
})

test('CODEOWNERS owners: the last matching line wins, teams count, and so does a catch-all', async () => {
  const ownersOf = codeownersOwners('* @org/everyone\n/plugin/ @org/plugin-team\n/plugin/hooks/keys.ts @ann\n')
  expect(ownersOf('README.md')).toEqual(['@org/everyone'])
  expect(ownersOf('plugin/hooks/prs.ts')).toEqual(['@org/plugin-team'])
  expect(ownersOf('plugin/hooks/keys.ts')).toEqual(['@ann'])
  expect(ownsAny(['plugin/hooks/keys.ts'], ownersOf, 'Ann', [])).toBe(true)
  expect(ownsAny(['plugin/hooks/prs.ts'], ownersOf, 'bo', ['org/Plugin-Team'])).toBe(true)
  expect(ownsAny(['plugin/hooks/prs.ts'], ownersOf, 'bo', ['org/everyone'])).toBe(false)
})

test('the last pusher is judged from the head commit, case-insensitively', async () => {
  expect(isLastPusher('Rev', ['dev', 'rev'])).toBe(true)
  expect(isLastPusher('rev', ['dev', 'web-flow'])).toBe(false)
})
