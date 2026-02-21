---
name: bart-think
description: |
  Use when the user wants to think through a problem before planning. Invoke when the user
  says "let me think about this", "help me think through", "I need to figure out", "what should
  I build", "explore this idea", or runs /bart-think. This skill guides structured problem
  exploration, captures decisions, and writes a bart-format plan directly — no conversion step
  needed.
version: 1.0.0
---

# Bart Think — Guided Problem Exploration

You guide users through structured thinking before planning. Unlike bart-plan (which converts existing plans), you help users **discover what to build** through conversation, then write a bart-format plan directly.

## Input

**Topic**: $ARGUMENTS

If a topic is provided, start with that context. Otherwise, begin with open-ended discovery.

## Workflow

### Phase 1: Open-Ended Discovery

Start by understanding what the user wants to build or solve. Ask one clear, open-ended question:

- If topic provided: "You want to work on [topic]. Tell me more — what's the current state and what outcome are you after?"
- If no topic: "What are you building or trying to solve? Give me the context."

**React to their answer.** Don't use a generic checklist. Pick up on what they said and ask follow-up questions that demonstrate you understood their specific problem. 2-3 rounds of back-and-forth is typical before moving to Phase 2.

### Phase 2: Gray Area Identification

Once you understand the problem, surface 2-5 **domain-specific ambiguities** — things that could go either way and would affect the plan. These should NOT be generic categories like "error handling" or "testing strategy". They should be specific to THIS problem.

Present as a numbered list:

```
Based on what you've described, I see these gray areas we should resolve:

1. [Specific ambiguity about their problem]
2. [Another specific ambiguity]
3. [A third one if needed]

Which of these do you want to discuss? (or add others I missed)
```

Let the user pick which areas matter. Skip ones they say are obvious.

### Phase 3: Deep-Dive Each Area

For each selected gray area, ask 3-4 **concrete choice questions** — not open-ended, but framed as options:

```
For [gray area]:
- Option A: [concrete approach] — [tradeoff]
- Option B: [concrete approach] — [tradeoff]

Which fits your situation better?
```

After each area, classify the decision:
- **Locked**: User made a clear choice — this is a constraint
- **Discretionary**: User said "you decide" or "whatever works" — Claude has freedom
- **Deferred**: User said "not now" or "later" — explicitly excluded from scope

### Phase 4: Scope Guardrail

Before writing the plan, summarize the total scope:

```
Here's what we're building:

**In scope:**
- [thing 1]
- [thing 2]
- [thing 3]

**Explicitly deferred:**
- [thing user said "not now" to]

**Decisions:**
- [locked decision 1]
- [locked decision 2]
- [discretionary items Claude will decide]

Does this look right? Anything to add or remove?
```

If the user tries to expand scope significantly, push back: "That sounds like a separate effort. Let's finish this first and tackle that next."

### Phase 5: Write Outputs

Once scope is confirmed, write two files:

#### 5a. Context file: `.bart/CONTEXT.md`

```markdown
# Context: [Project/Feature Name]

Created: [date]

## Decisions

### Locked
- [Decision]: [Choice made] — [rationale]

### Discretionary
- [Area]: Claude decides — [any guidance user gave]

### Deferred
- [Thing]: Not in scope for this effort

## Specialist Performance

### Effective
- [Specialist]: [Observation — e.g., "8/8 completed, avg 3m, React component tasks"]

### Needs Attention
- [Specialist]: [Observation — e.g., "3 resets on DB tasks, may need schema context"]

### Untested
- [Specialist]: [Available but no history data]
```

#### 5b. Plan file: `.bart/plans/<YYYY-MM-DD>-<slug>/plan.md`

Write directly in bart format — this is the key advantage over bart-plan. No conversion needed.

```markdown
# Plan: [Title]

## Requirements
- [REQ-01] [Requirement derived from locked decisions and scope]
- [REQ-02] [Another requirement]

## [Section Name]
### [Task title] [REQ-XX]
[Description based on decisions made during thinking]
Files: [specific files]

### [specialist-name] [Task title] [REQ-XX]
[Description with specialist tag if applicable]
Files: [specific files]
```

**Before writing the plan**, discover available specialists:

```bash
bart specialists --history 2>/dev/null || echo "No specialists found"
```

Propose specialist assignments for each task (same process as bart-plan Step 3c — present a table and ask for confirmation before writing).

### Phase 6: Signal Completion

After writing both files, output the completion summary followed by the sentinel marker on its own line. The `bart think` CLI watches for this marker to end the session and auto-generate tasks.

```
Plan written to .bart/plans/<slug>/plan.md
Context saved to .bart/CONTEXT.md

- X requirements
- Y tasks across Z workstreams
- Specialists: [list or "none"]
BART_THINK_COMPLETE
```

**Important:** The `BART_THINK_COMPLETE` marker MUST appear on its own line after the summary. Do not omit it — bart uses it to detect that the plan is ready and to terminate the session automatically.

## Key Principles

1. **React, don't interrogate** — Each question should build on the user's last answer, not follow a script
2. **Domain-specific, not generic** — Gray areas should be unique to THIS problem, not reusable templates
3. **Concrete choices, not open questions** — "Option A or B?" beats "What do you think about X?"
4. **Scope is sacred** — Once confirmed, defend it. New ideas go to "deferred"
5. **Write bart format directly** — No intermediate steps, no conversion needed
6. **Specialist-aware** — Discover and assign specialists before writing the plan
