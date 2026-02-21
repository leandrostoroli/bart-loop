---
name: bart-plan
description: |
  IMPORTANT: Automatically invoke this skill BEFORE Claude presents a plan for implementation
  when the project has a .bart/ directory. When you detect a .bart/ folder in the project root
  and you are about to finish writing or approving a plan (via /plan, plan mode, or ExitPlanMode),
  invoke this skill FIRST to convert the plan to bart format. This way the user can dismiss
  Claude's implementation prompt knowing bart-plan has already captured and converted the plan.
  Also use when the user asks to "convert a plan for bart", "convert this to bart format",
  "make this plan bart-compatible", "create a bart plan", "plan this project for bart",
  "break this down into bart tasks", "create a plan for parallel execution",
  "plan workstreams", or wants to structure work for automated AI agent execution
  via bart-loop. Also activates when the user invokes /bart-plan.
version: 4.0.0
---

# Bart Plan Converter

You convert existing plans into **bart-loop** format — a structured `plan.md` that `bart plan` parses into tracked tasks with requirements coverage, specialist assignment, and dependency resolution.

**You are not a planner.** The user has already planned using Claude's native planning (`/plan`, conversation, or an external document). Your job is to locate that plan and restructure it into bart-compatible format.

## Auto-Trigger (Hook Before Plan Completion)

This skill auto-triggers as a **pre-implementation hook** when:
1. Claude has just finished writing a plan (via `/plan`, plan mode, or `ExitPlanMode`)
2. AND the project has a `.bart/` directory in its root

**Timing is critical:** Run this skill BEFORE presenting the plan for implementation. The user expects bart-plan to catch every plan automatically so they can dismiss Claude's "shall I implement?" prompt — the plan is already saved in `.bart/plans/` for `bart run` to execute later.

When auto-triggered, skip asking the user for plan source — proceed directly with conversion using the plan that was just created. However, **always pause at Step 3c** to confirm skill/agent assignments with the user before writing the final plan.

## How It Works

The user triggers this skill manually or it auto-triggers before plan implementation. You then:

1. **Locate source plan** — Find the plan just created in `.claude/plans/` or `~/.claude/plans/`, or accept a path argument
2. **Analyze source plan** — Parse the freeform plan's structure, goals, files, and work items
3. **Discover skills & propose assignments** — Find local specialists + search `find-skills` if installed, propose skill/agent per task, ask user to confirm
4. **Derive requirements** — Extract `[REQ-XX]` requirements from the plan's goals and context
5. **Structure** — Reorganize into bart workstreams with confirmed specialist tags and file references
6. **Validate** — Ensure full requirements coverage, correct specialist tags, and proper workstream ordering
7. **Write** — Save to `.bart/plans/<date>-<slug>.md` and confirm. The user then runs `bart plan` → `bart run`.

## Input

**Query**: $ARGUMENTS

If a path is provided, use it as the source plan. Otherwise, search for the latest Claude plan.

## Step 1: Locate Source Plan

Find the source plan to convert. Check in order:

1. **Path argument** — If the user provided a file path, use it directly
2. **Just-created plan** — If auto-triggered after plan mode, use the plan file that was just written (check `.claude/plans/` for the most recently modified `.md` file)
3. **Latest Claude plan** — Search `./.claude/plans/` then `~/.claude/plans/` for the most recently modified `.md` file

If no source plan is found, tell the user:

```
No source plan found. Please either:
1. Create a plan first using Claude's /plan command or in conversation
2. Provide a path: /bart-plan path/to/your/plan.md
```

Do NOT proceed to gather requirements from scratch — that is Claude's job, not yours.

## Step 2: Analyze Source Plan

Read the source plan and extract:

- **Goals / objectives** — What the plan aims to achieve (these become requirements)
- **Work items** — Individual tasks, steps, or changes described (these become `###` tasks)
- **File references** — Any files, paths, or directories mentioned (these become `Files:` lines)
- **Dependencies** — Any ordering or sequencing implied between work items
- **Technical context** — Stack, constraints, patterns mentioned

Do not discard information. Every meaningful work item in the source plan should map to a task in the output.

## Step 3: Discover Skills & Propose Assignments

For each task, determine the best skill or agent to execute it. This is a critical step — the right specialist assignment directly impacts execution quality.

### 3a. Discover available skills

First, collect all available skills/agents/commands from two sources:

**Local specialists** — always check:
```bash
bart specialists --history 2>/dev/null || echo "No local specialists discovered"
```

Use history stats when proposing assignments: prefer high completion-rate specialists for critical tasks, flag high reset-rate specialists, note untested specialists in the confidence column.

