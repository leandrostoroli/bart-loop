---
name: bart-new-specialist
description: |
  Use when the user wants to create a new specialist profile for bart. Invoke when the user
  says "create a specialist", "new specialist", "add a specialist profile", "I need a specialist
  for", "make me a specialist", or runs /bart-new-specialist. This skill guides users through
  a multi-step conversation to define a specialist profile with role, skills, premises, and
  placement — then writes the profile markdown file.
version: 1.0.0
---

# Bart New Specialist — Guided Profile Creation

You guide users through creating a specialist profile for bart-loop. A specialist profile is a markdown file with YAML frontmatter that tells bart how to route tasks to the right context — what role the specialist plays, what skills and standards it follows, and what guidelines (premises) shape its behavior.

## Input

**Topic**: $ARGUMENTS

If a specialist name or domain is provided, use it as starting context. Otherwise, begin with open-ended discovery.

## Profile Format Reference

The profile you will create follows this structure, parsed by `parseProfile()` in the bart codebase:

```markdown
---
name: specialist-name
description: One-line summary of what this specialist does
role: e.g. "backend engineer", "QA lead", "frontend developer"
skills:
  - skill-name-1
  - skill-name-2
agents:
  - agent-name-1
standards:
  - standard-name-1
---

## Premises

Guidelines, rules, and standards this specialist follows when executing tasks.
Written in imperative voice. These are injected into the task prompt.

## Learnings

<!-- Auto-appended by bart after task completion — do not write manually -->
```

**Key fields:**
- `name`: Kebab-case identifier (used as `[specialist-name]` tag in plans)
- `description`: First line is used as the specialist's display description
- `role`: Free-text role label used in profile-aware matching
- `skills`: Names of other specialists (type: skill) whose content gets resolved and injected
- `agents`: Names of other specialists (type: agent) whose content gets resolved and injected
- `standards`: Names of other specialists (type: standard) referenced for context
- `## Premises`: The body of specialist knowledge — guidelines, patterns, rules
- `## Learnings`: Empty on creation; bart auto-appends entries after task completion

## Workflow

### Phase 1: Understand the Domain

Start by understanding what kind of work this specialist will handle.

- If topic provided: "You want a specialist for [topic]. What kind of tasks will it handle — and what makes those tasks different from general coding?"
- If no topic: "What kind of work do you need a specialist for? Describe the domain and the types of tasks it would handle."

**React to their answer.** Ask follow-up questions that demonstrate you understood their specific domain. Typical areas to probe:

- What technologies, frameworks, or tools are involved?
- What patterns or conventions should this specialist follow?
- What mistakes does a non-specialist commonly make in this domain?
- Are there existing codebases, files, or directories this specialist will primarily work in?

2-3 rounds of back-and-forth is typical before moving to Phase 2.

### Phase 2: Define Identity

Based on the conversation, propose the specialist's identity fields:

```
Based on what you've described, here's the specialist identity:

Name: [kebab-case-name]
Role: [role label]
Description: [one-line summary]

Does this look right? Want to adjust the name or role?
```

Wait for confirmation before proceeding.

### Phase 3: Discover & Assign References

Before proceeding, check what skills, agents, and standards are already available:

```bash
bart specialists --history 2>/dev/null || echo "No specialists found"
```

Also check for skills in the standard locations:

```bash
ls ~/.claude/skills/ 2>/dev/null || echo "No global skills"
ls .claude/skills/ 2>/dev/null || echo "No project skills"
```

Present relevant matches to the user:

```
Available skills/agents that could be referenced:

  Name                  | Type    | Relevance
  ----------------------|---------|----------
  bart-think            | skill   | Low — planning, not [domain]
  backend-developer     | agent   | High — same domain
  test-runner           | command | Medium — could pair for validation

Which of these should this specialist reference?
- Skills (injected as context): [propose relevant ones]
- Agents (injected as context): [propose relevant ones]

You can also name skills/agents that don't exist yet — the profile will reference them
and bart will warn until they're created.
```

If any referenced skill or agent name is not found in the discovered specialists list, warn the user:
- "Warning: skill `[name]` was not found in discovered specialists. It will be a forward reference — bart will warn at runtime until the skill is created. Continue anyway?"

Wait for the user to confirm or adjust references.

### Phase 4: Author Premises

This is the most important phase. Premises define how the specialist behaves — they are injected directly into the task prompt.

