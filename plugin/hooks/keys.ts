// The one table of hotkeys: the buttons, the help view and `/prs help` all read it.
export const KEYS = {
  refresh: 'r',
  help: 'h',
  log: 'l',
  review: 'c',
  approve: 'a',
  diff: 'd',
  comment: 'f',
  changes: 'q',
  merge: 'm',
  update: 'u',
  rerun: 't',
  open: 'o',
  close: 'x',
  back: 'b',
  collapse: 'z',
} as const

export type KeyName = keyof typeof KEYS

export const HELP: { section: string; rows: { name: KeyName | 'rows'; key: string; what: string }[] }[] = [
  {
    section: 'List',
    rows: [
      { name: 'rows', key: '1-9 / Enter', what: 'Open or close a PR\'s detail view' },
      { name: 'refresh', key: KEYS.refresh, what: 'Refresh now (also every 60 s)' },
      { name: 'log', key: KEYS.log, what: 'Show the action log (Esc also closes it)' },
      { name: 'help', key: KEYS.help, what: 'Show or hide this help (Esc also closes it)' },
      { name: 'collapse', key: KEYS.collapse, what: 'Fold the pane to one summary line, or expand it' },
    ],
  },
  {
    section: 'Review (detail view)',
    rows: [
      { name: 'review', key: KEYS.review, what: 'Run /code-review on the PR (advisory, local)' },
      { name: 'diff', key: KEYS.diff, what: 'Open the diff in the browser; counts as viewed for approve' },
      { name: 'approve', key: KEYS.approve, what: 'Approve; pauses on agent, sensitive-path, size or check warnings' },
      { name: 'comment', key: KEYS.comment, what: 'Comment with a Conventional Comments label' },
      { name: 'changes', key: KEYS.changes, what: 'Request changes with a label and blocking flag' },
    ],
  },
  {
    section: 'Ship (detail view)',
    rows: [
      { name: 'merge', key: KEYS.merge, what: 'Merge (confirm, then merge commit or squash); only when mergeable' },
      { name: 'update', key: KEYS.update, what: 'Update branch from base; only when behind' },
      { name: 'rerun', key: KEYS.rerun, what: 'Re-run failed Actions jobs (same commit); warns after 2 re-runs' },
      { name: 'open', key: KEYS.open, what: 'Open the PR in the browser' },
      { name: 'close', key: KEYS.close, what: 'Close without merging (confirm, optional reason)' },
      { name: 'back', key: KEYS.back, what: 'Back to the list' },
    ],
  },
]

export const COMMANDS = [
  { usage: '/prs', what: 'Open the pane, or close it if it is showing' },
  { usage: '/prs show', what: 'Open the pane and refresh' },
  { usage: '/prs hide', what: 'Close the pane' },
  { usage: '/prs autoOpen', what: 'Say whether the pane opens at session start' },
  { usage: '/prs autoOpen enable', what: 'Open the pane at every session start' },
  { usage: '/prs autoOpen disable', what: 'Open the pane only on /prs (the default)' },
  { usage: '/prs layout', what: 'Say whether the pane can dock beside the conversation, and how' },
  { usage: '/prs diagram <n>', what: "Print PR n's merge readiness and branch as Mermaid, and copy it" },
  { usage: '/prs diagram <n> --post', what: 'Post that Mermaid as a comment on PR n (logged)' },
  { usage: '/prs help', what: 'Print the commands and hotkeys' },
  { usage: '/prs log', what: 'Print the last 20 logged actions' },
  { usage: '/prs refresh', what: 'Refresh now' },
]

// Wide enough for the longest usage, '/prs diagram <n> --post'.
export const USAGE_WIDTH = 24

export function helpText(): string {
  const lines = ['Commands:', ...COMMANDS.map(one => `  ${one.usage.padEnd(USAGE_WIDTH)} ${one.what}`), '']
  for (const group of HELP) {
    lines.push(`${group.section}:`)
    for (const row of group.rows) lines.push(`  ${row.key.padEnd(12)} ${row.what}`)
    lines.push('')
  }
  lines.push('ctrl+x tab focuses the pane; Esc closes help or log and returns to the prompt.')

  return lines.join('\n')
}