**Remote skill search** — check if `find-skills` is installed:
```bash
claude -p "Use the find-skills skill to search for: test" 2>/dev/null | head -5
```

If `find-skills` responds with skill results, it's available. If it errors or is not recognized, skip remote search and rely on local specialists only.

### 3b. Analyze each task and propose a skill/agent

For every task extracted from the source plan:

1. **Look at the task context** — what is the task doing? (writing code, running tests, deploying, configuring, designing, documenting, etc.)
2. **Check local specialists first** — is there a local skill/agent/command that matches this task's domain?
3. **Search remotely if needed** — if no strong local match exists AND `find-skills` is available, search for a relevant skill:
   ```
   Use the find-skills skill to search for: <task domain keywords>
   ```
4. **Fall back to default** — if no specialist matches, leave the task untagged (it will run with the default claude/opencode agent)

### 3c. Present assignments and ask for confirmation

Before proceeding, present the user with a summary table of proposed assignments:

```
Proposed skill/agent assignments:

  Task                              | Proposed Skill/Agent     | Confidence
  ----------------------------------|--------------------------|------------
  Initialize project config         | (default agent)          | —
  Build REST API endpoints          | backend-developer        | High
  Create React dashboard            | frontend                 | High
  Write integration tests           | test-runner              | Medium
  Set up CI pipeline                | ?                        | Low

Tasks marked "?" or "Low" confidence — I'm not sure which skill fits best.
```

**Ask refinement questions when confidence is low or medium:**

- "Task X involves both database migrations and API changes — should I use `backend-developer` or split it into two tasks?"
- "I found a remote skill `vercel-deploy` that could handle Task Y — should I use it, or keep the default agent?"
- "Task Z is ambiguous — it could be handled by `frontend` (UI work) or `test-runner` (component tests). Which fits better?"

**Wait for the user to confirm or adjust assignments before proceeding to Step 4.** The user may:
- Approve all assignments as-is
- Override specific assignments
- Ask you to search for additional skills
- Decide to split or merge tasks based on specialist availability

### 3d. Apply confirmed assignments

After user confirmation, use the confirmed specialist names as `[specialist-name]` tags in the `###` task headings. Tasks with no specialist assignment get no tag.

## Step 4: Derive Requirements

Extract requirements from the source plan's goals, objectives, and context. Each requirement should be a concrete, verifiable outcome:

- Map high-level goals to `[REQ-XX]` identifiers
- Keep requirements atomic — one testable thing per requirement
- Ensure every work item from the source plan is covered by at least one requirement

## Step 5: Structure into Bart Format

The plan MUST follow this exact structure. The `bart plan` parser uses `##` headings as workstream boundaries and `###` headings as individual tasks.

### Format Reference

```markdown
# Plan: [Project Name]

## Requirements
- [REQ-01] First requirement description
- [REQ-02] Second requirement description
- [REQ-03] Third requirement description

## Section Name (becomes Workstream A)
### Task title [REQ-01]
Description of what to do.
Files: path/to/file.ts, path/to/other.ts

### [specialist-name] Another task title [REQ-02]
Description with specialist tag for routing.
Files: src/components/Thing.tsx

## Another Section (becomes Workstream B after every 2 sections)
### Task in next workstream [REQ-03]
Description of the task.
Files: src/api/endpoint.ts
```

### Parser Rules (how `bart plan` interprets this)

These rules are baked into the parser — your plan must conform to them:

1. **`## Requirements` section** — Parsed as explicit requirements. Each line must match: `- [REQ-XX] description`. If this section exists, tasks must reference requirements with `[REQ-XX]` markers. If omitted, requirements are auto-generated from `##` section headings (lower fidelity).

2. **`##` headings** — Define workstream boundaries. The first `##` section becomes workstream A, and the workstream letter increments every 2 sections (sections 1-2 → A, sections 3-4 → B, etc.). The `## Requirements` section is skipped.

3. **`###` headings** — Each becomes an individual task. The task ID is `{workstream}{number}` (e.g., A1, A2, B1).

4. **`[specialist-name]` in `###` headings** — Tags a task for a specific specialist. Must match a discovered specialist name.

5. **`[REQ-XX]` in `###` headings or nearby lines** — Links the task to that requirement for coverage tracking.

6. **File references** — The parser extracts file paths (pattern: `word/word.ext`) from the 10 lines after each `###` heading. List target files explicitly.

7. **Dependencies** — The parser detects dependency keywords ("depends", "after", "requir") in task titles to create dependency links to the previous task in the same section.

### Workstream Separation Rules

Follow these rules when organizing tasks into `##` sections:

