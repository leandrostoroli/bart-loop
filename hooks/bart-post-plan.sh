#!/bin/bash
# Detect plan writes to .claude/plans/ and auto-trigger bart conversion
# Installed by: bart init

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Only trigger for .md files written to .claude/plans/
[[ "$FILE_PATH" != *".claude/plans/"* ]] && exit 0
[[ "$FILE_PATH" != *.md ]] && exit 0

# Only trigger if .bart/ directory exists
[ ! -d ".bart" ] && exit 0

# Signal to Claude that bart conversion is available
echo "A plan was just written to $FILE_PATH. Since this project uses bart (.bart/ exists), suggest running 'bart plan --latest -y' to generate tasks, or invoke the /bart-plan skill for full specialist assignment."
