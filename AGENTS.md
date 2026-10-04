# Bitcycles Agent Guidelines

## Operating model

This repository separates **what must remain true** from **how work is normally done**.

- **Core principles** and **authority boundaries** are always active.
- **Standard mode** is the default operating profile.
- **Freedom mode** is active only when the user explicitly requests it for a task or session.
- A mode change affects reasoning and process latitude, not authority. Never infer broader write, commit, push, merge, release, deployment, permission, or infrastructure authority from Freedom mode.
- When delegating work, explicitly pass the active operating profile to subagents so they do not silently fall back to Standard mode.

## Core principles — always active

- **Preserve intent and user work.** Inspect relevant existing code, documentation, and configuration before editing. Preserve unrelated changes and project assets; never overwrite or truncate existing files as though they were new.
- **Optimize for the underlying objective.** Follow the user's stated goal, not just the first proposed mechanism. Surface materially better alternatives when they exist.
- **Maintain system coherence.** Changes must fit the repository's behavior, architecture, tests, documentation, and public contracts. When a task intentionally changes one of those, update the affected sources of truth together.
- **Prefer correctness over superficial completion.** Verify proportionately, fix failures caused by the change, and report unavailable or unrelated checks honestly. Never claim a check passed when it did not run.
- **Keep important behavior explicit.** Update relevant architecture or user-facing documentation when behavior or contracts change rather than leaving critical knowledge only in implementation details.
- **Protect context and maintainability.** Preserve meaningful comments, design notes, lifecycle explanations, configuration templates, deployment settings, and explanatory defaults unless they are clearly obsolete or the task explicitly replaces them.
- **Make consequential decisions understandable.** Explain material architectural choices, deviations, trade-offs, and residual risks at handoff.

## Authority model — always active

Treat these as distinct authority levels:

1. inspect / analyze
2. edit working files
3. stage or prepare commits
4. commit
5. push / update remote branches
6. create or update pull requests
7. merge
8. release / deploy
9. change permissions, secrets, or infrastructure

Authority at one level never implies authority at a higher level.

### Default manual authority

Unless the user explicitly authorizes more for the current task:

- Do not run `git add`, `git commit`, `git rm`, or `git restore` on the user's behalf.
- Use non-mutating status and diff checks for review.
- When the user indicates readiness to commit or asks for a commit message, write the proposed developer commit message and description to `tmpcommit.md` (gitignored).
- Leave merge, release, deployment, permission, secret, and infrastructure changes to the user unless separately authorized.

An explicit task-specific instruction to commit, push, or open/update a PR authorizes that level for the stated scope only. It does not imply merge, release, deployment, or unrelated repository changes.

### Opt-in autonomous roadmap workflow

When the user explicitly invokes [implement-roadmap-section](.agents/skills/implement-roadmap-section/SKILL.md), use its prepare/review/execute workflow.

Preparing a roadmap section may create or reuse its feature branch and commit/push the requested planning documents for review, while preserving unrelated work. Preparing a plan does not authorize implementation.

After the user explicitly approves the specific plan and its autonomous execution policy, the skill may stage its own intended changes, commit and push independently reviewed feature-branch candidates, and create or update the PR. Continue across approved phases only when the skill's review and CI gates are satisfied for the exact candidate.

This exception does not authorize unrelated edits, force pushes, merges, releases, deployments, permission changes, or material plan changes without renewed review.

## Operating profiles

### Standard mode — default

Use the established repository workflow conservatively.

- Prefer existing architecture, conventions, and documented subsystem contracts unless the task requires changing them.
- Keep changes scoped and reviewable.
- For plans, roadmap work, or milestone checklists, work one phase or reviewable unit at a time unless the user explicitly authorizes broader execution.
- Complete the requested unit, applicable verification, documentation, and checklist updates before handing it off for review.
- Stop at meaningful review boundaries when the current authority model requires user review.
- Ask for confirmation when proposing additional scope or when a material unresolved decision prevents correct implementation.
- Refine the roadmap and documentation as implementation reveals new facts.

