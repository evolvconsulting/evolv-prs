# pr-pane

A Claude Code mod that shows the current repo's open pull requests in a pane, using the `gh` CLI.

- **List:** each PR's author, created date, approval state, merge state and latest reviewers. PRs that look agent-authored or are large get a badge.
- **Toasts:** a toast for each new PR. The list refreshes every 60 s.
- **Detail view:** select a PR to see its branches, size, checks, sensitive paths, full review history and description.
- **Actions:** code review, approve, comment, request changes, merge, update branch, re-run failed checks, open and close.
- **Guardrails:**
  - Merge and close need a confirming press. Merge lists what's missing (approval, passing checks) and is pinned to the commit you confirmed.
  - Approve and merge reload the PR first and stop if new commits landed since you looked.
  - Approve pauses on agent-authored PRs whose diff you haven't opened, on workflow, CODEOWNERS or auth paths, on PRs over 400 lines, and on failing checks.
  - Re-run warns after a run has been re-run twice.
  - Feedback uses Conventional Comments labels.
  - Every action is logged with actor, commit and time.

## Install

```
/plugin marketplace add evolvconsulting/evolv-marketplace
/plugin install pr-pane@evolv-marketplace
```

To work on it, see `CLAUDE.md`. The plugin itself lives in `plugin/`.

## Requirements

- `gh` installed and authenticated (`gh auth login`), run from inside a GitHub repo.
- The `code-review` command, for the code review action.

## Commands

| Command | What it does |
|---|---|
| `/prs` | Open the pane and refresh |
| `/prs help` | Print every command and hotkey |
| `/prs log` | Print the last 20 logged actions |
| `/prs refresh` | Refresh now |

## Hotkeys

Press ctrl+x tab to give the pane focus. Esc hands the keyboard back to the prompt and closes help or the log.

| Where | Keys |
|---|---|
| List | `1`–`9` or Enter open a PR · `r` refresh · `l` log · `h` help |
| Review | `c` code review · `d` diff · `a` approve · `f` comment · `q` request changes |
| Ship | `m` merge · `u` update branch · `t` re-run failed · `o` open · `x` close PR · `b` back |

Merge, update branch and re-run appear only when they apply.
