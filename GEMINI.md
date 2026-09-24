# Bitcycles Workspace Guidelines

## File Modification Rules

- **Modifying Existing Files:** Inspect the relevant existing content before editing. Use the available editing tools to make targeted changes, preserve unrelated content and user edits, and review the resulting diff. Reuse content already inspected unless it may have changed.
- **Creating Files:** Check whether a file already exists, including dotfiles such as `.env.example`, `.nvmrc`, and `.gitignore`. Do not overwrite an existing file as though it were new; use a complete rewrite only when explicitly requested.
- **Config & Template Preservation:** Never strip, overwrite, or truncate configuration files, env templates (`.env.example`), deployment settings, or existing project assets. When adding new parameters or options to template files (e.g. `.env.example` or service templates), always preserve all existing environment variables, defaults, sections, and explanatory comments.

## Code Comments & Documentation Rules

- **Preserve Meaningful Comments:** Maintain all existing comments, explanations, and docstrings unless they are clearly redundant or obsolete. Never strip out design notes, lifecycle descriptions, or contextual comments.
- **Emoji & Emoticon Hesitancy:** Avoid emojis and emoticons in source code, shell scripts, CLI output, commit messages, and documentation unless explicitly requested.
- **Relative Links in Repository Markdown Files:** In all repository documentation and tracked markdown files (`README.md`, `CHANGELOG.md`, `ROADMAP.md`, `GEMINI.md`, `docs/plans/`, `docs/architecture/`, etc.), ALWAYS use relative repository paths for markdown links (e.g. `[scripts/deploy.sh](scripts/deploy.sh)` or `[testing.md](docs/architecture/testing.md)`). NEVER write absolute machine paths or `file://` URIs into repository files so links render and navigate correctly on GitHub and across developer machines without leaking local filesystem structures.

## Code Quality, Linting & Formatting Rules

- **Linter Hygiene (ESLint):** The codebase enforces ESLint (`eslint.config.js`) with `'no-unused-vars': 'error'`. Never leave unused imports, variables, or functions in new or modified files. Run `npx eslint <changed_js_files>` on changed JavaScript files covered by the ESLint configuration before handing off implementation changes. Do not pass Markdown or other unsupported files to ESLint.
- **Code Formatting (Prettier):** Run `npx prettier --write <changed_supported_files>` on changed files supported by Prettier and not excluded by `.prettierignore`. Follow `.prettierrc` (single quotes, no semicolons, trailing commas, 80-character print width). Keep formatting scoped to the requested changes.

## Testing Guidelines

- **Test Location:** Place all unit and integration test scripts in the `test/` directory using the `.test.js` naming convention (e.g. `test/<feature>.test.js`).
- **Test Runner:** All test suites are aggregated and executed in isolated processes by `test/runAll.js` via `npm test`.
- **Verification Scope:** Use affected tests during implementation and run `npm test` before handing off an implementation phase. Fix failures caused by the change and rerun the relevant checks; repeat the full suite when subsequent changes could invalidate its result. Report unrelated failures or unavailable checks explicitly. For documentation-only changes, check the diff, links, and formatting; application tests are not required. Run benchmarks when performance is affected or measurement is requested.
- **Benchmarks:** Place load, stress, and latency benchmark tools in the `benchmark/` directory (e.g. `benchmark/stress.js`), executed via `npm run benchmark` or `npm run benchmark:stress`.

## Git & Workflow Rules

- **No Staging / Commits by Assistant:** Never run `git add`, `git commit`, `git rm`, or `git restore` on behalf of the user. Staging is actively used by the user to review changes incrementally. Only run non-mutating status/diff checks (e.g. `git status`, `git diff`).
- **Commit Message in `tmpcommit.md`:** Whenever the user indicates readiness to commit (or asks for a commit message), write the proposed developer commit message and description to `tmpcommit.md` (which is gitignored) so the user can easily review and copy it. When configured via `./scripts/setup-git-hooks.sh`, commits initiated via Neovim Fugitive (`cc` in `:G`) or CLI `git commit` automatically pre-populate the commit buffer from `tmpcommit.md`.
- **Plan Execution (One Phase per Reviewable Commit):** When executing a plan or task with defined phases or milestone checklists (e.g. in `docs/plans/`), execute strictly **one phase at a time**. An explicitly requested phase is authorization to complete that phase, including necessary fixes, verification, and documentation, without asking again for routine steps. Each phase must end with a complete, verified change ready for review and commit:
  - Implement the full phase and complete the applicable checks under Testing Guidelines. Do not stop at a first implementation while required fixes or verification remain.
  - Update the corresponding phase checkboxes and any affected documentation before review. Mark only verified work complete.
  - Write the proposed commit message tailored for that specific phase to `tmpcommit.md`.
  - Stop at the completed phase boundary for the user to review, stage, and commit before beginning the next phase. If blocked before completion, explain the blocker and remaining work. Never bundle multiple planned phases into a single turn unless explicitly instructed.
- **Roadmap Work:** Work through roadmap items individually, splitting into reviewable commits as needed. Briefly explain what and why before implementation. Proceed when the user has explicitly requested the item or phase; ask for confirmation when proposing additional scope or when a material unresolved decision prevents implementation. Include roadmap and documentation updates in the reviewable change, and incorporate review feedback before commit. Refine the roadmap along the way.
- **Changelog & Roadmap Maintenance:**

  - For player-facing changes, update `CHANGELOG.md` with human-readable release notes under `[Unreleased]` or the corresponding version tag following the _Keep a Changelog_ format.
  - When milestones or roadmap items are completed, move them from active sections in `ROADMAP.md` into `## Implemented Foundation & Historical Milestones`, linking them to their respective documentation plans and `CHANGELOG.md`.

- **Living Architecture & Domain Guide Maintenance:**
  - Update the corresponding guide in `docs/architecture/` when a change affects documented behavior, architectural contracts, or development workflows. Editing an implementation or test without changing those facts does not require a guide update.
  - Keep the guide links and brief scope descriptions below accurate when guides are added, renamed, or change scope. Keep subsystem details in the guides rather than duplicating them here.

## Architecture & Domain Guides (Read On-Demand)

Consult the relevant guide when the task touches its subsystem; unrelated guides need not be loaded:

- **Networking & WebSockets:** [`docs/architecture/protocol.md`](docs/architecture/protocol.md) — Connection model, frame formats, and latency handling.
- **Lifecycles & Rooms:** [`docs/architecture/lifecycle.md`](docs/architecture/lifecycle.md) — Screen routing, match and room state, session restoration, and cleanup.
- **Canvas & Rendering:** [`docs/architecture/rendering.md`](docs/architecture/rendering.md) — Rendering, themes, layout, and UI lifecycle.
- **Testing & Benchmarks:** [`docs/architecture/testing.md`](docs/architecture/testing.md) — Test execution, browser verification, benchmarks, and palette gallery generation.
