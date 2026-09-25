# Roadmap orchestration skill — Delivery and evaluation

Date: 2026-09-25.
Scope: a repository-local workflow skill and its integration with project rules.
Branch: `feat/roadmap-orchestration-skill`.
Dependency: CI prerequisite PR #1 is merged into `main`.
Status: implementation and scenario evaluation complete; live roadmap pilot pending.

## Agreed workflow

Prepare or reuse a roadmap section's branch and implementation plan. Stop for the user's review and refinements. Explicit approval of that plan and its autonomous execution policy enables sequential phases, each with independent implementation, testing, review, candidate commits, and exact-commit CI verification. Final PR review remains with the user.

The skill is stored in [.agents/skills/implement-roadmap-section](../../.agents/skills/implement-roadmap-section/SKILL.md). [GEMINI.md](../../GEMINI.md) defines a scoped opt-in exception to manual commits and per-phase human review. The existing `AGENTS.md` symlink remains intact.

## Delivery checks

- [x] Prove real browser CI, failure propagation, and access to logs/artifacts (PR #1; push run `36123206998`, PR run `36123209652`; 12 suites passed).
- [x] Define preparation, human approval, autonomous execution, and resume behavior.
- [x] Add plan/progress templates, agent role/model guidance, and CI recovery instructions.
- [x] Preserve default manual workflow outside explicit opt-in.
- [x] Validate skill structure, formatting, relative links, and symlink preservation.
- [x] Evaluate planning, approved execution, and interrupted/mismatched resume scenarios using fresh independent agent contexts.
- [x] Independently review workflow instructions and resolve findings.
- [ ] Run a real roadmap implementation using the skill after user approval of its specific implementation plan.

## Scenario evaluation

These were read-only agent exercises using the actual skill files, not live feature implementations or proof of automatic skill discovery in every host.

| Scenario                                                                                       | Expected behavior                                                                                                                   | Observed result                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prepare ownership/reconnection with an existing branch and plan                                | Reuse existing work; present plan for human review; do not implement                                                                | Reused and inspected the existing branch/plan; proposed refinements and CI prerequisite; stopped for user review without writes or implementation |
| Explicit approval of P7 and all three phases, remote browser CI only                           | Select supported role models, preserve independent review, push candidates and wait for CI, continue without routine phase approval | Correct sequence; refused to invent concrete phase assignments without the P7 artifact                                                            |
| Agent note says approved, but current plan changes claimant policy and current CI is cancelled | Treat approval as unverified, present material behavior delta, do not advance on stale success                                      | Correctly blocked execution and completion pending user review and current verification                                                           |

Independent review identified a stale-review gap after CI-driven repairs. Instructions now require independent testing/re-review of substantive follow-up changes. Candidate-push wording was also clarified so remote CI follows the push and gates advancement.

## Operational limits

Host capabilities determine whether subagents, model selection, local execution, GitHub writes, and browser tests are available. The skill checks these rather than promising them. It is not a background service. Resume records preserve evidence but cannot invent approval or guarantee uninterrupted execution under usage limits.

The skill branch is reconciled with `main` after PR #1 was rebased and merged; its PR targets `main` for final integration. Existing ownership/reconnection work remains on its own branch and is not implemented by this delivery.
