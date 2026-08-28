# Antigravity Workspace Guidelines

## File Modification Rules
* **Modifying Existing Files:** Always use `replace_file_content` for making edits or updates to existing files. Inspect existing file content with `view_file` before making modifications.
* **Creating Files:** Use `write_to_file` exclusively when creating brand new files or when an explicit complete file rewrite is requested.
* **Config & Template Preservation:** Never strip or overwrite configuration files, env templates (`.env.example`), deployment settings, or existing project assets unless specifically requested to refactor them.

## Code Comments & Documentation Rules
* **Preserve Meaningful Comments:** Maintain all existing comments, explanations, and docstrings unless they are clearly redundant or obsolete. Never strip out design notes, lifecycle descriptions, or contextual comments.

## Testing Guidelines
* **Test Location:** Place all unit and integration test scripts in the `test/` directory using the `.test.js` naming convention (e.g. `test/<feature>.test.js`).
* **Test Runner:** All test suites are aggregated and executed in isolated processes by `test/runAll.js` via `npm test`.
* **Benchmarks:** Place load, stress, and latency benchmark tools in the `benchmark/` directory (e.g. `benchmark/concurrency.js`), executed via `npm run benchmark`.

## Git & Workflow Rules
* **No Staging / Commits by Assistant:** Never run `git add`, `git commit`, `git rm`, or `git restore` on behalf of the user. Staging is actively used by the user to review changes incrementally. Only run non-mutating status/diff checks (e.g. `git status`, `git diff`).
* **Commit Message in `tmpcommit.md`:** Whenever the user indicates readiness to commit (or asks for a commit message), write the proposed developer commit message and description to `tmpcommit.md` so the user can easily review and copy it.
* **Changelog & Roadmap Maintenance:**
  - Update `CHANGELOG.md` with human-readable, player-facing release notes under `[Unreleased]` or the corresponding version tag following the *Keep a Changelog* format.
  - When milestones or roadmap items are completed, move them from active sections in `ROADMAP.md` into `## Completed Milestones`, linking them to their respective documentation plans and `CHANGELOG.md`.

## Architecture & Domain Guides (Read On-Demand)
When working on specific subsystems, consult the corresponding domain guide in `docs/architecture/`:
* **Networking & WebSockets:** [`docs/architecture/protocol.md`](docs/architecture/protocol.md) — Single WebSocket model, binary frame formats, opcode fast-paths, latency CQI.
* **Lifecycles & Rooms:** [`docs/architecture/lifecycle.md`](docs/architecture/lifecycle.md) — Match state machines, mid-round disconnects, zero-trail restarts, session restoration, room reaper.
* **Canvas & Rendering:** [`docs/architecture/rendering.md`](docs/architecture/rendering.md) — Hybrid delta renderer, Int8Array grid buffer, DPR media query scaling, CSS custom properties.
* **Testing & Benchmarks:** [`docs/architecture/testing.md`](docs/architecture/testing.md) — Isolated child runner (`runAll.js`), `--expose-gc` heap tests, Playwright browser leak verification, concurrency benchmarks.



