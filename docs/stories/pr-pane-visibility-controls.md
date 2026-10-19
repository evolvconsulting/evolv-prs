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
  - prs-4
  - prs-5
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
| [PRS-3](../../.quest/completed/PRS-3.json) | pr-pane 0.3.2: /prs autoOpen survives a missing /config row | Done |
| [PRS-4](../../.quest/completed/PRS-4.json) | pr-pane 0.3.3: name a configure command that works | Done |
| [PRS-5](../../.quest/tasks/PRS-5.json) | pr-pane 0.3.4: make the /prs autoOpen shell hint pasteable | In Progress |
<!-- lore:tasks:end -->

## Notes

- `/prs` closes the pane only when `$.ui.panes()` reports it placed and in front. A pane waiting
  for width, or one behind another tab, is opened instead.
- `/prs autoOpen` writes the plugin's own row (`pr-pane.autoOpen`) with `$.config.set`, not a
  `$.store` override. The command and `/config` cannot disagree, so there is no precedence rule.
  `ConfigRow` does not say whether a value is the default, so the status line says "off by default"
  rather than naming the source.
- A headless (`claude -p`) session has no `/config` row, and `$.config.set` rejects the key. From 0.3.2, `/prs autoOpen`
  reports `options.autoOpen` there and points to `claude plugin configure pr-pane` (PRS-3).
- The headless hint names `claude plugin configure pr-pane@<marketplace> --values-stdin`. The bare id fails, and a
  plugin cannot read its own install id (PRS-4, 0.3.3).
- Released as `v0.3.0` (#2), `v0.3.1` (#3), `v0.3.2` (#5) and `v0.3.3` (#6). The evolv marketplace skipped 0.3.1 because of the
  headless bug and moves from `v0.3.0` to `v0.3.2`.
