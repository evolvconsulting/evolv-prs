# pr-pane

A Claude Code mod that shows the current repo's open pull requests in a pane, using the `gh` CLI.

- **List:** each PR's author, created date, approval state, merge state and latest reviewers. PRs that look agent-authored or are large get a badge.
- **Toasts:** a toast for each new PR. The list refreshes every 60 s.
- **Detail view:** select a PR to see its branches, size, checks, sensitive paths, full review history and description.
- **Branch rules:** the detail view shows the base branch's rules and how the PR stands against them, for example `rules on dev: needs 2 approvals (has 1) · CODEOWNERS review required · the last pusher can't approve · required: ci, lint (lint failing) [rulesets]`.
  - The rules come from the branch's rulesets. Classic branch protection is added when it can be read, which needs admin access. They're cached for 10 minutes per branch.
  - A private repo on GitHub's free plan reads `not readable here`, because GitHub enforces no rules there.
- **Merge gates and branch:** under the rules, the detail view draws the steps to merge as a chain, `approvals 1/2 ─▶ CODEOWNERS ─▶ checks 4/5 ─▶ up to date ─▶ mergeable`.
  - Met steps are green, the first blocker is red, and later ones are dim. In a narrow pane the chain turns into one step per line.
  - A branch behind its base shows as `6 behind (not required)` in amber when GitHub doesn't require an up-to-date branch, and as a blocker (`6 behind base`) when it does.
  - Below it, a line shows how far the branch has moved from its base, for example `dev ◀── 3 behind · 5 ahead ── feat/x`.
- **Mermaid:** `/prs diagram <n>` prints both views as Mermaid and copies them. `/prs diagram <n> --post` posts them as a PR comment, where GitHub draws them. Posting is logged.
- **Actions:** code review, approve, comment, request changes, merge, update branch, re-run failed checks, open and close.
- **Guardrails:**
  - Merge and close need a confirming press. Merge lists the base branch's unmet rules (approvals, code owner review, required checks), or `No approving review` when there are no rules to read. It is pinned to the commit you confirmed.
  - Approve and merge reload the PR first and stop if new commits landed since you looked.
  - Approve pauses on agent-authored PRs whose diff you haven't opened, on workflow, CODEOWNERS or auth paths, on PRs over 400 lines, and on failing checks.
  - Approve also pauses when the branch requires a code owner's review and you own none of the changed paths. Teams count, if your token can list them.
  - Approve refuses when the branch requires approval from someone other than the last pusher and you authored or committed the head commit. GitHub doesn't expose who pushed, so the head commit stands in for the pusher.
  - Re-run warns after a run has been re-run twice.
  - Feedback uses Conventional Comments labels.
  - Every action is logged with actor, commit and time.

## Install

```
/plugin marketplace add evolvconsulting/evolv-marketplace
/plugin install pr-pane@evolv-marketplace
```

To work on it, see `CLAUDE.md`. The plugin itself lives in `plugin/`.

## Where the pane shows

Claude Code decides where the pane goes, based on its layout and the terminal's width, not the operating system:

- **Docked beside the conversation:** in the fullscreen layout, when the terminal is at least 110 columns wide.
- **Below the conversation, above the prompt:** in the default layout, or in a narrower terminal.

For the docked pane, run `/tui fullscreen`. It saves `"tui": "fullscreen"` in your settings and relaunches,
keeping the conversation. `/tui default` switches back. `/prs layout` reports your current layout and width, with
the same advice. Until you run `/prs layout`, pr-pane shows this as a tip when it opens and while the pane sits
below. In tmux, fullscreen works, and mouse scrolling needs `set -g mouse on`. pr-pane never changes the layout
itself.

## Requirements

- `gh` installed and authenticated (`gh auth login`), run from inside a GitHub repo.
- The `code-review` command, for the code review action.

## Commands

| Command | What it does |
|---|---|
| `/prs` | Open the pane, or close it if it is showing |
| `/prs show` | Open the pane and refresh |
| `/prs hide` | Close the pane |
| `/prs autoOpen` | Say whether the pane opens at session start |
| `/prs autoOpen enable` | Open the pane at every session start |
| `/prs autoOpen disable` | Open the pane only on `/prs` (the default) |
| `/prs layout` | Say whether the pane can dock beside the conversation, and how |
| `/prs diagram <n>` | Print PR n's merge gates and branch as Mermaid, and copy it |
| `/prs diagram <n> --post` | Post that Mermaid as a comment on PR n; logged |
| `/prs help` | Print every command and hotkey |
| `/prs log` | Print the last 20 logged actions |
| `/prs refresh` | Refresh now |

## Hotkeys

Press ctrl+x tab to give the pane focus. Esc hands the keyboard back to the prompt and closes help or the log.

| Where | Keys |
|---|---|
| List | `1`–`9` or Enter open a PR · `r` refresh · `l` log · `h` help · `z` collapse or expand |
| Review | `c` code review · `d` diff · `a` approve · `f` comment · `q` request changes |
| Ship | `m` merge · `u` update branch · `t` re-run failed · `o` open · `x` close PR · `b` back |

Merge, update branch and re-run appear only when they apply.

`z` folds the pane to one line, such as `5 open · 2 approved · 1 checks failing · 1 conflicts`, and `z` or the expand button opens it again on the same PR. The pane stays folded across sessions. The 60 s refresh and the new-PR toasts keep running while it is folded.

## Settings

| Option | Default | What it does |
|---|---|---|
| `autoOpen` | `false` | Open the pane when a session starts. While it's off, run `/prs` to open the pane. The refresh and toasts run either way. |

Change it with `/prs autoOpen enable` or `disable`, or in `/config`, where it's a row under pr-pane. Both write the same setting, so they always agree. If you set it before 0.3.1, your value stays. A headless (`claude -p`) session has no `/config` row, so there `/prs autoOpen` reports the plugin's options and leaves them unchanged. Set it from a shell instead, with the plugin's full id: `echo '{"autoOpen":"true"}' | claude plugin configure pr-pane@evolv-marketplace --values-stdin` (`"false"` turns it off). If you installed pr-pane from somewhere else, use the id that `claude plugin list` shows.
