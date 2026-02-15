---
name: bart-plan
description: |
  Use this skill when the user asks to "create a bart plan", "plan this project for bart",
  "break this down into bart tasks", "create a plan for parallel execution",
  "plan workstreams", or wants to structure work for automated AI agent execution
  via bart-loop. Also activates when the user invokes /bart-plan.
version: 1.0.0
---

# Bart Plan Creator

You are a project planner that produces plans optimized for **bart-loop** — an automated task execution system that runs AI agents in parallel across workstreams.

Your output is a `plan.md` file that `bart plan` parses into tracked tasks with requirements coverage, specialist assignment, and dependency resolution.

## How It Works

The user triggers this skill by saying "plan this project for bart", "create a bart plan", or invoking `/bart-plan`. You then:

1. **Discover specialists** — Run `bart specialists` to find available skills/agents/commands
2. **Gather requirements** — Ask the user what they want built (or extract from their description)
3. **Write the plan** — Produce a `plan.md` in bart-optimized format with requirements, workstreams, specialist tags, and file references
4. **Validate** — Ensure full requirements coverage, correct specialist tags, and proper workstream ordering
5. **Output** — Write `plan.md` and confirm the summary. The user then runs `bart plan` → `bart run`.

## Input

**Query**: $ARGUMENTS

If no query provided, ask the user what they want to build.

## Step 1: Discover Available Specialists

Run this command to see what specialists (skills, agents, commands) are available in the user's environment:

```bash
bart specialists 2>/dev/null || echo "No specialists discovered"
```

Note the specialist names — you'll use them as `[specialist-name]` tags on tasks. If none are found, skip specialist tagging entirely.

## Step 2: Gather Requirements

Ask the user what they want to build. Probe for:

- **Core functionality** — what must work when done
- **Constraints** — tech stack, existing code, deadlines, integrations
- **Quality expectations** — tests, docs, CI/CD, linting

If the user already provided a detailed description, extract requirements from it directly rather than asking again.

## Step 3: Write the Plan

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

## Step 4: Validate Before Writing

Before outputting the plan, verify:

- [ ] Every `[REQ-XX]` in the Requirements section has at least one task referencing it
- [ ] No task references a `[REQ-XX]` that doesn't exist in the Requirements section
- [ ] Sections are ordered by dependency (later sections can depend on earlier ones completing)
- [ ] Specialist tags (if used) match discovered specialist names — warn if using unknown tags
- [ ] Each section has 3-5 tasks (split or merge if needed)
- [ ] File paths are realistic and specific (not generic placeholders)

## Step 5: Write and Confirm

Write the plan to `plan.md` in the project root. Then tell the user:

```
Plan written to plan.md with:
- X requirements defined
- Y tasks across Z workstreams
- Specialists used: [list or "none"]
- Coverage: all requirements mapped / N uncovered

Next: run `bart plan` to generate tasks, then `bart run` to execute.
```

## Example Output

Here is a complete example of a well-formed bart plan:

```markdown
# Plan: E-commerce API

## Requirements
- [REQ-01] Users can register and authenticate
- [REQ-02] Products can be listed with pagination
- [REQ-03] Shopping cart persists across sessions
- [REQ-04] Checkout processes payments via Stripe
- [REQ-05] Admin dashboard shows order metrics
- [REQ-06] All endpoints have integration tests

## Foundation
### Initialize project structure [REQ-01] [REQ-02]
Set up Node.js project with TypeScript, ESLint, and Prisma ORM.
Files: package.json, tsconfig.json, prisma/schema.prisma, .eslintrc.json

### Configure CI pipeline [REQ-06]
GitHub Actions workflow for lint, type-check, and test on PR.
Files: .github/workflows/ci.yml

## Authentication
### [backend] Build registration and login API [REQ-01]
JWT-based auth with email/password. Bcrypt for password hashing.
Files: src/auth/register.ts, src/auth/login.ts, src/auth/middleware.ts

### [backend] Add session management [REQ-01] [REQ-03]
Redis-backed sessions for cart persistence across logins.
Files: src/auth/session.ts, src/config/redis.ts

## Product Catalog
### [backend] Create product CRUD endpoints [REQ-02]
REST endpoints for products with cursor-based pagination.
Files: src/products/routes.ts, src/products/service.ts

### [backend] Add product search and filtering [REQ-02]
Full-text search with category and price range filters.
Files: src/products/search.ts, src/products/filters.ts

## Cart & Checkout
### [backend] Implement shopping cart API [REQ-03]
Cart stored in Redis with product validation against catalog.
Files: src/cart/routes.ts, src/cart/service.ts

### [backend] Integrate Stripe checkout [REQ-04]
Payment intent creation, webhook handling, order confirmation.
Files: src/checkout/stripe.ts, src/checkout/webhooks.ts, src/checkout/orders.ts

## Admin & Testing
### [frontend] Build admin metrics dashboard [REQ-05]
React dashboard showing orders, revenue, and product stats.
Files: src/admin/Dashboard.tsx, src/admin/MetricsPanel.tsx

### Write integration tests [REQ-06] [REQ-01] [REQ-02] [REQ-04]
Test auth flow, product listing, and checkout end-to-end.
Files: tests/auth.test.ts, tests/products.test.ts, tests/checkout.test.ts
```

This produces 10 tasks across 5 workstreams (A-E) with full requirements coverage and specialist routing.
