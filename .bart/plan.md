# Refactor bart-plan skill: standalone planner → post-plan converter

## Context

The `bart-plan` skill currently acts as a standalone planner — it asks the user what to build, gathers requirements, and writes `plan.md` from scratch. This duplicates Claude's native planning ability.

The desired workflow is: **Claude plans naturally first** (via `/plan` or conversation), then the user triggers `/bart-plan` to **convert** that plan into bart-compatible format with `[REQ-XX]` tags, workstreams, specialist assignments, and file references.

## Changes

### 1. Rewrite `skills/bart-plan/SKILL.md`

Transform from "planner" to "converter". The new workflow:

1. **Locate source plan** — Find the latest plan in `~/.claude/plans/`, or accept a path argument
2. **Analyze** — Parse the freeform plan's structure, goals, files, and work items
3. **Discover specialists** — Run `bart specialists` (same as today)
4. **Derive requirements** — Extract `[REQ-XX]` requirements from the plan's goals/context
5. **Structure** — Reorganize into bart workstreams with specialist tags and file refs
6. **Validate** — Same checklist as today (coverage, specialist tags, ordering)
7. **Write** — Output `plan.md` and confirm summary

Key changes to the skill text:
- Title: "Bart Plan Converter" (was "Bart Plan Creator")
- Description triggers: add "convert a plan for bart", "convert this to bart format", "make this plan bart-compatible"
- Remove Step 2 "Gather Requirements" (user already planned)
- Add Step 1 "Locate source plan" and Step 2 "Analyze source plan"
- Keep Format Reference, Parser Rules, Workstream Separation Rules, and Validation sections unchanged
- Add a before/after conversion example showing freeform Claude plan → bart format
- Include fallback: if no source plan found, tell user to plan first or provide a path

### 2. Add `bart convert` CLI alias in `src/cli.ts`

Add a new case in the switch statement (~5 lines):

```typescript
case "convert":
case "c":
  const convertLatest = true;
  const convertAutoConfirm = args.includes("-y") || args.includes("--yes");
  await runPlanCommand(cwd, tasksPath, planPath, convertLatest, convertAutoConfirm);
  break;
```

Update `showHelp()` to include:
```
bart convert           Convert latest Claude plan to bart tasks
```

**Note:** The `"c"` alias currently doesn't conflict — there's no existing `c` shortcut.

### 3. Update root `SKILL.md`

Minor text update in the "AI-Assisted Plan Creation" section to reflect that bart-plan converts existing plans rather than creating from scratch.

## Files to modify

| File | Change |
|------|--------|
| `skills/bart-plan/SKILL.md` | Rewrite: planner → converter workflow |
| `src/cli.ts` | Add `convert`/`c` command alias + help text |
| `SKILL.md` | Update bart-plan reference text |

No changes needed to: `src/plan.ts`, `src/specialists.ts`, `src/constants.ts`, `src/tasks.ts`

## Verification

1. Read the rewritten `skills/bart-plan/SKILL.md` and confirm it describes a conversion workflow
2. Run `bun run src/index.ts convert --help` or `bun run src/index.ts help` — confirm `convert` appears
3. Run `bun run src/index.ts convert` — confirm it calls `runPlanCommand` with `useLatestPlan=true`
