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
  - prs-8
generated:
  by: lore/0.13.0
  at: 2026-10-19T17:50:47.166Z
lore_task_status: done
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
| [PRS-5](../../.quest/completed/PRS-5.json) | pr-pane 0.3.4: make the /prs autoOpen shell hint pasteable | Done |
| [PRS-8](../../.quest/completed/PRS-8.json) | pr-pane 0.6.0: tell people how to get the docked pane | Done |
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
- The headless hint prints commands you can paste as they are, such as
  `echo '{"autoOpen":"true"}' | claude plugin configure pr-pane@evolv-marketplace --values-stdin`. The bare form prints an
  on line and an off line. A plugin cannot read its own install id, so the commands name the evolv install, and a
  sentence points other installs at `claude plugin list`.
  - In 0.3.3 the commands used a `<marketplace>` placeholder, which a shell reads as a redirect (PRS-4, PRS-5).
  - A test rejects shell metacharacters and leading spaces in every hint line.
- **Placement:** Claude Code places the pane, not pr-pane and not the OS.
  - In the fullscreen layout (`/tui fullscreen`, the `tui` setting) the pane docks beside the conversation from
    110 columns. Otherwise it sits inline, above the prompt.
  - pr-pane reads the real layout from `command.run`'s `presentation`, and the pane's `placement`. From 0.6.0 it
    explains how to get the docked pane, through `/prs layout` and one-time tips (PRS-8). It never changes the
    setting itself.
  - The plugin types say tmux defaults to the default layout, but the user docs say fullscreen works in tmux. So
    pr-pane trusts the live `isFullscreen` value and guesses nothing from the environment.
- Released as `v0.3.0` (#2), `v0.3.1` (#3), `v0.3.2` (#5), `v0.3.3` (#6) and `v0.3.4` (#7). The evolv marketplace skipped 0.3.1 because of the
  headless bug and moves from `v0.3.0` to `v0.3.2`.
