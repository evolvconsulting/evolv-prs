import type { Checks, Detail, Pr, Review, Rules } from '../types'

export const FIELDS =
  'number,title,author,headRefName,createdAt,isDraft,reviewDecision,mergeable,mergeStateStatus,additions,deletions,changedFiles,latestReviews,url'

export const DETAIL_FIELDS =
  'number,headRefOid,headRefName,baseRefName,additions,deletions,changedFiles,commits,files,labels,reviews,statusCheckRollup,body'

// Past either limit a PR is flagged as large (Google's small-CL guidance, rounded).
export const LARGE_LINES = 400
export const LARGE_FILES = 20

const FAILED = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']
const AGENT_BRANCH = /^(copilot|claude|codex|devin|cursor|jules|gemini)[/-]/i
const AGENT_TRAILER =
  /^(co-authored-by|assisted-by|generated-by):.*(claude|anthropic|copilot|codex|openai|devin|cursor|gemini|jules)/gim
const SENSITIVE = [
  /^\.github\/workflows\//,
  /^\.github\/actions\//,
  /(^|\/)CODEOWNERS$/,
  /(^|\/)\.env(\.|$)/,
  /(^|[/_.-])(auth|secrets?|credentials?|permissions?|security)([/_.-]|$)/i,
]

type RawReview = { author: { login: string } | null; state: string; submittedAt?: string; commit?: { oid: string } | null }

export function parseReviews(raw: RawReview[] | null): Review[] {
  return (raw ?? [])
    .map(one => ({
      author: one.author?.login ?? 'unknown',
      state: one.state,
      submittedAt: one.submittedAt ?? '',
      commit: one.commit?.oid ?? '',
    }))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

type Raw = Omit<Pr, 'author' | 'isBot' | 'reviewers'> & {
  author: { login: string; is_bot?: boolean } | null
  latestReviews: RawReview[] | null
}

export function parsePrs(stdout: string): Pr[] {
  const raw = JSON.parse(stdout) as Raw[]

  return raw.map(({ author, latestReviews, ...one }) => ({
    ...one,
    reviewers: parseReviews(latestReviews),
    author: author?.login ?? 'unknown',
    isBot: author?.is_bot === true || /\[bot\]$/.test(author?.login ?? ''),
  }))
}

type RawCheck = { name?: string; detailsUrl?: string; context?: string; status?: string; conclusion?: string; state?: string }

export function summarizeChecks(rollup: RawCheck[] | null): Checks {
  const checks: Checks = { passed: 0, failed: 0, pending: 0, failing: [] }
  for (const one of rollup ?? []) {
    // CheckRun has status + conclusion; StatusContext has state.
    const result = (one.conclusion || one.state || one.status || '').toUpperCase()
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(result)) checks.passed += 1
    else if (FAILED.includes(result)) {
      checks.failed += 1
      checks.failing.push(one.name ?? one.context ?? 'check')
    } else checks.pending += 1
  }

  return checks
}

// GitHub Actions run ids of failed checks, read from each check's details URL.
export function failedRunIds(rollup: RawCheck[] | null): string[] {
  const ids = new Set<string>()
  for (const one of rollup ?? []) {
    const result = (one.conclusion || one.state || '').toUpperCase()
    const id = /\/actions\/runs\/(\d+)/.exec(one.detailsUrl ?? '')?.[1]
    if (FAILED.includes(result) && id !== undefined) ids.add(id)
  }

  return [...ids]
}

// Distinct agent trailers across commit messages, e.g. "Co-Authored-By: Claude ...".
export function agentTrailers(messages: string[]): string[] {
  const found = new Set<string>()
  for (const text of messages) {
    for (const match of text.matchAll(AGENT_TRAILER)) found.add(match[0].trim().slice(0, 80))
  }

  return [...found]
}

const CATCH_ALL = ['*', '/*', '**', '/**', '/']

