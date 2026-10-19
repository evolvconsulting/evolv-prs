import type { Checks, Detail, Pr, Review } from '../types'

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

// A CODEOWNERS file as a path test: last-match semantics don't matter here, only "owned or not".
export function codeownersMatcher(text: string): (path: string) => boolean {
  const patterns = text
    .split('\n')
    .map(line => line.replace(/#.*/, '').trim().split(/\s+/)[0] ?? '')
    // A catch-all default owner (`* @org`) would mark every path; it says nothing about sensitivity.
    .filter(pattern => pattern !== '' && !['*', '/*', '**', '/**', '/'].includes(pattern))
    .map(pattern => {
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
    })

  return path => patterns.some(re => re.test(path))
}

export function sensitivePaths(paths: string[], owned?: (path: string) => boolean): string[] {
  return paths.filter(path => SENSITIVE.some(re => re.test(path)) || owned?.(path) === true)
}

type RawDetail = Omit<Detail, 'labels' | 'reviews' | 'checks' | 'failedRuns' | 'trailers' | 'sensitive' | 'filesChecked' | 'commitCount'> & {
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
export function approvalWarnings(pr: Pr, info: Detail, hasViewedDiff: boolean): string[] {
  const warnings: string[] = []
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

// Approve's reasons, plus whether the PR has the approval merge would ship it without.
export function mergeWarnings(pr: Pr, info: Detail, hasViewedDiff: boolean): string[] {
  const warnings = approvalWarnings(pr, info, hasViewedDiff)
  if (pr.reviewDecision === 'CHANGES_REQUESTED') warnings.unshift('Changes were requested and not yet approved.')
  else if (pr.reviewDecision !== 'APPROVED') warnings.unshift('No approving review.')

  return warnings
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
