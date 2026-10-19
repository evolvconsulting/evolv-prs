---
# yaml-language-server: $schema=../../.lore/schemas/reference.schema.json
type: Reference
title: pr-pane releases
status: stable
tags:
  - pr-pane
  - releases
summary: "Every pr-pane release: tag, merge commit, PR, tracker tasks, and where it shipped in the evolv catalog."
generated:
  by: lore/0.13.0
  at: 2026-10-19T23:23:57.700Z
---

# pr-pane releases

The release ledger for pr-pane, the Claude Code mod in `plugin/`. Each tag is on the squash-merge commit of its PR
into `dev`. The evolv marketplace (`evolvconsulting/evolv-marketplace`) installs the plugin from a tag, and its catalog
CI (evolv-marketplace#28) refuses a pin to a missing tag or a mismatched version. Checked against GitHub on
2026-10-20.

## Releases

| Version | Commit | evolv-prs PR | Tasks | What changed | Catalog |
|---|---|---|---|---|---|
| 0.2.1 | `1bb5507` | #1 | — | Moved here from evolv-marketplace | #20 (`baed887`) |
| 0.3.0 | `c8c9bf6` | #2 | PRS-1 | `/prs` toggle, `z` collapse, `autoOpen` option | #21 (`754a103`) |
| 0.3.1 | `76f77ea` | #3 | PRS-2 | `autoOpen` off by default, `/prs autoOpen enable\|disable` | skipped: #22 closed (headless bug) |
| 0.3.2 | `05e0cdc` | #5 | PRS-3 | `/prs autoOpen` survives a missing `/config` row | #23 (`aa8a813`) |
| 0.3.3 | `acd9023` | #6 | PRS-4 | Headless hint names a configure command that works | #24 (`a6feaa3`) |
| 0.3.4 | `400adaf` | #7 | PRS-5 | Headless hint pastes into a shell as printed | #25 (`2b7ec1f`) |
| 0.4.0 | `169730e` | #8 | PRS-6 | Base-branch rules; approve and merge guardrails from them | #26 (`b26a0a8`) |
| 0.5.0 | `442e1bd` | #9 | PRS-7 | Merge gates, branch line, `/prs diagram` | #27 (`24211ac`) |
| 0.6.0 | `4ba91d1` | #10 | PRS-8 | `/prs layout` and tips for the docked pane | skipped: went to 0.6.1 |
| 0.6.1 | `b9add9a` | #11 | PRS-9, PRS-10 | Behind-but-not-required gate; unknown `/prs` arguments | #29 (`a77023d`) |

PR #4 (`fcf5c44`) recorded PRS-1 to PRS-3 in the tracker and has no tag.

## The release path

1. Build on a branch off `dev`. Bump `version` in `plugin/.claude-plugin/plugin.json`.
2. Gates: `claude plugin validate plugin --strict`, `claude plugin test plugin` and `tsc`. CI runs the first two,
   not `tsc`.
3. Open a PR to `dev`. Jeremy confirms in this session. Squash-merge with `--match-head-commit`.
4. Tag `vX.Y.Z` on the merge commit, push the tag, and publish a GitHub release.
5. Send evolv-marketplace the tag. It tests the install from the tag, then bumps the catalog entry's `ref` and
   `version` and republishes the org library once Jeremy confirms in its own session.

## Open gaps

- No repo either session can reach has a ruleset. So the rules-present path of 0.4.0 is covered by tests only
  ([branch rules](../stories/pr-pane-branch-rules.md)).
- Nothing has been posted with `/prs diagram --post`, so GitHub's rendering of the comment is unverified
  ([diagrams](../stories/pr-pane-diagrams.md)).
- The pane hasn't been seen on a Windows terminal
  ([visibility controls](../stories/pr-pane-visibility-controls.md)).
