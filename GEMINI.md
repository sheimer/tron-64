# Antigravity Workspace Guidelines

## File Modification Rules
* **Modifying Existing Files:** Always use `replace_file_content` for making edits or updates to existing files. Inspect existing file content with `view_file` before making modifications.
* **Creating Files:** Use `write_to_file` exclusively when creating brand new files or when an explicit complete file rewrite is requested.
* **Config & Template Preservation:** Never strip or overwrite configuration files, env templates (`.env.example`), deployment settings, or existing project assets unless specifically requested to refactor them.

## Code Comments & Documentation Rules
* **Preserve Meaningful Comments:** Maintain all existing comments, explanations, and docstrings unless they are clearly redundant or obsolete. Never strip out design notes, lifecycle descriptions, or contextual comments.

