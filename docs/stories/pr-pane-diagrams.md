---
# yaml-language-server: $schema=../../.lore/schemas/arc.schema.json
type: Arc
title: pr-pane diagrams
tags:
  - pr-pane
summary: Merge-readiness gates, the branch's ahead/behind, and a Mermaid export (0.5.0).
tasks:
  - prs-7
generated:
  by: lore/0.13.0
  at: 2026-10-19T21:22:42.903Z
lore_task_status: in-progress
---

# pr-pane diagrams

## Goal

Show at a glance what stands between a PR and a merge, and where its branch sits against its base. Make the same
picture shareable on the PR itself.

## Acceptance criteria

- The detail view draws the merge gates as a chain: approvals, CODEOWNERS when it's required, checks, up to date
  and mergeable. Met gates are green, the first blocker is red, and later ones are dim. The chain becomes a
  vertical list when it doesn't fit the pane.
- The detail view shows how far the head branch is ahead of and behind its base.
- `/prs diagram <n>` prints both views as Mermaid and copies them. Only `--post` writes them to the PR, as a
  comment, and that is logged.

## Tasks

<!-- lore:tasks:begin -->
| Task | Title | Status |
|---|---|---|
| [PRS-7](../../.quest/tasks/PRS-7.json) | pr-pane 0.5.0: merge-readiness gates, branch view and /prs diagram | In Progress |
<!-- lore:tasks:end -->

## Notes

- **Native drawing:** the views use box-drawing text (`─▶`, `└▶`, `◀──`), not rendered images. The terminal has no
  Svg element, Image only works in kitty and Ghostty, and the plugin ships no mmdc or Chromium.
- **Gate data:**
  - Gates come from the 0.4.0 rules ([branch rules](pr-pane-branch-rules.md)) when they were read, otherwise from GitHub's
    `reviewDecision`, then from checks, `mergeStateStatus` (BEHIND) and conflicts or draft.
  - GitHub folds a code owner's approval into `reviewDecision`, so the CODEOWNERS gate is met once that decision is
    APPROVED.
- **Branch data:** `gh api repos/{o}/{r}/compare/{base}...{head sha}` gives `ahead_by` and `behind_by`.
  - The result is cached per base and head commit, as requested. It also expires after 10 minutes (RULES_TTL_MS),
    because the base can move under a fixed head.
  - Comparing against the head SHA rather than the branch name also works for PRs from forks.
- **`/prs diagram` without the list:** the command reads the PR with `gh pr view` when the list hasn't loaded yet
  (a headless run) or doesn't include it (LIST_LIMIT).
- **Posting:** the comment is two fenced Mermaid flowcharts, which GitHub renders. Posting is an outward write,
  so it happens only with an explicit `--post`, and it lands in the action log with the head commit.
- **Not verified:** no renderer has validated the Mermaid syntax. The plugin ships none, and nothing was posted
  to a real PR during development.
