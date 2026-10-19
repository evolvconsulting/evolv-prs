export type Review = { author: string; state: string; submittedAt: string; commit: string }

export type Pr = {
  number: number
  title: string
  author: string
  isBot: boolean
  headRefName: string
  createdAt: string
  isDraft: boolean
  reviewDecision: string
  mergeable: string
  mergeStateStatus: string
  additions: number
  deletions: number
  changedFiles: number
  // Each reviewer's latest review.
  reviewers: Review[]
  url: string
}

export type Snapshot = {
  prs: Pr[]
  error: string | null
  checkedAt: number
}

export type Checks = { passed: number; failed: number; pending: number; failing: string[] }

export type Detail = {
  number: number
  headRefOid: string
  headRefName: string
  baseRefName: string
  additions: number
  deletions: number
  changedFiles: number
  commitCount: number
  labels: string[]
  // Every review, newest first.
  reviews: Review[]
  checks: Checks
  failedRuns: string[]
  trailers: string[]
  sensitive: string[]
  // Paths checked for sensitivity; fewer than changedFiles when the file list was cut.
  filesChecked: number
  body: string
}

export type ActionKind =
  | 'confirm-merge'
  | 'confirm-close'
  | 'confirm-approve'
  | 'confirm-rerun'
  | 'compose-comment'
  | 'compose-changes'
  | 'busy'
  | 'done'
  | 'error'

export type Action = {
  number: number
  kind: ActionKind
  text: string
  // Conventional Comments label and blocking flag while composing feedback.
  label?: string
  isBlocking?: boolean
  warnings?: string[]
  // The head commit a confirm was shown for; the action runs against it or not at all.
  sha?: string
}

export type View = 'list' | 'help' | 'log'

export type Who = { viewer: string; repo: string }

export type AuditEntry = {
  at: string
  actor: string
  repo: string
  pr: number
  sha: string
  action: string
  result: 'ok' | 'error'
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    'pr-pane': {
      snapshot: Snapshot | null
      seen: number[] | null
      // When `seen` was first filled; only PRs created after it toast.
      seededAt: number | null
      selected: number | null
      detail: Detail | { number: number; error: string } | null
      action: Action | null
      view: View
      who: Who | null
      diffViewed: string[]
      audit: AuditEntry[]
      reruns: Record<string, number>
    }
  }
}
