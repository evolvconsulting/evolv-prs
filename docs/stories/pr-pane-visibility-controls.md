---
# yaml-language-server: $schema=../../.lore/schemas/arc.schema.json
type: Arc
title: pr-pane visibility controls
tags:
  - pr-pane
summary: Toggle, fold and opt-in auto-open for the pr-pane pane (0.3.0 and 0.3.1).
tasks:
  - prs-1
  - prs-2
  - prs-3
generated:
  by: lore/0.13.0
  at: 2026-10-19T17:50:47.166Z
lore_task_status: in-progress
---

# pr-pane visibility controls

## Goal

Let people control when the pull-requests pane takes up screen space. Before 0.3.0 the pane opened
at every session start and could only be closed with its close mark, then reopened with `/prs`. A
colleague asked for a way to toggle its visibility or expand and collapse it.

## Acceptance criteria

- `/prs` toggles the pane. `/prs show` and `/prs hide` are the explicit forms. (0.3.0)
- `z` folds the pane to one summary line and back, keeps the selected PR, and remembers the fold
  across sessions. The poll and toasts keep running. (0.3.0)
- Auto-open at session start is a `userConfig` option, `autoOpen`. It is off by default from 0.3.1,
  and `/prs autoOpen enable|disable` sets the same `/config` row. (0.3.0, 0.3.1)

## Tasks

<!-- lore:tasks:begin -->
| Task | Title | Status |
|---|---|---|
| [PRS-1](../../.quest/completed/PRS-1.json) | pr-pane 0.3.0: /prs toggle, z collapse, autoOpen option | Done |
| [PRS-2](../../.quest/completed/PRS-2.json) | pr-pane 0.3.1: autoOpen off by default, /prs autoOpen enable\|disable | Done |
| [PRS-3](../../.quest/tasks/PRS-3.json) | pr-pane 0.3.2: /prs autoOpen survives a missing /config row | In Progress |
<!-- lore:tasks:end -->

## Notes

- `/prs` closes the pane only when `$.ui.panes()` reports it placed and in front. A pane waiting
  for width, or one behind another tab, is opened instead.
- `/prs autoOpen` writes the plugin's own row (`pr-pane.autoOpen`) with `$.config.set`, not a
  `$.store` override. The command and `/config` cannot disagree, so there is no precedence rule.
  `ConfigRow` does not say whether a value is the default, so the status line says "off by default"
  rather than naming the source.
- Released as `v0.3.0` (#2) and `v0.3.1` (#3). evolv-marketplace installs the plugin from those tags.
