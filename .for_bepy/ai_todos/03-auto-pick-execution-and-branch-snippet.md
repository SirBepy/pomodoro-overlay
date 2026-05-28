# Define a snippet that auto-picks execution mode + branch (like auto-commit.md)

## Goal

Create a reusable global snippet (modeled on `~/.claude/snippets/auto-commit.md`) that a project can `@import` in its CLAUDE.md to opt into auto-deciding two recurring workflow questions, so Claude stops asking them every time:

1. **Subagent-driven vs inline execution** - automatically pick whatever Claude's own recommendation is (per the existing judgment rule in global CLAUDE.md "Subagent-Driven vs Inline Execution"), no question asked.
2. **Branch for implementation** - automatically work **directly on main** (matching the auto-commit-on-main norm), no question asked.

## Context

- Trigger: while setting up subagent-driven execution of the meeting-detection plan (`docs/superpowers/plans/2026-05-28-meeting-detection.md`), the `superpowers:subagent-driven-development` skill forced an explicit-consent question for both "which execution mode" and "which branch" (it mandates consent before implementing on main). Joe found this redundant for personal projects that already auto-commit to main.
- Pattern to mirror: `~/.claude/snippets/auto-commit.md` - a global snippet `@import`ed by personal-project CLAUDE.md files to opt into a behavior. This project's `CLAUDE.md` already does `@~/.claude/snippets/auto-commit.md`.
- Relevant global rules this must cooperate with:
  - global `CLAUDE.md` -> "Subagent-Driven vs Inline Execution" (the judgment rule whose output we auto-accept).
  - global `CLAUDE.md` -> "Git Commits" (subagents never commit; main agent runs `/commit`). The snippet must NOT weaken this.
  - The superpowers skills (`subagent-driven-development`, `using-git-worktrees`, `finishing-a-development-branch`) explicitly ask for branch/worktree consent - the snippet's job is to pre-answer that consent for opted-in projects.

## Approach

- Create `~/.claude/snippets/auto-execution.md` (name TBD - could also be `auto-workflow.md`; pick one and be consistent).
- Content should state, in the same voice as `auto-commit.md`:
  - Projects that `@import` this opt into auto-deciding execution-mode and branch.
  - **Execution mode:** do not ask subagent-vs-inline; apply the global "Subagent-Driven vs Inline Execution" judgment rule and proceed with its result silently.
  - **Branch:** do not ask which branch / worktree; implement directly on `main`. This pre-satisfies the superpowers consent gates ("never start implementation on main without explicit user consent" -> the import IS the standing consent).
  - **Guardrails that still hold:** subagents still never commit (stage-only; main agent runs `/commit`); submodule pushes still precede parent pointer bumps; destructive/irreversible actions still need confirmation.
- Then add `@~/.claude/snippets/auto-execution.md` to this project's `CLAUDE.md` (right after the existing auto-commit import).
- Rejected alternative: encoding this as a memory/preference - rejected because these are standing behavioral rules that should be version-controlled per-project via the same import mechanism as auto-commit, not session memory.

## Acceptance

- New snippet file exists under `~/.claude/snippets/` with the two behaviors clearly specified and the guardrails preserved.
- `pomodoro-overlay/CLAUDE.md` imports it.
- A future session that reaches an execution-mode or branch decision in an opted-in project proceeds without asking, picking Claude's recommended execution mode and `main`.
- Must NOT regress: subagents still never commit; the `/commit` skill is still the only commit path; submodule-before-parent push order is preserved.
