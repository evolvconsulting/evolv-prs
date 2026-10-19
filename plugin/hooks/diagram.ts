import type { Detail, Divergence, Pr, Rules } from '../types'
import { approvalCount } from './prs'

// One step a PR passes on its way to merge, in the order GitHub's merge box reads them.
export type Gate = { name: 'approvals' | 'codeowners' | 'checks' | 'up-to-date' | 'mergeable'; label: string; isMet: boolean }

// met: green · blocker: the first unmet gate, red · pending: unmet gates after it, dim.
export type Tone = 'met' | 'blocker' | 'pending'

export const ARROW = ' ─▶ '
export const DOWN = '└▶ '

// The 0.4.0 rules when they were read, otherwise GitHub's own reviewDecision, then checks, freshness and conflicts.
export function gates(pr: Pr, info: Detail, rules?: Rules): Gate[] {
  const known = rules?.state === 'rules' ? rules : undefined
  const list: Gate[] = []
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    list.push({ name: 'approvals', label: 'changes requested', isMet: false })
  } else if (known !== undefined && known.approvals > 0) {
    const has = approvalCount(info, known)
    list.push({ name: 'approvals', label: `approvals ${has}/${known.approvals}`, isMet: has >= known.approvals })
  } else {
    const label = pr.reviewDecision === 'APPROVED' ? 'approved' : pr.reviewDecision === 'REVIEW_REQUIRED' ? 'review required' : 'no review needed'
    list.push({ name: 'approvals', label, isMet: pr.reviewDecision !== 'REVIEW_REQUIRED' })
  }
  // GitHub folds the code owner's approval into reviewDecision, so it is met once the decision is APPROVED.
  if (known?.isCodeOwnerReview === true) list.push({ name: 'codeowners', label: 'CODEOWNERS', isMet: pr.reviewDecision === 'APPROVED' })
  const { passed, failed, pending } = info.checks
  const total = passed + failed + pending
  list.push({ name: 'checks', label: total === 0 ? 'no checks' : `checks ${passed}/${total}`, isMet: failed === 0 && pending === 0 })
  list.push({ name: 'up-to-date', label: pr.mergeStateStatus === 'BEHIND' ? 'behind base' : 'up to date', isMet: pr.mergeStateStatus !== 'BEHIND' })
  const isConflict = pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY'
  list.push({ name: 'mergeable', label: pr.isDraft ? 'draft' : isConflict ? 'conflicts' : 'mergeable', isMet: !pr.isDraft && !isConflict })

  return list
}

export function tones(list: Gate[]): Tone[] {
  const first = list.findIndex(gate => !gate.isMet)

  return list.map((gate, at) => (gate.isMet ? 'met' : at === first ? 'blocker' : 'pending'))
}

// One row when the chain fits the pane, else one gate per row.
export function gateRows(list: Gate[], width: number): Gate[][] {
  return list.map(gate => gate.label).join(ARROW).length <= width ? [list] : list.map(gate => [gate])
}

export function branchLine(divergence: Divergence | undefined): string {
  if (divergence === undefined) return 'branch: checking...'
  if (divergence.error !== undefined) return `branch: couldn't compare ${divergence.head} with ${divergence.base} (${divergence.error})`

  return `${divergence.base} ◀── ${divergence.behind} behind · ${divergence.ahead} ahead ── ${divergence.head}`
}

function quote(label: string): string {
  return `"${label.replace(/"/g, '#quot;')}"`
}

// Two Mermaid flowcharts in fences, which GitHub renders in a comment: the gates, then the branch.
export function mermaid(pr: Pr, info: Detail, list: Gate[], divergence?: Divergence): string {
  const shade = tones(list)
  const chart = [
    'flowchart LR',
    ...list.map((gate, at) => `  g${at}[${quote(gate.label)}]:::${shade[at]}`),
    `  ${list.map((_, at) => `g${at}`).join(' --> ')}`,
    '  classDef met fill:#dcfce7,stroke:#16a34a,color:#14532d',
    '  classDef blocker fill:#fee2e2,stroke:#dc2626,color:#7f1d1d',
    '  classDef pending fill:#f3f4f6,stroke:#9ca3af,color:#6b7280',
  ]
  const branch = divergence !== undefined && divergence.error === undefined
    ? [
      'flowchart RL',
      `  head[${quote(divergence.head)}] -- ${quote(`${divergence.ahead} ahead · ${divergence.behind} behind`)} --> base[${quote(divergence.base)}]`,
    ]
    : []

  return [
    `Merge readiness of #${pr.number} at ${info.headRefOid.slice(0, 7)}:`,
    '',
    '```mermaid',
    ...chart,
    '```',
    ...(branch.length > 0 ? ['', '```mermaid', ...branch, '```'] : []),
  ].join('\n')
}