function codeownersPattern(pattern: string): RegExp {
  const anchored = pattern.startsWith('/')
  const body = pattern
    .replace(/^\//, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*')
  const tail = pattern.endsWith('/') ? '.*' : '(/.*)?'

  return new RegExp(`${anchored ? '^' : '(^|/)'}${body}${tail}$`)
}

function codeownersLines(text: string): { pattern: string; owners: string[] }[] {
  return text
    .split('\n')
    .map(line => line.replace(/#.*/, '').trim().split(/\s+/))
    .filter(([pattern]) => pattern !== undefined && pattern !== '')
    .map(([pattern, ...owners]) => ({ pattern: pattern as string, owners }))
}

// A CODEOWNERS file as a path test: last-match semantics don't matter here, only "owned or not".
export function codeownersMatcher(text: string): (path: string) => boolean {
  const patterns = codeownersLines(text)
    // A catch-all default owner (`* @org`) would mark every path; it says nothing about sensitivity.
    .filter(line => !CATCH_ALL.includes(line.pattern))
    .map(line => codeownersPattern(line.pattern))

  return path => patterns.some(re => re.test(path))
}

// A CODEOWNERS file as path -> owners, as GitHub reads it: the last matching line wins, a catch-all included.
export function codeownersOwners(text: string): (path: string) => string[] {
  const lines = codeownersLines(text).map(line => ({ re: codeownersPattern(line.pattern), owners: line.owners })).reverse()

  return path => lines.find(line => line.re.test(path))?.owners ?? []
}

// Whether `viewer`, directly or through one of `teams` (`org/slug`), owns any of `paths`.
export function ownsAny(paths: string[], ownersOf: (path: string) => string[], viewer: string, teams: string[]): boolean {
  const mine = new Set([`@${viewer}`, ...teams.map(team => `@${team}`)].map(one => one.toLowerCase()))

  return paths.some(path => ownersOf(path).some(owner => mine.has(owner.toLowerCase())))
}

export function sensitivePaths(paths: string[], owned?: (path: string) => boolean): string[] {
  return paths.filter(path => SENSITIVE.some(re => re.test(path)) || owned?.(path) === true)
}

type RawDetail = Omit<Detail, 'labels' | 'reviews' | 'checks' | 'failedRuns' | 'trailers' | 'sensitive' | 'filesChecked' | 'commitCount' | 'viewerOwns'> & {
  labels: { name: string }[] | null
  reviews: RawReview[] | null
  statusCheckRollup: RawCheck[] | null
  commits: { messageHeadline: string; messageBody: string }[] | null
  files: { path: string }[] | null
}

// `paths` is the full file list from the REST files API; `gh pr view` stops at 100 files.
export function parseDetail(stdout: string, owned?: (path: string) => boolean, paths?: string[]): Detail {
  const raw = JSON.parse(stdout) as RawDetail
  const commits = raw.commits ?? []
  const files = paths ?? (raw.files ?? []).map(file => file.path)

  return {
    number: raw.number,
    headRefOid: raw.headRefOid,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    commitCount: commits.length,
    labels: (raw.labels ?? []).map(label => label.name),
    reviews: parseReviews(raw.reviews),
    checks: summarizeChecks(raw.statusCheckRollup),
    failedRuns: failedRunIds(raw.statusCheckRollup),
    trailers: agentTrailers(commits.map(one => one.messageBody)),
    sensitive: sensitivePaths(files, owned),
    filesChecked: files.length,
    viewerOwns: null,
    body: raw.body ?? '',
  }
}

export function agentSignals(pr: Pr, info?: Detail): string[] {
  const signals: string[] = []
  if (pr.isBot) signals.push(`bot author ${pr.author}`)
  if (AGENT_BRANCH.test(pr.headRefName)) signals.push(`agent branch ${pr.headRefName}`)
  for (const trailer of info?.trailers ?? []) signals.push(trailer)

  return signals
}

export function isLarge(pr: Pr): boolean {
  return pr.additions + pr.deletions > LARGE_LINES || pr.changedFiles > LARGE_FILES
}

export function diffKey(info: Detail): string {
  return `${info.number}@${info.headRefOid}`
}

// Reasons to pause before approving; empty means approve straight away.
export function approvalWarnings(pr: Pr, info: Detail, hasViewedDiff: boolean, rules?: Rules): string[] {
  const warnings: string[] = []
  if (rules?.isCodeOwnerReview === true && info.viewerOwns === false) {
    warnings.push(`${rules.base} requires a code owner's review, and you don't own any changed path, so your approval won't count toward it.`)
  }
  const agent = agentSignals(pr, info)
  if (agent.length > 0 && !hasViewedDiff) {
    warnings.push(`Agent-authored (${agent[0]}) and you haven't opened the diff this session.`)
  }
  if (info.sensitive.length > 0) {
    const shown = info.sensitive.slice(0, 3).join(', ')
    const more = info.sensitive.length > 3 ? ` +${info.sensitive.length - 3} more` : ''
    warnings.push(`Touches workflow, CODEOWNERS or auth paths: ${shown}${more}.`)
  }
  if (isLarge(pr)) {
    warnings.push(`Large PR: ${pr.additions + pr.deletions} lines in ${pr.changedFiles} files.`)
  }
  if (info.filesChecked < info.changedFiles) {
    warnings.push(`Only ${info.filesChecked} of ${info.changedFiles} files were checked for sensitive paths.`)
  }
  if (info.checks.failed > 0) warnings.push(`${info.checks.failed} checks failing: ${info.checks.failing.join(', ')}.`)
  if (info.checks.pending > 0) warnings.push(`${info.checks.pending} checks still running.`)

  return warnings
}

// Approve's reasons, plus what merge would ship without: the base branch's unmet rules when they are known.
export function mergeWarnings(pr: Pr, info: Detail, hasViewedDiff: boolean, rules?: Rules): string[] {
  const warnings = approvalWarnings(pr, info, hasViewedDiff)
  if (rules?.state === 'rules') {
    const unmet = unmetRules(pr, info, rules)
    // Failing checks the rules require are already listed as unmet.
    const isAllRequired = info.checks.failing.every(name => rules.requiredChecks.includes(name))
    return [...unmet, ...warnings.filter(line => !(isAllRequired && line.endsWith(`checks failing: ${info.checks.failing.join(', ')}.`)))]
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') warnings.unshift('Changes were requested and not yet approved.')
  else if (pr.reviewDecision !== 'APPROVED') warnings.unshift('No approving review.')

  return warnings
}

export const RULES_TTL_MS = 10 * 60_000

type Answer = { ok: boolean; out: string }

type RawRule = {
  type: string
  parameters?: {
    required_approving_review_count?: number
    require_code_owner_review?: boolean
    require_last_push_approval?: boolean
    dismiss_stale_reviews_on_push?: boolean
    required_status_checks?: { context: string }[]
  } | null
}

type RawProtection = {
  required_pull_request_reviews?: {
    required_approving_review_count?: number
    require_code_owner_reviews?: boolean
    require_last_push_approval?: boolean
    dismiss_stale_reviews?: boolean
  } | null
  required_status_checks?: { contexts?: string[]; checks?: { context: string }[] } | null
}

function httpStatus(out: string): number | null {
  const found = /\(HTTP (\d{3})\)/.exec(out)

  return found === null ? null : Number(found[1])
}

// Rulesets need only read access and stand for the branch's rules; classic protection needs admin, so its 403
// or 404 says nothing on its own and it only adds to what rulesets said. Several pull_request rules can apply
// (repository and organization rulesets): the highest count and any flag win.
export function parseRules(base: string, rulesets: Answer, protection: Answer, checkedAt: number): Rules {
  const rules: Rules = {
    base, state: 'none', sources: [], approvals: 0, isCodeOwnerReview: false, isLastPushApproval: false,
    isDismissStale: false, requiredChecks: [], checkedAt,
  }
  const checks = new Set<string>()
  try {
    if (rulesets.ok) {
      rules.sources.push('rulesets')
      for (const rule of JSON.parse(rulesets.out) as RawRule[]) {
        const params = rule.parameters ?? {}
        if (rule.type === 'pull_request') {
          rules.approvals = Math.max(rules.approvals, params.required_approving_review_count ?? 0)
          rules.isCodeOwnerReview ||= params.require_code_owner_review === true
          rules.isLastPushApproval ||= params.require_last_push_approval === true
          rules.isDismissStale ||= params.dismiss_stale_reviews_on_push === true
        }
        if (rule.type === 'required_status_checks') for (const check of params.required_status_checks ?? []) checks.add(check.context)
      }
    }
    if (protection.ok) {
      rules.sources.push('branch protection')
      const raw = JSON.parse(protection.out) as RawProtection
      const reviews = raw.required_pull_request_reviews
      if (reviews) {
        rules.approvals = Math.max(rules.approvals, reviews.required_approving_review_count ?? 0)
        rules.isCodeOwnerReview ||= reviews.require_code_owner_reviews === true
        rules.isLastPushApproval ||= reviews.require_last_push_approval === true
        rules.isDismissStale ||= reviews.dismiss_stale_reviews === true
      }
      for (const context of raw.required_status_checks?.contexts ?? []) checks.add(context)
      for (const check of raw.required_status_checks?.checks ?? []) checks.add(check.context)
    }
  } catch (err) {
    return { ...rules, state: 'error', error: `unreadable response: ${String(err)}` }
  }
  rules.requiredChecks = [...checks]
  if (rules.sources.length === 0) {
    const status = httpStatus(rulesets.out)
    if (status === 403) return { ...rules, state: 'unreadable' }
    if (status === 404) return rules

    return { ...rules, state: 'error', error: rulesets.out }
  }
  const isRequired = rules.approvals > 0 || rules.isCodeOwnerReview || rules.isLastPushApproval || checks.size > 0

  return { ...rules, state: isRequired ? 'rules' : 'none' }
}

// Approvals as GitHub counts them: each reviewer's latest deciding review (a comment decides nothing), and when
// stale reviews are dismissed on push, only those on the head commit.
export function approvalCount(info: Detail, rules: Rules): number {
  const latest = new Map<string, Review>()
  for (const rv of info.reviews) {
    if (rv.state !== 'COMMENTED' && rv.state !== 'PENDING' && !latest.has(rv.author)) latest.set(rv.author, rv)
  }

  return [...latest.values()]
    .filter(rv => rv.state === 'APPROVED' && (!rules.isDismissStale || rv.commit === '' || rv.commit === info.headRefOid))
    .length
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function rulesLine(rules: Rules | undefined, info: Detail): string {
  if (rules === undefined) return 'rules: checking...'
  if (rules.state === 'unreadable') return 'rules: not readable here (private repo on a free plan; GitHub enforces none)'
  if (rules.state === 'none') return `rules: none on ${rules.base}`
  if (rules.state === 'error') return `rules: couldn't read them (${rules.error ?? 'unknown error'})`
  const parts: string[] = []
  if (rules.approvals > 0) parts.push(`needs ${plural(rules.approvals, 'approval')} (has ${approvalCount(info, rules)})`)
  if (rules.isCodeOwnerReview) parts.push('CODEOWNERS review required')
  if (rules.isLastPushApproval) parts.push("the last pusher can't approve")
  if (rules.requiredChecks.length > 0) {
    const failing = rules.requiredChecks.filter(name => info.checks.failing.includes(name))
    parts.push(`required: ${rules.requiredChecks.join(', ')}${failing.length > 0 ? ` (${failing.join(', ')} failing)` : ''}`)
  }

  return `rules on ${rules.base}: ${parts.join(' · ')} [${rules.sources.join(' + ')}]`
}

// What still stops the merge under the base branch's rules, worst first.
export function unmetRules(pr: Pr, info: Detail, rules: Rules): string[] {
  const unmet: string[] = []
  if (pr.reviewDecision === 'CHANGES_REQUESTED') unmet.push('Changes were requested and not yet approved.')
  const has = approvalCount(info, rules)
  if (has < rules.approvals) {
    unmet.push(`${rules.base} needs ${plural(rules.approvals, 'approval')}; it has ${has}${rules.isDismissStale ? ' on the head commit' : ''}.`)
  } else if (rules.isCodeOwnerReview && pr.reviewDecision === 'REVIEW_REQUIRED') {
    unmet.push(`${rules.base} needs a code owner's approval, and GitHub still reports review required.`)
  }
  const failing = rules.requiredChecks.filter(name => info.checks.failing.includes(name))
  if (failing.length > 0) unmet.push(`Required checks failing: ${failing.join(', ')}.`)

  return unmet
}

// Heuristic for require_last_push_approval: GitHub doesn't expose who pushed, so the head commit's author and
// committer stand in for the pusher.
export function isLastPusher(viewer: string, headLogins: string[]): boolean {
  return headLogins.some(login => login.toLowerCase() === viewer.toLowerCase())
}

export const FEEDBACK_LABELS = ['issue', 'suggestion', 'question', 'nitpick', 'thought', 'praise'] as const

// Conventional Comments: "**issue (blocking):** body".
export function feedbackBody(label: string, isBlocking: boolean, body: string): string {
  return `**${label} (${isBlocking ? 'blocking' : 'non-blocking'}):** ${body.trim()}`
}

export function created(iso: string, now: number): string {
  return `${iso.slice(0, 10)} (${age(iso, now)})`
}

export function age(iso: string, now: number): string {
  if (iso === '') return 'pending'
  const today = Date.parse(new Date(now).toISOString().slice(0, 10))
  const days = Math.round((today - Date.parse(iso.slice(0, 10))) / 86_400_000)

  return days <= 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`
}

// "2026-10-19 15:17 UTC (today)"
export function when(iso: string, now: number): string {
  if (iso === '') return 'pending'

  return `${iso.slice(0, 16).replace('T', ' ')} UTC (${age(iso, now)})`
}

export function reviewState(state: string): Badge {
  switch (state) {
    case 'APPROVED':
      return { label: 'approved', color: 'success' }
    case 'CHANGES_REQUESTED':
      return { label: 'requested changes', color: 'error' }
    case 'DISMISSED':
      return { label: 'dismissed', color: 'subtle' }
    case 'PENDING':
      return { label: 'pending', color: 'subtle' }
    default:
      return { label: 'commented', color: 'subtle' }
  }
}

export type Badge = { label: string; color: 'success' | 'error' | 'warning' | 'subtle' }

export function review(pr: Pr): Badge {
  if (pr.isDraft) return { label: 'draft', color: 'subtle' }
  switch (pr.reviewDecision) {
    case 'APPROVED':
      return { label: 'approved', color: 'success' }
    case 'CHANGES_REQUESTED':
      return { label: 'changes requested', color: 'error' }
    case 'REVIEW_REQUIRED':
      return { label: 'needs review', color: 'warning' }
    default:
      return { label: 'no review', color: 'subtle' }
  }
}

export function merge(pr: Pr): Badge {
  if (pr.mergeable === 'CONFLICTING') return { label: 'conflicts', color: 'error' }
  switch (pr.mergeStateStatus) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { label: 'can merge', color: 'success' }
    case 'UNSTABLE':
      return { label: 'can merge, checks failing', color: 'warning' }
    case 'BEHIND':
      return { label: 'behind base', color: 'warning' }
    case 'BLOCKED':
      return { label: 'blocked', color: 'error' }
    case 'DIRTY':
      return { label: 'conflicts', color: 'error' }
    case 'DRAFT':
      return { label: 'draft', color: 'subtle' }
    default:
      return { label: 'checking', color: 'subtle' }
  }
}

export function canMerge(pr: Pr): boolean {
  return !pr.isDraft && ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(pr.mergeStateStatus)
}

export function isBehind(pr: Pr): boolean {
  return pr.mergeStateStatus === 'BEHIND'
}

// Slack for clock skew between this machine and GitHub.
const SEED_SLACK_MS = 5 * 60_000

export function newPrs(prs: Pr[], seen: number[], seededAt: number): Pr[] {
  const known = new Set(seen)

  return prs.filter(pr => !known.has(pr.number) && Date.parse(pr.createdAt) > seededAt - SEED_SLACK_MS)
}

// The collapsed pane's one line: "5 open · 2 approved · 1 checks failing · 1 conflicts", zero counts left out.
export function summary(prs: Pr[]): string {
  const counts: [number, string][] = [
    [prs.filter(pr => pr.reviewDecision === 'APPROVED').length, 'approved'],
    [prs.filter(pr => pr.mergeStateStatus === 'UNSTABLE').length, 'checks failing'],
    [prs.filter(pr => pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY').length, 'conflicts'],
  ]

  return [`${prs.length} open`, ...counts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`)].join(' · ')
}