1. **Group by independence** — Tasks in different `##` sections can run in parallel. If task X must finish before task Y, put them in the same section (Y after X), or use dependency keywords in Y's title.

2. **Foundation first** — Setup, scaffolding, and config tasks go in the first section (workstream A). Everything else builds on these.

3. **Feature verticals** — Group by feature domain, not technical layer. Don't create a "Models" section and an "API" section — create a "User Auth" section with both.

4. **File affinity** — Tasks touching the same files belong in the same workstream to avoid merge conflicts during parallel execution.

5. **Testing after features** — Integration tests and E2E tests go in a later section that depends on feature workstreams completing.

6. **3-5 tasks per section** — If a section would have 6+ tasks, split it into two sections.

7. **Specialist clustering** — Group tasks for the same specialist together when possible (all `[frontend]` tasks in one section, all `[backend]` in another) to enable one specialist per workstream.

## Step 6: Validate Before Writing

Before outputting the plan, verify:

- [ ] Every `[REQ-XX]` in the Requirements section has at least one task referencing it
- [ ] No task references a `[REQ-XX]` that doesn't exist in the Requirements section
- [ ] Sections are ordered by dependency (later sections can depend on earlier ones completing)
- [ ] Specialist tags (if used) match discovered specialist names — warn if using unknown tags
- [ ] Each section has 3-5 tasks (split or merge if needed)
- [ ] File paths are realistic and specific (not generic placeholders)
- [ ] Every work item from the source plan is represented in the output

## Step 7: Write and Confirm

Save the converted plan into its own directory under `.bart/plans/`:

```
.bart/plans/<YYYY-MM-DD>-<slug-from-title>/plan.md
```

For example: `.bart/plans/2026-02-15-fix-dashboard-performance/plan.md`

The slug is derived from the plan's `# Plan: ...` title, lowercased and hyphenated. Create the directory if it doesn't exist, then write `plan.md` inside it. Do NOT write a flat `.md` file directly in `.bart/plans/`.

Note: `tasks.json` is generated separately when the user runs `bart plan` — do not create it yourself. The `bart plan` command parses `plan.md` and produces a co-located `tasks.json` in the same directory.

Then tell the user:

```
Plan converted from [source] → .bart/plans/<slug>/plan.md
- X requirements derived
- Y tasks across Z workstreams
- Specialists used: [list or "none"]
- Coverage: all requirements mapped / N uncovered

Next: run `bart plan` to generate tasks, then `bart run` to execute.
```

## Conversion Example

### Before: Freeform Claude Plan

```markdown
# Fix dashboard performance

## Context
The dashboard page loads slowly due to unoptimized API calls and missing caching.
Users report 5-8 second load times. Target is under 2 seconds.

## Root Cause
1. The Overview component makes 6 sequential API calls that could be parallelized
2. No client-side caching — every navigation re-fetches all data
3. The metrics chart re-renders on every state change due to missing memoization

## Fix
- Refactor API calls in `src/pages/Overview.tsx` to use `Promise.all`
- Add React Query for data caching in `src/providers/QueryProvider.tsx`
- Memoize chart component with `React.memo` and `useMemo` for computed data
- Add loading skeletons to improve perceived performance

## Verification
- Lighthouse performance score > 90
- Dashboard loads in under 2 seconds on throttled 3G
```

### After: Bart-Compatible Plan

```markdown
# Plan: Fix Dashboard Performance

## Requirements
- [REQ-01] Dashboard loads in under 2 seconds
- [REQ-02] API calls are parallelized, not sequential
- [REQ-03] Client-side caching prevents redundant fetches
- [REQ-04] Chart component does not re-render unnecessarily

## API & Caching
### Parallelize API calls in Overview [REQ-01] [REQ-02]
Refactor the 6 sequential API calls in Overview to use Promise.all for parallel fetching.
Files: src/pages/Overview.tsx

### Add React Query provider for data caching [REQ-03]
Set up React Query with appropriate stale times to cache dashboard data across navigations.
Files: src/providers/QueryProvider.tsx, src/main.tsx

## Rendering & UX
### [frontend] Memoize chart component [REQ-04]
Wrap chart with React.memo and use useMemo for computed data to prevent unnecessary re-renders.
Files: src/components/MetricsChart.tsx

### [frontend] Add loading skeletons [REQ-01]
Add skeleton placeholders for dashboard panels to improve perceived performance during data fetch.
Files: src/pages/Overview.tsx, src/components/Skeleton.tsx

## Verification
### Run Lighthouse performance audit [REQ-01]
Verify Lighthouse performance score exceeds 90 and load time is under 2 seconds on throttled 3G.
Files: tests/performance.test.ts
```
