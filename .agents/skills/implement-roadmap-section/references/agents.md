# Agent roles and model selection

Use the runtime's actual model catalog and controls. Names below are preferences for this repository, not promises that every host supports them. Check availability at execution time; never claim to switch the lead model when the host does not expose that control.

| Role        | Preferred model / effort | Assignment                                                                        |
| ----------- | ------------------------ | --------------------------------------------------------------------------------- |
| Lead        | Current session model    | Own approval, orchestration, integration, commits, CI evidence, and PR            |
| Implementer | GPT-6 Sol / high         | Implement one approved phase and its tests/documentation                          |
| Tester      | GPT-6 Sol / high         | Independently assess acceptance coverage, add missing tests, and verify execution |
| Reviewer    | GPT-6 Astra / high       | Review final changes and contracts independently                                  |

Where exposed, corresponding tool identifiers are `gpt-6-sol` and `gpt-6-astra`, with `high` reasoning. Use higher reasoning for a concrete unresolved security/concurrency issue, not for every routine task. A straightforward documentation phase can use a lower effort setting if available. Respect user model/budget preferences.

If a preferred model is absent, use an available coding-capable model and report the substitution unless the user required that exact model. Separate contexts still provide role independence when models are the same. If no subagents exist, stop and offer a sequential workflow explicitly described as lacking independent agent review. A skill cannot create missing runtime capabilities.

Use fresh, minimal-context assignments when selecting a model requires a non-inherited agent configuration. Supply repository instructions and the plan explicitly. Preserve independence: reviewers receive source/diffs/tests and acceptance criteria, not a prompt telling them the expected verdict.

## Handoffs

Include in each assignment:

- Repository/worktree, branch, phase, approved plan revision, and relevant rules.
- Exact owned files or read-only status; identify other concurrent writers.
- Acceptance criteria, exclusions, test commands, and required report format.
- No commits/pushes, scope expansion, credential exposure, or changes to another agent's files.

Implementer reports changed behavior, files, tests actually run, and uncertainties. Tester reports coverage gaps, commands/results, skipped/unavailable checks, and failure evidence. Reviewer reports actionable findings or “no blocking findings,” with residual risks. Agent confidence is not a substitute for executed checks.

The lead arbitrates disagreements against the approved contract, integrates fixes, and revalidates changed code. Do not let agents race to edit a shared file. Assign follow-up fixes to one writer, or use separate worktrees and inspect integration diffs.
