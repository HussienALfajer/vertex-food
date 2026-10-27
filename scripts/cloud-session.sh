#!/usr/bin/env bash
# SessionStart hook: prepares a Claude Code cloud session in the `vertex` environment
# (docs/workflow.md, "Cloud sessions"). A silent no-op everywhere else.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if command -v vertex-session >/dev/null 2>&1; then
  vertex-session "${CLAUDE_PROJECT_DIR:-.}"
else
  echo "Not in the 'vertex' cloud environment: vertex-session is missing; docs/workflow.md (Cloud sessions) explains the setup."
fi

exit 0
