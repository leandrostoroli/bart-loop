# Plan: Add Requirements Coverage & Specialist Discovery to Bart-Loop

## Requirements
- [REQ-01] Plans support a `## Requirements` section with `[REQ-XX]` IDs for explicit coverage tracking
- [REQ-02] Plans without explicit requirements auto-generate them from `##` section headings
- [REQ-03] `bart specialists` discovers skills, agents, and commands from the Claude Code ecosystem
- [REQ-04] Tasks can be tagged with `[specialist-name]` for specialist routing
- [REQ-05] A `bart-plan` skill guides AI agents to produce bart-optimized plans
- [REQ-06] `bart status` and `bart dashboard` display requirements coverage and specialist assignments

## Foundation
### Extend data model with requirements and specialist types [REQ-01] [REQ-03]
Add `Requirement` and `Specialist` interfaces to `src/constants.ts`. Extend `Task` with `requirements` and `specialist` fields. Extend `TasksData` with top-level `requirements` and `specialists` arrays.
Files: src/constants.ts

### Implement hybrid requirements extraction in plan parser [REQ-01] [REQ-02]
Update `src/plan.ts` to detect `## Requirements` sections and parse `[REQ-XX]` IDs. If no explicit section exists, auto-generate requirement groups from `##` headings. Scan task descriptions for `[REQ-XX]` references to build coverage mapping.
Files: src/plan.ts

### Add coverage calculation function [REQ-01] [REQ-02]
New `calculateCoverage()` function in `src/tasks.ts` that updates requirement statuses (`none`, `partial`, `complete`) based on task completion states.
Files: src/tasks.ts

## Specialist Discovery
### Implement specialist discovery and matching [REQ-03] [REQ-04]
Create `src/specialists.ts` with `discoverSpecialists()` to scan Claude Code directories, `matchSpecialist()` for auto-matching tasks, and `parseFrontmatter()` for YAML parsing.
Files: src/specialists.ts

### Integrate specialist assignment into plan parser [REQ-04]
Update `src/plan.ts` to parse `[specialist-name]` tags from `###` headings, run auto-matching, and store assignments on tasks.
Files: src/plan.ts

### Add `bart specialists` CLI command [REQ-03]
New command to list discovered specialists with their type, source, and description.
Files: src/cli.ts

## Display & Reporting
### Add requirements coverage to status and dashboard [REQ-06]
Show coverage summary in `bart status` output. Add `RequirementsPanel` component to `src/dashboard.tsx`. Show specialist labels on task rows.
Files: src/status.ts, src/dashboard.tsx

### Add `bart requirements` command [REQ-06]
Dedicated coverage report command with `--gaps` flag for showing only uncovered/partial requirements.
Files: src/cli.ts

## Planning Skill
### Create bart-plan skill file [REQ-05]
Write `skills/bart-plan/SKILL.md` with frontmatter, specialist discovery step, requirement gathering guidance, plan format template, workstream separation rules, and validation checklist.
Files: skills/bart-plan/SKILL.md

### Update SKILL.md and README with bart-plan references [REQ-05]
Reference the new bart-plan skill in the existing `SKILL.md` and add plan format documentation to `README.md`.
Files: SKILL.md, README.md
