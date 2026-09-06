#!/usr/bin/env bash
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.githooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "Error: Directory $HOOKS_DIR does not exist." >&2
  exit 1
fi

echo "Setting executable permissions on hooks in .githooks/..."
chmod +x "$HOOKS_DIR"/*

echo "Configuring Git hooks path (git config core.hooksPath .githooks)..."
git -C "$REPO_ROOT" config core.hooksPath .githooks

echo "Git hooks configured successfully."
echo ""
echo "Workflow:"
echo "- When committing via Neovim Fugitive ('cc' in :G) or CLI 'git commit':"
echo "  prepare-commit-msg will pre-populate the commit editor with tmpcommit.md if present."
echo "- After a successful commit:"
echo "  post-commit will reset tmpcommit.md to avoid reusing stale messages."
echo ""
echo "To deactivate Git hooks:"
echo "  git config --unset core.hooksPath"
