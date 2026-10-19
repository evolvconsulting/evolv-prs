// Claude Code docks a pane beside the conversation only in its fullscreen layout and from this many columns;
// otherwise the pane sits inline, above the prompt. The OS has nothing to do with it.
export const DOCK_COLUMNS = 110

// How to get the docked pane, or null when it can dock now. `/tui fullscreen` saves the setting and relaunches,
// keeping the conversation; pr-pane only says so and never changes the layout itself.
export function layoutAdvice(isFullscreen: boolean, columns: number): string | null {
  if (!isFullscreen) {
    return 'For the pane docked beside the conversation, run /tui fullscreen (it saves the setting and relaunches, '
      + 'keeping this conversation). /tui default switches back.'
  }
  if (columns < DOCK_COLUMNS) return `The pane docks beside the conversation from ${DOCK_COLUMNS} columns; widen the terminal (it's ${columns} now).`

  return null
}

export function layoutReport(isFullscreen: boolean, columns: number): string {
  const now = `Layout: ${isFullscreen ? 'fullscreen' : 'default'}, ${columns} columns.`
  const advice = layoutAdvice(isFullscreen, columns)

  return advice === null
    ? `${now} The pane docks beside the conversation.`
    : `${now} The pane shows below the conversation, above the prompt. ${advice}`
}

// The pane's own one-line tip while it is drawn inline.
export function layoutTip(isFullscreen: boolean | undefined): string {
  return isFullscreen === true
    ? `Tip: widen the terminal to ${DOCK_COLUMNS}+ columns to dock this pane beside the conversation · /prs layout`
    : 'Tip: run /tui fullscreen to dock this pane beside the conversation · /prs layout'
}
