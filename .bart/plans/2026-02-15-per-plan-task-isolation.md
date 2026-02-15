# Plan: Per-Plan Task Isolation

## Requirements
- [REQ-01] Each converted plan gets its own directory under .bart/plans/<slug>/
- [REQ-02] Each plan directory contains both plan.md and tasks.json
- [REQ-03] bart plan writes tasks to the plan's own directory, not a global tasks.json
- [REQ-04] bart run/status/dashboard can target a specific plan via --plan flag
- [REQ-05] Without --plan, bart auto-selects the most recently modified plan
- [REQ-06] bart plans command lists all plans with status summaries
- [REQ-07] Legacy .bart/tasks.json still works as fallback for backward compatibility

## Plan Storage & Resolution
### Update runPlanCommand to write per-plan directories [REQ-01] [REQ-02] [REQ-03]
Change plan output from flat `.bart/plans/<date>-<slug>.md` to a directory structure: `.bart/plans/<date>-<slug>/plan.md` with a co-located `tasks.json`. Update `tasksData.plan_file` to point to the relative plan path within the directory.
Files: src/plan.ts

### Add resolvePlanTasksPath helper [REQ-05] [REQ-07]
New function `resolvePlanTasksPath(cwd, planSlug?)` that resolves the correct tasks.json path. If planSlug provided, return `.bart/plans/<slug>/tasks.json`. If no slug, find the most recently modified `tasks.json` under `.bart/plans/*/`. Fallback to legacy `.bart/tasks.json`.
Files: src/plan.ts

### Update findLatestBartPlan to search subdirectories [REQ-01] [REQ-05]
Change `findLatestBartPlan()` to look for `plan.md` files inside `.bart/plans/*/` subdirectories instead of flat files in `.bart/plans/`.
Files: src/plan.ts

## CLI Plan Selection
### Add --plan flag and update tasksPath resolution [REQ-04] [REQ-05] [REQ-07]
Add `planSlug` variable to CLI argument parsing. Update `tasksPath` determination in `main()` to follow priority: 1) `--tasks` flag (escape hatch), 2) `--plan <slug>` resolves to `.bart/plans/<slug>/tasks.json`, 3) auto-select latest `tasks.json` in `.bart/plans/*/`, 4) fallback to legacy `.bart/tasks.json`. Update help text for all commands.
Files: src/cli.ts

### Add bart plans command [REQ-06]
New `plans` command that lists all plan directories under `.bart/plans/` with status summary: plan name, task progress (X/Y done), workstreams, and date. Mark the most recent as active.
Files: src/cli.ts

## Constants & Skill Update
### Replace TASKS_FILE with BART_DIR and PLANS_DIR constants [REQ-01]
Remove the `TASKS_FILE` constant. Add `BART_DIR = ".bart"` and `PLANS_DIR = ".bart/plans"`. Update any imports that reference `TASKS_FILE`.
Files: src/constants.ts, src/cli.ts

### Update bart-plan skill Step 7 output path [REQ-01] [REQ-02]
Update the skill's write step to reflect the new directory structure: `.bart/plans/<YYYY-MM-DD>-<slug>/plan.md` (directory, not flat file). Clarify that tasks.json is generated separately by `bart plan`.
Files: skills/bart-plan/SKILL.md
