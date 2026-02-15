# Plan: Auto-Trigger Skill Installation for bart-plan

## Context

The `bart-plan` skill exists at `.claude/skills/bart-plan.skill` inside the bart-loop repo, but it's only available when Claude runs inside that directory. The user needs it globally available so any project can trigger it. This requires an install mechanism that copies the skill to `~/.claude/skills/` (and optionally to OpenCode/Gemini equivalents).

GSD solves this with a `bin/install.js` script that copies commands/agents to `~/.claude/`, `~/.config/opencode/`, and `~/.gemini/` with path replacement. Bart-loop needs a similar but simpler mechanism.

---

## What to Build

### 1. Add `bart install` command

New CLI command in `src/cli.ts` that copies the skill to global directories:

```bash
bart install              # Install skill to detected runtimes (auto-detect claude/opencode)
bart install --claude     # Install to ~/.claude/skills/ only
bart install --opencode   # Install to ~/.config/opencode/skills/ only
bart install --global     # Alias for default behavior (global install)
```

**What it does:**
1. Detects which runtimes are available (same `detectAgent()` logic already in cli.ts)
2. Copies `.claude/skills/bart-plan.skill` → `~/.claude/skills/bart-plan.skill`
3. For OpenCode: copies to `~/.config/opencode/skills/bart-plan.skill` (with path adjustments if needed)
4. Prints confirmation with next steps

**Implementation in `src/cli.ts`:**
- New `install` case in the switch statement
- New `installSkill(runtime: string)` function that:
  - Resolves the skill source path (relative to the bart-loop package)
  - Creates the target directory (`~/.claude/skills/`) if it doesn't exist
  - Copies the file
  - Prints success message

**Source path resolution:**
The skill file lives in the bart-loop package at `.claude/skills/bart-plan.skill`. When installed globally via npm, the package is at `node_modules/bart-loop/`. The install function needs to find the skill relative to the package root:

```typescript
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, ".."); // src/ -> package root
const skillSource = join(packageRoot, ".claude", "skills", "bart-plan.skill");
```

### 2. Postinstall hook in package.json

Add an npm postinstall script so the skill gets installed automatically when the user runs `npm install -g bart-loop`:

```json
{
  "scripts": {
    "postinstall": "node scripts/postinstall.js"
  }
}
```

**New file: `scripts/postinstall.js`**
- Checks if `~/.claude/` exists (Claude Code is installed)
- If yes: creates `~/.claude/skills/` and copies the skill file
- If no: silently skips (user may not have Claude Code)
- Checks if `~/.config/opencode/` exists for OpenCode
- Prints a one-line message: `bart-plan skill installed to ~/.claude/skills/`
- Never fails the install (wrapped in try/catch) — the skill is optional

### 3. Update help text

Update `showHelp()` in `src/cli.ts` to include the new command:

```
bart install           Install bart-plan skill globally (enables auto-trigger in Claude/OpenCode)
```

### 4. Move skill to a discoverable location in the package

Currently at `.claude/skills/bart-plan.skill`. This works for project-local usage but is hidden. Also add the skill to the package `files` field so it's included in the npm package:

**`package.json`** — Add to `files` array (or ensure the `.claude` dir is included):
```json
{
  "files": ["src/", ".claude/", "scripts/", "bart-prompt-template.md"]
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/cli.ts` | Add `install` command case + `installSkill()` function; update `showHelp()` |
| `package.json` | Add `postinstall` script; add `files` array to include `.claude/` and `scripts/` |

## New Files

| File | Purpose |
|------|---------|
| `scripts/postinstall.js` | Npm postinstall hook that auto-copies skill to `~/.claude/skills/` on global install |

## Existing Files (no changes)

| File | Notes |
|------|-------|
| `.claude/skills/bart-plan.skill` | Already exists, already correct — just needs to be copied to global location |

---

## Verification

1. **Manual install**: Run `bart install` → verify `~/.claude/skills/bart-plan.skill` exists with correct content
2. **npm global install**: Run `npm install -g .` from bart-loop root → verify postinstall copies the skill automatically
3. **Auto-trigger**: Start a new Claude Code session in a different project → say "plan this project for bart" → verify Claude loads the bart-plan skill and follows its instructions
4. **Idempotent**: Run `bart install` twice → no errors, file is overwritten cleanly
5. **Missing runtime**: Remove `~/.claude/` temporarily → run `bart install` → verify it warns gracefully instead of crashing
