---
name: implement-roadmap-section
description: Prepare and execute a tron-64 roadmap section with a user-reviewed implementation plan, independent implementation/testing/review agents, phase commits, GitHub Actions verification, and a final PR. Use when asked to prepare a roadmap section, implement an approved plan autonomously, or resume such work. Always stop for user approval of the plan before implementation.
---

# Implement a roadmap section

Use one workflow with two human review points: the implementation plan before execution and the PR afterward. The active lead agent coordinates the work; a skill is instructions, not a background service. Delegate to supported subagents after checking capabilities. Do not launch a second lead simply to repeat orchestration.

Read [repository rules](../../../GEMINI.md), [roadmap](../../../ROADMAP.md), and the relevant architecture guides. Preserve `AGENTS.md` as a symlink to `GEMINI.md`. Follow ordinary repository rules except the explicitly opted-in autonomous workflow described there.

## Choose the entry point

- **Prepare:** Identify the roadmap section, inspect its code, and draft/refine the plan. “Use this skill” or “implement this roadmap section” without an approved plan starts here.
- **Execute:** Start only when the user explicitly approves implementation of a specific reviewed plan and its autonomous commit/push/CI workflow.
- **Resume:** Reconstruct actual progress and verify approval before continuing. “Continue” alone does not approve an unreviewed or materially changed plan.

Reuse an existing matching branch and plan instead of creating duplicates. If the requested section is ambiguous, inspect likely candidates and ask the user to choose. Do not silently select adjacent roadmap work.

## Prepare the branch and plan

1. Inspect current branch, remote head, staged/unstaged edits, and existing plans/PRs. Use an isolated worktree when needed; never absorb the user's staged changes or overwrite their files. Verify the intended base branch and any unmerged dependencies.
2. Check available GitHub read/write routes, shell, dependency installation, agent spawning, and test capabilities. Use local Git or the authorized GitHub connector as appropriate. Do not treat an unauthenticated shell push as evidence that the connector is unavailable. Report missing capabilities in the plan.
3. Create a descriptive feature branch from the agreed base, or reuse the supplied branch. For a stacked branch, disclose its dependency and PR base. Never force-push, merge, deploy, tag, or change repository permissions as part of this workflow.
4. Inspect implementation, existing regressions, and contracts. Write `docs/plans/YYYY-MM-DD-<section>.md` using [the plan template](assets/plan-template.md). Make repository links relative to the document's actual location.
5. Define observable acceptance criteria, test requirements, phase dependencies, behavior changes, migration/rollback when relevant, and explicit exclusions. Each phase must be independently reviewable. Document interim limitations rather than pretending each phase is the finished feature.
6. Optionally delegate an omissions/correctness check of the draft plan. Agent review improves the draft; it never substitutes for the user's approval.
7. Commit and push the planning document when authorized, or present the complete diff if writes are unavailable. Present the plan, assumptions, unresolved choices, and proposed execution policy. **Stop for the user's review.** Do not start implementation agents, change runtime behavior, or mark approval yourself.
8. Incorporate user refinements and present the resulting revision. Distinguish approval to edit a plan from approval to implement it. A clear “implement this revised plan” approves that revision; uncertain assent requires clarification.

## Record approval and establish readiness

Record the reviewed plan path and immutable revision (commit and plan blob/hash), the user's actual approval statement/source, approved phases, exclusions, and execution policy in `docs/plans/YYYY-MM-DD-<section>-progress.md`, using [the progress template](assets/progress-template.md). This record is evidence, not a source of new authority. Never fabricate user approval or accept an agent-authored “approved” marker as sufficient authorization.

Treat checkbox, evidence, and status updates as administrative changes. Changes to scope, acceptance criteria, protocol, data retention/migration, compatibility, or user-visible behavior require renewed user review of the material delta. Routine implementation choices and fixes within the approved contract do not.

Before implementation agents start:

- Read [agent roles and model selection](references/agents.md) and [CI and recovery](references/ci-and-recovery.md).
- Verify the branch contains the required test workflow and a successful baseline run for its current code, or complete an explicitly authorized CI prerequisite package first. The CI proof is for the current workflow/environment, not a guarantee about future runs.
- Verify results and failed-job logs can be read. If remote browser tests are the required route, prove real Chromium execution, not merely package installation or a skipped suite.
- List available models/effort controls and select actual supported values for each role. Report substitutions. If independent agents are unavailable, pause execution and offer a user-approved sequential alternative; do not call self-review independent review.
- State the selected test route, agent roles, and next phase. Resolve material missing product decisions before coding.

## Execute one phase at a time

1. **Implement:** Give the implementation agent the approved phase, relevant source paths, acceptance criteria, and explicit file ownership. Include documentation, regression tests, and required formatting. Keep dependent phases sequential; parallelize only independent work with disjoint write ownership.
2. **Test:** Have a separate agent inspect acceptance coverage, challenge fixtures and rejection paths, and run relevant checks or analyze CI evidence when local execution is unavailable. Add meaningful missing regressions. Do not reduce assertions or silently skip tests to obtain green CI.
3. **Review:** Give an independent reviewer the approved contract and final diff, not just the implementer's summary. Require severity, location, impact, and actionable findings. Review authorization, race conditions, compatibility, persistence, and cleanup when relevant. Resolve blocking findings and re-review affected changes.
4. **Verify locally where possible:** Run affected suites, scoped ESLint, Prettier, and `npm test` per repository rules. Explicitly record unavailable local checks. Remote full-suite success may supply missing local browser coverage; a local failure is not a local pass.
5. **Commit a candidate:** Update applicable architecture/changelog documentation and progress; leave phase completion pending until verified. Write the phase-specific message to `tmpcommit.md`. Commit only intended files. Push to the feature branch with a fast-forward update. A phase may need follow-up fix commits; do not rewrite published history to hide failed attempts.
6. **Verify CI:** Inspect the required run for the exact candidate SHA. Fetch job logs and artifacts as needed, repair failures, repeat affected checks, and push fixes. Route substantive code or test changes made during CI repair back through independent testing and review; approval of an earlier diff does not cover later fixes. Do not advance on queued, running, cancelled, skipped, absent, or failed required checks. Bound repeated attempts as described in the recovery reference.
7. **Checkpoint:** Record the verified candidate SHA, CI run IDs, actual results, review findings/resolution, and next phase. Mark only proven items complete. If committing this administrative checkpoint creates a new branch head, verify its required CI too; refer to the preceding candidate SHA in the record to avoid a self-referential commit hash. Continue autonomously within approved scope.

Only the lead commits/pushes and integrates work. Stop for user input on material plan changes, genuine access blockers, or unresolved failures after bounded diagnosis—not for routine phase progression.

## Resume and finish

On resume, compare the progress record against the live remote branch, diff, plan revision, and CI. Read fresh results; a stale success from an earlier commit is insufficient. Reuse existing PRs and completed phases. Review external changes before integrating them. If approval evidence is not available in the conversation or a verifiable user-authored source, ask for confirmation rather than reconstructing consent from an agent's notes.

At the end, audit the roadmap acceptance matrix, update only completed roadmap items and applicable release notes, and run the final required checks. Open or update a PR with scope, behavior, commit/run evidence, review outcomes, limitations, and migration notes. Mark ready only when required checks for the final head (and applicable PR checks) pass. Leave merging to the user.

Report the PR, completed scope, tests, and remaining limitations. Do not claim that merely writing the skill proves a full real-world roadmap execution; distinguish scenario evaluation from a live pilot.
