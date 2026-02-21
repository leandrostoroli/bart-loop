# Bart Loop Plan Parser Skill

## Purpose

Parse a project plan.md file and generate a tasks.json file for bart-loop to execute.

## When to Use

Use this skill when:
- User asks to create tasks from a plan.md
- User wants to break down a project into executable tasks
- User wants to initialize bart-loop with automatic task generation
- Converting a project plan into parallel workstreams

## How It Works

### Step 1: Analyze the Plan

Read the plan.md file and identify:
1. **Major sections/headings** - These become task groups
2. **Subsections** - These become individual tasks
3. **Explicit dependencies** - Any task that mentions "depends on", "requires", "after"
4. **File references** - Any files mentioned in each section

### Step 2: Assign Workstreams

Distribute tasks into workstreams for parallel execution:

**Workstream Strategy:**
- **A** - Core/Foundation tasks (setup, config, core functionality)
- **B** - Feature development (can run after A)
- **C** - Testing/Integration (depends on B)
- **D** - Polish/Deployment (final tasks)

**Rules:**
1. Independent setup tasks → Workstream A
2. Feature tasks that depend on A → Workstream B
3. Tasks depending on B → Workstream C
4. Final tasks (docs, deployment) → Workstream D

**Max 3-4 tasks per workstream** for manageable parallel execution.

### Step 3: Determine Dependencies

For each task, identify what it depends on:
- Explicit mentions ("depends on X", "requires Y")
- Implicit ordering (A must come before B)
- File-level dependencies (editing same files)

### Step 4: Generate tasks.json

Create a JSON file with this structure:

```json
{
  "project": "<project-name>",
  "plan_file": "./plan.md",
  "project_root": "./",
  "tasks": [
    {
      "id": "<WORKSTREAM><NUM>",
      "workstream": "<A|B|C|D>",
      "title": "<concise title>",
      "description": "<detailed description>",
      "files": ["<file1>", "<file2>"],
      "depends_on": ["<task-id>"],
      "status": "pending",
      "requirements": ["<REQ-ID>"],
      "specialist": "<matched-specialist-name>",
      "files_modified": [],
      "started_at": null,
      "completed_at": null,
      "error": null
    }
  ]
}
```

## Example

**Input plan.md:**
```markdown
# Project Plan

## 1. Setup
- Initialize Node.js project
- Set up TypeScript
- Configure ESLint

## 2. Core Features
- Implement authentication
- Build user API
- Create database schema

## 3. Frontend
- Build React components
- Add state management
- Style with CSS

## 4. Testing
- Write unit tests
- Integration tests

## 5. Deploy
- Docker setup
- CI/CD pipeline
```

**Output tasks.json:**
```json
{
  "project": "my-project",
  "plan_file": "./plan.md",
  "project_root": "./",
  "tasks": [
    {
      "id": "A1",
      "workstream": "A",
      "title": "Initialize Node.js project",
      "description": "Initialize Node.js project with package.json, install dependencies",
      "files": ["package.json"],
      "depends_on": [],
      "status": "pending"
    },
    {
      "id": "A2", 
      "workstream": "A",
      "title": "Set up TypeScript",
      "description": "Configure TypeScript with tsconfig.json",
      "files": ["tsconfig.json"],
      "depends_on": ["A1"],
      "status": "pending"
    },
    {
      "id": "A3",
      "workstream": "A", 
      "title": "Configure ESLint",
      "description": "Set up ESLint for code linting",
      "files": [".eslintrc.json"],
      "depends_on": ["A2"],
      "status": "pending"
    },
    {
      "id": "B1",
      "workstream": "B",
      "title": "Implement authentication",
      "description": "Build authentication system with JWT",
      "files": ["src/auth/", "src/middleware/auth.ts"],
      "depends_on": ["A3"],
      "status": "pending"
    },
    {
      "id": "B2",
      "workstream": "B",
      "title": "Build user API",
      "description": "Create REST API for user management",
      "files": ["src/api/users.ts"],
      "depends_on": ["B1"],
      "status": "pending"
    },
    {
      "id": "B3",
      "workstream": "B", 
      "title": "Create database schema",
      "description": "Design and implement database models",
      "files": ["src/models/", "src/db/"],
      "depends_on": ["B1"],
      "status": "pending"
    },
    {
      "id": "C1",
      "workstream": "C",
      "title": "Build React components",
      "description": "Create core UI components",
      "files": ["src/components/"],
      "depends_on": ["B2", "B3"],
      "status": "pending"
    },
    {
      "id": "C2",
      "workstream": "C",
      "title": "Write unit tests",
      "description": "Write Jest tests for core functionality",
      "files": ["src/**/*.test.ts"],
      "depends_on": ["B2", "B3"],
      "status": "pending"
    },
    {
      "id": "D1",
      "workstream": "D",
      "title": "Docker setup",
      "description": "Configure Docker for containerization",
      "files": ["Dockerfile", "docker-compose.yml"],
      "depends_on": ["C1", "C2"],
      "status": "pending"
    }
  ]
}
```