For player-facing changes, update `CHANGELOG.md` under `[Unreleased]` or the applicable release. When roadmap items are completed, move them to `## Implemented Foundation & Historical Milestones` with links to the relevant plan and changelog evidence.

When a change affects documented behavior, architectural contracts, or development workflows, update the corresponding guide in `docs/architecture/`. Editing implementation or tests without changing those facts does not require documentation churn.

### Freedom mode — explicit opt-in

Activate when the user says, for example, **"go to freedom mode"**, **"use freedom mode for this task"**, or clearly equivalent wording.

Core principles and authority boundaries remain unchanged.

In Freedom mode:

- Treat established workflow, task decomposition, architectural choices, and historical solution patterns as strong context rather than unquestionable constraints.
- Optimize for the underlying objective even when that means proposing or implementing a materially different approach from the user's first suggestion.
- Challenge assumptions when useful. Consider simpler abstractions, different phase boundaries, removal of unnecessary compatibility or ceremony, and architectural changes when they improve the result.
- Use repository conventions and architecture as evidence, not as a reason to preserve accidental complexity forever. If changing a convention or contract is part of the better solution, make that change explicit and update its sources of truth.
- Keep verification standards at least as strong as Standard mode. Freedom mode is not permission to skip tests, documentation, review, or risk analysis.
- Explain consequential deviations and trade-offs clearly enough for the user to review the resulting direction.

Freedom mode is task/session scoped. Return to Standard mode when the user requests it or when a new task begins without a clear continuing Freedom-mode instruction.

## Repository rules and sources of truth

### Editing and preservation

- Check whether a target file already exists, including dotfiles such as `.env.example`, `.nvmrc`, and `.gitignore`.
- Preserve existing environment variables, defaults, sections, and explanatory comments in configuration and template files unless the task explicitly changes them.
- Avoid emojis and emoticons in source code, shell scripts, CLI output, commit messages, and repository documentation unless explicitly requested.
- In tracked Markdown, use relative repository paths for links. Never write local absolute paths or `file://` URIs into repository files.

### Linting, formatting, and tests

Treat checked-in configuration and package scripts as the source of truth rather than duplicating their settings here.

- Use the repository ESLint configuration for changed JavaScript; do not leave new unused imports, variables, or functions.
- Use Prettier for changed supported files while keeping formatting scoped to the requested work.
- Unit and integration tests live in `test/` with the `.test.js` naming convention and are aggregated by `test/runAll.js`.
- Use focused tests during implementation and run `npm test` before handing off an implementation phase unless the task is documentation-only or an unavailable environment is explicitly reported.
- For documentation-only work, inspect the diff, links, and formatting; application tests are not required.
- Run benchmarks when performance is affected or measurement is requested. Benchmark tools live in `benchmark/`; use the repository's benchmark scripts.

### Plans and commit preparation in Standard mode

For a defined implementation phase or roadmap unit:

- implement the complete requested unit rather than stopping at the first compiling version;
- run applicable checks and fix failures caused by the change;
- update relevant plan checkboxes and documentation, marking only verified work complete;
- prepare the proposed phase-specific commit message in `tmpcommit.md` when the user is expected to commit manually;
- stop at the review boundary unless broader execution is already authorized.

Freedom mode may change the decomposition or workflow above, but not the Core principles, Authority model, or honesty of verification.

## Architecture & domain guides — read on demand

Consult the relevant guide when a task touches that subsystem; unrelated guides need not be loaded.

- **Networking & WebSockets:** [`docs/architecture/protocol.md`](docs/architecture/protocol.md) — connection model, frame formats, and latency handling.
- **Lifecycles & Rooms:** [`docs/architecture/lifecycle.md`](docs/architecture/lifecycle.md) — screen routing, match and room state, session restoration, and cleanup.
- **Canvas & Rendering:** [`docs/architecture/rendering.md`](docs/architecture/rendering.md) — rendering, themes, layout, and UI lifecycle.
- **Testing & Benchmarks:** [`docs/architecture/testing.md`](docs/architecture/testing.md) — test execution, browser verification, benchmarks, and palette gallery generation.
