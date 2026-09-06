# Antigravity Workspace Guidelines

## File Modification Rules
* **Modifying Existing Files:** Always use `replace_file_content` for making edits or updates to existing files. Inspect existing file content with `view_file` before making modifications.
* **Creating Files:** Use `write_to_file` exclusively when creating brand new files or when an explicit complete file rewrite is requested. Never use `write_to_file` on existing files. Always check for existing files (including dotfiles like `.env.example`, `.nvmrc`, `.gitignore`) before creating files.
* **Config & Template Preservation:** Never strip, overwrite, or truncate configuration files, env templates (`.env.example`), deployment settings, or existing project assets. When adding new parameters or options to template files (e.g. `.env.example` or service templates), always preserve all existing environment variables, defaults, sections, and explanatory comments.


## Code Comments & Documentation Rules
* **Preserve Meaningful Comments:** Maintain all existing comments, explanations, and docstrings unless they are clearly redundant or obsolete. Never strip out design notes, lifecycle descriptions, or contextual comments.
* **Emoji & Emoticon Hesitancy:** Avoid emojis and emoticons in source code, shell scripts, CLI output, commit messages, and documentation unless explicitly requested.
* **Relative Links in Repository Markdown Files:** In all repository documentation and tracked markdown files (`README.md`, `CHANGELOG.md`, `ROADMAP.md`, `GEMINI.md`, `docs/plans/`, `docs/architecture/`, etc.), ALWAYS use relative repository paths for markdown links (e.g. `[scripts/deploy.sh](scripts/deploy.sh)` or `[testing.md](docs/architecture/testing.md)`). NEVER write absolute machine paths or `file://` URIs into repository files so links render and navigate correctly on GitHub and across developer machines without leaking local filesystem structures. (Note: The `file://` absolute URI scheme is strictly reserved for the assistant's interactive chat output to the user, never for committed repo files.)


## Testing Guidelines
* **Test Location:** Place all unit and integration test scripts in the `test/` directory using the `.test.js` naming convention (e.g. `test/<feature>.test.js`).
* **Test Runner:** All test suites are aggregated and executed in isolated processes by `test/runAll.js` via `npm test`.
* **Benchmarks:** Place load, stress, and latency benchmark tools in the `benchmark/` directory (e.g. `benchmark/stress.js`), executed via `npm run benchmark` or `npm run benchmark:stress`.

## Git & Workflow Rules
* **No Staging / Commits by Assistant:** Never run `git add`, `git commit`, `git rm`, or `git restore` on behalf of the user. Staging is actively used by the user to review changes incrementally. Only run non-mutating status/diff checks (e.g. `git status`, `git diff`).
* **Commit Message in `tmpcommit.md`:** Whenever the user indicates readiness to commit (or asks for a commit message), write the proposed developer commit message and description to `tmpcommit.md` (which is gitignored) so the user can easily review and copy it. When configured via `./scripts/setup-git-hooks.sh`, commits initiated via Neovim Fugitive (`cc` in `:G`) or CLI `git commit` automatically pre-populate the commit buffer from `tmpcommit.md`.
* **Plan Execution (One Phase per Reviewable Commit):** When executing a plan or task with defined phases or milestone checklists (e.g. in `docs/plans/`), execute strictly **one phase at a time**. Each phase must produce a runnable, reviewable commit:
  - Implement the changes and verify all test suites pass (`npm test`).
  - Update the corresponding phase checkboxes in the plan document.
  - Write the proposed commit message tailored for that specific phase to `tmpcommit.md`.
  - Stop execution and prompt the user to review in their editor, stage, and commit before beginning the next phase. Never bundle multiple planned phases into a single turn unless explicitly instructed.
* **Changelog & Roadmap Maintenance:**
  - Update `CHANGELOG.md` with human-readable, player-facing release notes under `[Unreleased]` or the corresponding version tag following the *Keep a Changelog* format.
  - When milestones or roadmap items are completed, move them from active sections in `ROADMAP.md` into `## Completed Milestones`, linking them to their respective documentation plans and `CHANGELOG.md`.
* **Living Architecture & Domain Guide Maintenance:**
  - Whenever introducing, refactoring, or modifying architectural patterns, network protocols, screen routing, rendering lifecycles, or test suites, proactively update the corresponding domain guide in `docs/architecture/` (`protocol.md`, `lifecycle.md`, `rendering.md`, `testing.md`).
  - Keep the guide summaries and links under `## Architecture & Domain Guides` in `GEMINI.md` synchronized with any new or updated architecture documentation.

## Architecture & Domain Guides (Read On-Demand)
When working on specific subsystems, consult the corresponding domain guide in `docs/architecture/`:
* **Networking & WebSockets:** [`docs/architecture/protocol.md`](docs/architecture/protocol.md) — Single WebSocket model, binary frame formats, opcode fast-paths, latency CQI.
* **Lifecycles & Rooms:** [`docs/architecture/lifecycle.md`](docs/architecture/lifecycle.md) — Client screen routing (`welcome`/`lobby`/`config`/`game`), header navigation (`btn-header-lobby`), match state machines, mid-round disconnects, zero-trail restarts, session restoration, room reaper.
* **Canvas & Rendering:** [`docs/architecture/rendering.md`](docs/architecture/rendering.md) — Hybrid delta renderer, Int8Array grid buffer, DPR media query scaling, multi-palette theming (Zenbones & retro presets), live CSS resolution, dual layout modes (natural welcome scroll vs fixed grid arena), accessible legal modals, anti-scraping email hydration.
* **Testing & Benchmarks:** [`docs/architecture/testing.md`](docs/architecture/testing.md) — Isolated child runner (`runAll.js`), `--expose-gc` heap tests, Playwright browser leak verification, concurrency benchmarks, welcome view route & modal tests, mathematical palette contrast & CVD verification, and visual gallery generation (`npm run test:palettes`).



