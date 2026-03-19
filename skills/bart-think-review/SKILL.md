---
name: bart-think-review
description: |
  Use when reviewing a plan.md written by bart-think. Invoke when the user says "review this
  plan", "check the thinking output", "validate the plan", "review decisions", or runs
  /bart-think-review. This skill is auto-invoked by bart-think after Phase 5 — you should
  not need to trigger it manually. It reviews decisions, requirements, and task structure,
  presents findings, and auto-chains to bart-plan when the user approves.
version: 1.0.0
---

# Bart Think Review — Plan Validation Before Structuring

You review a plan.md produced by bart-think, validating that decisions are concrete, requirements have full coverage, and tasks are feasible. You are the quality gate between thinking and planning.

**You are not a planner or editor.** Your job is to find gaps and present them to the user. The user decides what to change. When they approve, you hand off to bart-plan for structuring.

## Tool Restrictions

**CRITICAL: You MUST NOT use Edit, Write, or Bash tools** unless the user explicitly requests changes to the plan file. You are in review mode — read and analyze only. If the user asks for changes, apply them with Edit, then re-review.

Read-only tools (Read, Glob, Grep) are allowed at any time.

## Input

**Plan path**: $ARGUMENTS

If a path is provided, use it directly. Otherwise, find the most recently modified `plan.md` under `.bart/plans/`.

## Workflow

### Phase 1: Load and Parse

Read the plan.md file and extract:

- **Decisions** — Locked, Discretionary, and Deferred items from the `## Decisions` section
- **Requirements** — All `[REQ-XX]` items from the `## Requirements` section
- **Scope** — In-scope and deferred items (derived from decisions + requirements)
- **Tasks** — All `###` task headings with their descriptions, file references, and requirement tags
- **Specialist assignments** — Any `[specialist-name]` tags on tasks

If the file has no `## Decisions` section, note this as a finding — bart-think should always produce one.

### Phase 2: Review Decisions

Check each decision category for completeness:

**Locked decisions:**
- Is each decision concrete enough to implement? A locked decision like "Use REST" is concrete. "Use a good API design" is not.
- Are there obvious follow-up decisions that should be locked but aren't? For example, if "Use PostgreSQL" is locked but there's no decision about ORM vs raw SQL.
- Do locked decisions conflict with each other?

**Discretionary decisions:**
- Are these truly things Claude can decide freely, or did the user defer a decision that actually needs their input?
- Is the guidance provided sufficient for Claude to make a good choice?

**Deferred decisions:**
- Are any deferred items actually blocking for the current scope? If a deferred item is needed by an in-scope task, flag it.

**Gaps:**
- Given the scope, are there obvious architectural or design decisions that aren't mentioned at all? Surface 2-3 maximum — don't nitpick.

### Phase 3: Review Requirements Coverage

Check that requirements fully cover the scope:

1. **Scope → Requirements mapping**: For every in-scope item (from decisions + task descriptions), is there a corresponding `[REQ-XX]`? Flag scope items with no requirement.

2. **Requirements → Tasks mapping**: For every `[REQ-XX]`, is there at least one task that references it? Flag orphan requirements with no implementing task.

3. **Tasks → Requirements mapping**: Does every task reference at least one `[REQ-XX]`? Flag tasks with no requirement link — they may be out of scope or missing a tag.

4. **Requirement quality**: Are requirements atomic and verifiable? Flag compound requirements that should be split (e.g., "API supports auth AND rate limiting" → two requirements).

### Phase 4: Review Task Structure

Check tasks for feasibility and sizing:

1. **Task sizing** — Flag tasks that reference more than 3 files or have descriptions longer than a paragraph. These may need splitting.

2. **Missing file references** — Flag tasks with no `Files:` line. Every task should touch specific files.

3. **Dependency gaps** — Are tasks ordered logically? Does any task depend on work that isn't yet defined? Flag circular or missing dependencies.

4. **Specialist fit** — If specialist tags are present, do they make sense for the task content? Flag mismatches (e.g., a `[frontend]` tag on a database migration task).

5. **Completeness** — Given the requirements and decisions, is any implementation work obviously missing? For example, if there's a requirement for notifications but no task creates a notification system.

### Phase 5: Present Findings

Present your review as a structured summary. Be direct and specific — don't pad with "looks good" commentary for things that are fine.

```
## Plan Review: [Plan Title]

### Decisions
[Only if there are findings]
- [FINDING]: [specific issue and why it matters]
- [SUGGESTION]: [what to change]

### Requirements Coverage
[Only if there are findings]
- [GAP]: [scope item] has no corresponding requirement
- [ORPHAN]: [REQ-XX] has no implementing task
- [COMPOUND]: [REQ-XX] should be split into [REQ-XX] and [REQ-YY]

### Task Structure
[Only if there are findings]
- [OVERSIZED]: Task "[name]" touches N files — consider splitting
- [MISSING FILES]: Task "[name]" has no file references
- [MISSING WORK]: Requirement [REQ-XX] needs a task for [describe gap]

### Verdict
- **Issues found**: N (X critical, Y suggestions)
- **Requirements coverage**: N/M requirements have implementing tasks
- **Recommendation**: [Ready to proceed / Needs changes before proceeding]
```

If there are **zero findings**, say so clearly:

```
## Plan Review: [Plan Title]

No issues found. Decisions are concrete, requirements have full coverage, and tasks are well-structured.

Ready to proceed to bart-plan.
```

### Phase 6: User Checkpoint

After presenting findings, ask the user:

```
Would you like to change anything before I hand this off to bart-plan?
```

**If the user says no changes / looks good / proceed:**

Auto-invoke bart-plan to convert the plan into structured bart format:

```
Handing off to bart-plan for structuring...
```

Then invoke:
```
/bart-plan .bart/plans/<slug>/plan.md
```

**If the user requests changes:**

1. Apply the requested changes to plan.md using Edit
2. Re-run Phases 2-5 on the updated file
3. Present updated findings
4. Ask the checkpoint question again

Repeat until the user approves.

## Key Principles

1. **Be specific, not generic** — "REQ-03 has no implementing task" beats "some requirements may lack coverage"
2. **Critical findings only** — Don't flag style preferences or minor wording issues. Focus on gaps that would cause implementation problems
3. **Respect user decisions** — Don't second-guess locked decisions. Review them for concreteness, not correctness
4. **Fast path for clean plans** — If the plan is solid, say so in 2 lines and move on. Don't manufacture findings
5. **One review cycle is normal** — Most plans need 0-1 rounds of changes. If you're finding 10+ issues, the problem is likely in the thinking phase, not here
6. **Auto-chain is mandatory** — After user approval, always invoke bart-plan. Never end the skill without handing off
7. **No tools during review** — Phases 1-5 are analysis only. Only use Edit if the user explicitly requests changes in Phase 6
