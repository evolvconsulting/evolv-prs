import { expect, test } from 'claude-code/testing'

import { DOCK_COLUMNS, layoutAdvice, layoutReport, layoutTip } from '../hooks/layout'

test('advises /tui fullscreen on the default layout, a wider window when fullscreen is narrow, nothing when it docks', async () => {
  expect(layoutAdvice(false, 200)).toContain('run /tui fullscreen')
  expect(layoutAdvice(true, DOCK_COLUMNS - 1)).toBe(`The pane docks beside the conversation from 110 columns; widen the terminal (it's 109 now).`)
  expect(layoutAdvice(true, DOCK_COLUMNS)).toBeNull()
})

test('reports the layout and width with the advice', async () => {
  expect(layoutReport(true, 160)).toBe('Layout: fullscreen, 160 columns. The pane docks beside the conversation.')
  expect(layoutReport(false, 120)).toContain('Layout: default, 120 columns. The pane shows below the conversation, above the prompt. For the pane docked')
  expect(layoutTip(undefined)).toContain('/tui fullscreen')
  expect(layoutTip(true)).toContain('widen the terminal to 110+ columns')
})
