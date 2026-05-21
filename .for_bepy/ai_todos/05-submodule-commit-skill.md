# Create submodule-commit skill

## Goal

Add a `/submodule-commit` skill (or extend `/commit`) to handle the 4-step submodule commit pattern without manual repetition.

## Context

Every change to `vendor/tauri_kit` requires four sequential steps:
1. Stage changed files inside the submodule: `git -C vendor/tauri_kit add <files>`
2. Commit inside the submodule: `git -C vendor/tauri_kit commit -m "..."`
3. Stage the updated submodule pointer in the parent: `git add vendor/tauri_kit`
4. Commit the pointer in the parent: `git commit -m "..."`

This was done 4 times in the 2026-05-21 session (settings header work). Each time it was done manually with 4 separate tool calls. If you forget step 3-4, the parent repo still points to the old submodule commit.

## Approach

Option A: Add a subcommand to the existing `/commit` skill: `/commit sub vendor/tauri_kit` - stages + commits inside the submodule with a prompted message, then auto-stages + commits the parent pointer with a generated "update tauri_kit submodule" message.

Option B: New standalone `/submodule-commit <path>` skill that does the same.

Option A is preferred - keeps the commit surface in one place.

## Acceptance

- Running `/commit sub vendor/tauri_kit` when there are staged submodule changes: commits submodule + parent in one invocation.
- Running it when there are no submodule changes: reports "nothing to commit in submodule".
- Works with the existing commit-style.md prefix conventions.