## Optional: Requirements Section

Plans CAN include a `## Requirements` section with explicit requirement IDs:

```markdown
## Requirements
- [REQ-01] User can log in with email/password
- [REQ-02] Dashboard shows real-time metrics
- [REQ-03] API returns paginated results
```

Tasks can reference requirements with `[REQ-XX]` markers in their description or heading. If no `## Requirements` section exists, requirement groups are auto-generated from `##` section headings.

## Optional: Specialist Tags

Tasks can be explicitly assigned to a specialist by adding a tag in the heading:

```markdown
### [frontend-dev] Build login form
### [database] Create migration schema
```

Specialists are discovered automatically from the Claude Code ecosystem:
1. `./.claude/commands/` — project-local commands
2. `./.claude/agents/` — project-local agents
3. `~/.claude/commands/` — global commands
4. `~/.claude/agents/` — global agents
5. `~/.claude/plugins/*/skills/*/SKILL.md` — plugin skills
6. `~/.claude/skills/` — standalone skill files

If no explicit tag is provided, tasks are auto-matched to specialists based on file extension heuristics and keyword matching.

## Key Principles

1. **Parallelize where possible**: Group independent tasks in different workstreams
2. **Minimize dependencies**: Only add dependencies when truly necessary
3. **Logical ordering**: Within each workstream, order tasks logically
4. **File affinity**: Group tasks that modify the same files
5. **Balanced workload**: Distribute tasks roughly evenly across workstreams

## Usage

```bash
# Generate tasks from plan.md
bart plan

# With custom plan file
bart plan --plan my-plan.md

# With custom workstreams
bart plan --workstreams A,B,C,D
```

## AI-Assisted Plan Conversion

The **bart-plan** skill (`skills/bart-plan/SKILL.md`) is a **converter, not a planner**. It takes a plan you've already created (via Claude's `/plan`, plan mode, conversation, or an external document) and restructures it into bart-compatible format with:
- Explicit `## Requirements` section with `[REQ-XX]` IDs for coverage tracking
- Workstream-aware `##` section organization for parallel execution
- `[specialist-name]` tags on `###` tasks for specialist routing
- File references for each task

It auto-triggers before plan implementation when a `.bart/` directory exists, converting freeform plans into structured `plan.md` files that parse into high-quality tracked tasks via `bart plan`.

## Guided Thinking

The **bart-think** skill (`skills/bart-think/SKILL.md`) guides structured problem exploration before planning. Unlike bart-plan (which converts existing plans), bart-think helps users **discover what to build** through conversation:

1. **Open-ended discovery** — Understand the problem through reactive questioning
2. **Gray area identification** — Surface domain-specific ambiguities
3. **Deep-dive decisions** — Resolve each ambiguity with concrete choices (locked/discretionary/deferred)
4. **Scope guardrail** — Confirm scope and push back on creep
5. **Write outputs** — Produces `.bart/CONTEXT.md` (decisions) + a bart-format `plan.md` directly (no conversion step)

```bash
bart think               # Start open-ended thinking session
bart think "add auth"    # Start thinking about a specific topic
```

## Integration with AI Agents

This skill works with:
- **OpenCode**: Use `/bart` command
- **Claude Code**: Use the skill with `@bart`
- **Gemini**: Use with the bart skill loaded

The AI should invoke this skill when the user wants to convert a plan into executable tasks.
