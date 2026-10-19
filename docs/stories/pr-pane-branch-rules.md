---
# yaml-language-server: $schema=../../.lore/schemas/arc.schema.json
type: Arc
title: pr-pane branch rules
tags:
  - pr-pane
summary: Read the base branch's rulesets and protection; explain why a PR is blocked and who can approve it (0.4.0).
tasks:
  - prs-6
generated:
  by: lore/0.13.0
  at: 2026-10-19T21:08:42.735Z
lore_task_status: done
---

# pr-pane branch rules

## Goal

Say why a PR is blocked and who can approve it. Before 0.4.0 the pane showed GitHub's verdict
("needs review", "blocked") but not the rule behind it. Its only rule was the hardcoded author
self-approval block.

## Acceptance criteria

- The detail view shows the base branch's rules: approvals needed and given, CODEOWNERS review,
  last-push approval and required checks, with failing ones named. It says which source answered.
- Approve refuses the last pusher where the rules require it, and warns a viewer who owns none of
  the changed paths when a code owner's review is required.
- The merge confirm lists unmet rules.
- A private repo on the free plan, a branch without rules and an API error each read differently.

## Tasks

<!-- lore:tasks:begin -->
| Task | Title | Status |
|---|---|---|
| [PRS-6](../../.quest/completed/PRS-6.json) | pr-pane 0.4.0: read base-branch rules; say why a PR is blocked and who can approve | Done |
<!-- lore:tasks:end -->

## Notes

- **Sources:**
  - `GET repos/{o}/{r}/rules/branches/{base}` needs only read access, so it stands for the branch's rules.
  - `GET .../branches/{base}/protection` needs admin. Its 403 or 404 says nothing on its own, so it only adds to
    what rulesets say. The line names whichever source answered.
- **Free plan:** evolvconsulting is a free org, so its private repos return 403 "Upgrade to GitHub Pro" from both
  endpoints, and GitHub enforces no rules there. Public repos there, and every repo in the paid
  evolvconsulting-prod org, return rules. As measured on 2026-10-20, evolv-prs `dev` returns `[]` from rulesets
  and 404 from protection.
- **Combining rules:** several `pull_request` rules can apply to one branch (repository plus organization
  rulesets, as on microsoft/vscode). The highest approval count and any set flag win.
- **Counting approvals:** each reviewer's latest deciding review counts, and comments are ignored. With
  `dismiss_stale_reviews_on_push`, only approvals on the head commit count.
- **Last pusher:** GitHub doesn't expose who pushed, so the head commit's author and committer stand in for them.
  This is a heuristic.
- **Code owners:** owners come from the default branch's CODEOWNERS, where the last matching line wins. The
  viewer's teams come from `user/teams`, which needs `read:org`. Without that scope, only direct ownership counts.
- **Cache:** rules are cached per `<repo>#<base>` in `$.state` for 10 minutes. The 60 s poll reuses them.
- **Released:** `v0.4.0` (#8). The 403 and none paths were verified live. The rules-present path is covered by tests
  only: no reachable repo has a ruleset, and Jeremy chose not to add one to evolv-prs.
