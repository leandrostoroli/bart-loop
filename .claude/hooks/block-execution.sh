#!/usr/bin/env bash
# block-execution.sh — PreToolUse hook that blocks execution-oriented tools
# when bart is in "thinking" or "planning" mode.
#
# Reads the current mode from .bart/mode. If mode is "thinking" or "planning",
# blocks Edit, Write, Bash, Task, and NotebookEdit — only read-only tools
# (Read, Glob, Grep, WebFetch, WebSearch, etc.) are allowed.
#
# Exit 0  = allow
# Exit 2  = block (with reason on stdout)

set -euo pipefail

# Find .bart/mode relative to the git repo root (or cwd)
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MODE_FILE="$ROOT/.bart/mode"

# If no mode file, everything is allowed
[ -f "$MODE_FILE" ] || exit 0

MODE="$(cat "$MODE_FILE" 2>/dev/null || true)"

# Only block during thinking/planning modes
case "$MODE" in
  thinking|planning) ;;
  *) exit 0 ;;
esac

# The tool name is passed via the TOOL_NAME env var by Claude Code hooks
TOOL="${TOOL_NAME:-}"

# Block execution-oriented tools — only allow Read, Glob, Grep, and other
# read-only tools during thinking/planning phases.
case "$TOOL" in
  Edit|Write|Bash|Task|NotebookEdit)
    echo "Execution blocked during ${MODE} phase. Complete the thinking/planning process first."
    exit 2
    ;;
  *)
    exit 0
    ;;
esac