**Do NOT ask generic prompting questions.** Instead, ask role-specific questions based on what you learned in Phase 1:

For a **backend engineer** specialist, ask about:
- API design conventions (REST vs GraphQL, naming patterns, error response format)
- Database patterns (ORM usage, migration strategy, query optimization rules)
- Error handling strategy (custom error classes, logging conventions)
- Testing expectations (unit vs integration, mocking strategy, coverage targets)

For a **frontend developer** specialist, ask about:
- Component patterns (composition vs inheritance, state management approach)
- Styling conventions (CSS modules, Tailwind, styled-components)
- Accessibility requirements (WCAG level, ARIA patterns)
- Performance constraints (bundle size limits, rendering targets)

For a **QA/test** specialist, ask about:
- Test organization (file structure, naming conventions)
- Coverage strategy (what must be tested, what can be skipped)
- Test data management (fixtures, factories, mocking boundaries)
- CI integration (when tests run, failure handling)

For a **design engineering** specialist, ask about:
- Design system and component library conventions
- Responsive design breakpoints and approach
- Animation and interaction patterns
- Design token usage and theming

For any specialist, always ask:
- "What are the top 3-5 rules this specialist must always follow?"
- "What's a common mistake in this domain that the specialist should explicitly avoid?"

After gathering answers, draft the premises section and present it:

```
Here are the proposed premises for [name]:

## Premises

[Drafted premises text — imperative voice, specific to domain]

Want to adjust, add, or remove anything?
```

Iterate until the user is satisfied. Premises should be:
- Written in imperative voice ("Use X", "Never Y", "Always Z")
- Specific to the domain (not generic advice like "write clean code")
- Actionable by an AI agent (not aspirational goals)
- Concise — aim for 10-30 lines

### Phase 5: Choose Placement

Ask the user where to save the profile:

```
Where should this specialist live?

1. Project-local: .bart/specialists/[name].md
   → Only available in this project. Takes priority over global profiles with the same name.

2. Global: ~/.bart/specialists/[name].md
   → Available across all projects that use bart.

Which do you prefer?
```

If the user is unsure, recommend:
- **Project-local** if the specialist is specific to this codebase's conventions
- **Global** if the specialist represents general domain expertise

### Phase 6: Write Profile

Compose and write the profile file to the chosen location.

Create the target directory if it doesn't exist:
```bash
mkdir -p [chosen-directory]
```

Then write the profile file with this structure:

```markdown
---
name: [name]
description: [description]
role: [role]
skills:
  - [skill-1]
  - [skill-2]
agents:
  - [agent-1]
---

## Premises

[Premises text from Phase 4]

## Learnings
```

**Important:** The `## Learnings` section must be present but empty. Bart auto-appends structured entries here after task completion. Never pre-populate it.

After writing, verify the profile is discoverable:

```bash
bart specialists 2>/dev/null | grep -i "[name]" || echo "Profile not yet discovered — run bart specialists to verify after install"
```

### Phase 7: Test & Confirm

Offer to verify the specialist works by running a sample match:

```
Profile written to [path].

Want to test it? Give me a sample task description and I'll check if bart would match
this specialist to it.
```

If the user provides a sample task:

```bash
bart suggest "[sample task description]" 2>/dev/null || echo "bart suggest not available — verify manually with bart specialists"
```

Show results and discuss whether the scoring looks right.

Then output the completion summary:

```
Specialist created: [name]
  Role: [role]
  Location: [path]
  Skills: [list or "none"]
  Agents: [list or "none"]
  Premises: [line count] lines

The specialist will be discovered automatically by bart on next run.
To see all specialists: bart specialists
To see matching: bart suggest "your task description"
```

## Key Principles

1. **Role-driven, not generic** — Questions in Phase 4 should be specific to the specialist's domain, not reusable prompting templates
2. **React, don't interrogate** — Each question builds on the user's previous answer
3. **Premises are the product** — The premises section is what actually shapes task execution; spend most effort here
4. **Validate references** — Warn about unresolvable skill/agent names before writing
5. **Respect the parser** — The profile must match what `parseProfile()` expects: YAML frontmatter with known fields, `## Premises` heading, `## Learnings` heading
6. **Start empty learnings** — Never pre-populate the Learnings section; bart appends to it automatically after task completion
7. **Test before done** — Always offer `bart suggest` verification so the user sees how the specialist will score
8. **Respect existing ecosystem** — Check for duplicates and leverage existing skills/agents rather than reinventing
