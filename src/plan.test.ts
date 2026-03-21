import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { parsePlanToTasks, extractTaskContentBlocks, writeTaskMarkdownFiles, runPlanCommand } from "./plan.js";

// =============================================================================
// parsePlanToTasks — ## Testing metadata parsing
// =============================================================================

describe("parsePlanToTasks — testing metadata", () => {
  const cwd = "/tmp/test-project";

  test("parses ## Testing section with all fields", () => {
    const plan = `# Plan

## Requirements
- [REQ-01] Support testing metadata

## Testing
Test command: npm test
Framework: vitest
Conventions: tests live in __tests__/ directories, named *.test.ts

## Core
### Implement feature [REQ-01]
Add the feature.
Files: src/feature.ts
`;
    const { testing } = parsePlanToTasks(plan, cwd);
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("npm test");
    expect(testing!.framework).toBe("vitest");
    expect(testing!.conventions).toBe("tests live in __tests__/ directories, named *.test.ts");
  });

  test("parses ## Testing with only test command", () => {
    const plan = `# Plan

## Testing
Test command: bun test

## Work
### Do something
Implement it.
`;
    const { testing } = parsePlanToTasks(plan, cwd);
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("bun test");
    expect(testing!.framework).toBeUndefined();
    expect(testing!.conventions).toBeUndefined();
  });

  test("returns null when no ## Testing section exists", () => {
    const plan = `# Plan

## Requirements
- [REQ-01] Some requirement

## Core
### Task one [REQ-01]
Do something.
`;
    const { testing } = parsePlanToTasks(plan, cwd);
    expect(testing).toBeNull();
  });

  test("## Testing section is not treated as a workstream", () => {
    const plan = `# Plan

## Testing
Test command: pytest
Framework: pytest

## Backend
### Build API
Create endpoints.

### Build models
Create models.
`;
    const { tasks, testing } = parsePlanToTasks(plan, cwd);
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("pytest");
    // Tasks should come from Backend, not Testing
    expect(tasks.length).toBe(2);
    expect(tasks[0].title).toBe("Build API");
    expect(tasks[1].title).toBe("Build models");
  });

  test("## Testing is not auto-generated as a requirement in auto-extract mode", () => {
    const plan = `# Plan

## Testing
Test command: go test ./...

## Setup
### Initialize project
Create the project structure.

## Features
### Build feature
Build the main feature.
`;
    const { requirements, testing } = parsePlanToTasks(plan, cwd);
    expect(testing).not.toBeNull();
    // Requirements should be auto-generated from Setup and Features, not Testing
    const reqIds = requirements.map(r => r.id);
    expect(reqIds).not.toContain("REQ-TESTING");
    expect(reqIds).toContain("REQ-SETUP");
    expect(reqIds).toContain("REQ-FEATURES");
  });

  test("case-insensitive matching for ## Testing heading", () => {
    const plan = `# Plan

## testing
Test command: cargo test
Framework: cargo

## Work
### Task one
Do it.
`;
    const { testing } = parsePlanToTasks(plan, cwd);
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("cargo test");
  });

  test("case-insensitive matching for field labels", () => {
    const plan = `# Plan

## Testing
test command: npm run test
framework: Jest
conventions: co-located with source files

## Work
### Task one
Do it.
`;
    const { testing } = parsePlanToTasks(plan, cwd);
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("npm run test");
    expect(testing!.framework).toBe("Jest");
    expect(testing!.conventions).toBe("co-located with source files");
  });

  test("## Testing between ## Requirements and workstreams", () => {
    const plan = `# Plan

## Requirements
- [REQ-01] Parser supports testing metadata
- [REQ-02] Tasks are generated correctly

## Testing
Test command: npm test
Framework: vitest

## Core Changes
### Update parser [REQ-01]
Modify the parser.
Files: src/plan.ts

### Add tests [REQ-02]
Write test coverage.
Files: src/plan.test.ts
`;
    const { tasks, requirements, testing } = parsePlanToTasks(plan, cwd);
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("npm test");
    expect(requirements.length).toBe(2);
    expect(tasks.length).toBe(2);
    expect(tasks[0].requirements).toContain("REQ-01");
    expect(tasks[1].requirements).toContain("REQ-02");
  });

  test("ignores unrecognized lines in ## Testing section", () => {
    const plan = `# Plan

## Testing
Test command: npm test
Some random note that should be ignored
Framework: jest
Another random line

## Work
### Task one
Do it.
`;
    const { testing } = parsePlanToTasks(plan, cwd);
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("npm test");
    expect(testing!.framework).toBe("jest");
    expect(testing!.conventions).toBeUndefined();
  });
});

// =============================================================================
// parsePlanToTasks — TDD-structured task format [REQ-01] [REQ-02]
// =============================================================================

describe("parsePlanToTasks — TDD-structured tasks", () => {
  const cwd = "/tmp/test-project";

  test("extracts file paths from TDD blocks within 10-line scan window", () => {
    // The parser scans 10 lines from the ### heading for file references.
    // For TDD-structured tasks, file paths in the Test first block (within 10 lines)
    // are captured; the Files: line further down may be beyond the scan window.
    const plan = `# Plan

## Work
### Build API endpoint
Create the endpoint.
**Test first:**
- Create \`tests/api/endpoint.test.ts\`
- Test: endpoint returns 200
**Implementation:**
- Modify \`src/api/endpoint.ts\`
Files: src/api/endpoint.ts, tests/api/endpoint.test.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(1);
    const files = tasks[0].files;
    // Both files are within the 10-line window from ###
    expect(files).toContain("tests/api/endpoint.test.ts");
    expect(files).toContain("src/api/endpoint.ts");
  });

  test("parses multiple TDD-structured tasks in same workstream", () => {
    const plan = `# Plan

## Requirements
- [REQ-01] Parser works
- [REQ-02] CLI works

## Testing
Test command: bun test
Framework: vitest

## Core Changes
### Update parser [REQ-01]
Modify the parser.
**Test first:**
- Create \`src/plan.test.ts\`
**Implementation:**
- Modify \`src/plan.ts\`
Files: src/plan.ts, src/plan.test.ts

### Update CLI [REQ-02]
Add TDD enforcement.
**Test first:**
- Create \`src/cli.test.ts\`
**Implementation:**
- Modify \`src/cli.ts\`
Files: src/cli.ts, src/cli.test.ts
`;
    const { tasks, requirements, testing } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(2);
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("bun test");

    // Title includes [REQ-XX] markers (parser does not strip them)
    expect(tasks[0].title).toBe("Update parser [REQ-01]");
    expect(tasks[0].requirements).toContain("REQ-01");
    expect(tasks[0].files).toContain("src/plan.ts");
    expect(tasks[0].files).toContain("src/plan.test.ts");

    expect(tasks[1].title).toBe("Update CLI [REQ-02]");
    expect(tasks[1].requirements).toContain("REQ-02");
    expect(tasks[1].files).toContain("src/cli.ts");
    expect(tasks[1].files).toContain("src/cli.test.ts");

    // Requirements coverage — both tasks are in workstream A (## Core Changes)
    // since metadata sections (Requirements, Testing) are skipped
    const task0Id = tasks[0].id;
    const task1Id = tasks[1].id;
    expect(requirements[0].covered_by).toContain(task0Id);
    expect(requirements[1].covered_by).toContain(task1Id);
  });

  test("metadata sections (Requirements, Testing) do not affect workstream lettering", () => {
    const plan = `# Plan

## Requirements
- [REQ-01] API works

## Testing
Test command: npm test

## Backend
### Build API [REQ-01]
Create REST endpoints.
Files: src/api.ts, tests/api.test.ts

## Frontend
### Build dashboard
Create the UI.
Files: src/Dashboard.tsx
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(2);

    // Metadata sections should NOT affect workstream lettering.
    // Backend = workstream A, Frontend = workstream B.
    expect(tasks[0].workstream).toBe("A");
    expect(tasks[1].workstream).toBe("B");
  });

  test("testing metadata coexists with TDD-structured tasks", () => {
    const plan = `# Plan

## Requirements
- [REQ-01] API returns correct data
- [REQ-02] Tests pass

## Testing
Test command: pytest
Framework: pytest
Conventions: tests in tests/ directory, named test_*.py

## API
### Build endpoint [REQ-01] [REQ-02]
Create the API endpoint.
**Test first:**
- Create \`tests/test_endpoint.py\`
**Implementation:**
- Modify \`src/endpoint.py\`
Files: src/endpoint.py, tests/test_endpoint.py
`;
    const { tasks, requirements, testing } = parsePlanToTasks(plan, cwd);

    // Testing metadata
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("pytest");
    expect(testing!.framework).toBe("pytest");
    expect(testing!.conventions).toBe("tests in tests/ directory, named test_*.py");

    // Task has both requirements
    expect(tasks[0].requirements).toContain("REQ-01");
    expect(tasks[0].requirements).toContain("REQ-02");

    // Both requirements are covered by the task
    const taskId = tasks[0].id;
    expect(requirements[0].covered_by).toContain(taskId);
    expect(requirements[1].covered_by).toContain(taskId);

    // Files include both source and test file
    expect(tasks[0].files).toContain("src/endpoint.py");
    expect(tasks[0].files).toContain("tests/test_endpoint.py");
  });

  test("full TDD plan with Requirements + Testing + workstreams", () => {
    // Validates the complete format that bart-plan SKILL.md generates
    const plan = `# Plan: Fix Dashboard Performance

## Requirements
- [REQ-01] Dashboard loads in under 2 seconds
- [REQ-02] API calls are parallelized
- [REQ-03] Client-side caching prevents redundant fetches

## Testing
Test command: npm test
Framework: vitest
Conventions: tests in __tests__/ directories, named *.test.ts

## API & Caching
### Parallelize API calls [REQ-01] [REQ-02]
Refactor sequential API calls to use Promise.all.
**Test first:**
- Create \`__tests__/pages/Overview.test.tsx\`
**Implementation:**
- Modify \`src/pages/Overview.tsx\`
Files: src/pages/Overview.tsx, __tests__/pages/Overview.test.tsx

### Add caching layer [REQ-03]
Add React Query for data caching.
**Test first:**
- Create \`__tests__/providers/QueryProvider.test.tsx\`
**Implementation:**
- Modify \`src/providers/QueryProvider.tsx\`
Files: src/providers/QueryProvider.tsx, __tests__/providers/QueryProvider.test.tsx
`;
    const { tasks, requirements, testing } = parsePlanToTasks(plan, cwd);

    // Testing section parsed
    expect(testing).not.toBeNull();
    expect(testing!.test_command).toBe("npm test");
    expect(testing!.framework).toBe("vitest");
    expect(testing!.conventions).toBe("tests in __tests__/ directories, named *.test.ts");

    // Requirements parsed
    expect(requirements.length).toBe(3);

    // Tasks parsed
    expect(tasks.length).toBe(2);

    // Both tasks are in same workstream
    expect(tasks[0].workstream).toBe(tasks[1].workstream);

    // First task
    expect(tasks[0].title).toContain("Parallelize API calls");
    expect(tasks[0].requirements).toContain("REQ-01");
    expect(tasks[0].requirements).toContain("REQ-02");
    expect(tasks[0].files).toContain("src/pages/Overview.tsx");

    // Second task
    expect(tasks[1].title).toContain("Add caching layer");
    expect(tasks[1].requirements).toContain("REQ-03");
    expect(tasks[1].files).toContain("src/providers/QueryProvider.tsx");

    // Coverage
    const id0 = tasks[0].id;
    const id1 = tasks[1].id;
    expect(requirements[0].covered_by).toContain(id0);
    expect(requirements[1].covered_by).toContain(id0);
    expect(requirements[2].covered_by).toContain(id1);
  });

  test("task without TDD blocks still works (backward compatibility)", () => {
    const plan = `# Plan

## Testing
Test command: npm test

## Core
### Simple task
Just do this thing.
Files: src/thing.ts
`;
    const { tasks, testing } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(1);
    expect(tasks[0].title).toBe("Simple task");
    expect(tasks[0].files).toContain("src/thing.ts");
    expect(testing!.test_command).toBe("npm test");
  });

  test("TDD task file extraction captures test file paths from backtick references", () => {
    // Parser extracts file paths using regex from inline content within 10 lines
    const plan = `# Plan

## Work
### Add validation
Add input validation.
**Test first:**
- Create \`src/__tests__/validate.test.ts\`
- Test: validates input correctly
**Implementation:**
- Modify \`src/validate.ts\`
Files: src/validate.ts, src/__tests__/validate.test.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(1);
    // File references within 10-line scan window
    expect(tasks[0].files).toContain("src/__tests__/validate.test.ts");
    expect(tasks[0].files).toContain("src/validate.ts");
  });

  test("mixed TDD and non-TDD tasks in same workstream", () => {
    const plan = `# Plan

## Testing
Test command: bun test

## Setup
### Configure project
Set up the project config.
Files: tsconfig.json

### Add feature with tests
Build the main feature.
**Test first:**
- Create \`src/feature.test.ts\`
**Implementation:**
- Modify \`src/feature.ts\`
Files: src/feature.ts, src/feature.test.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(2);

    // Non-TDD task
    expect(tasks[0].title).toBe("Configure project");
    expect(tasks[0].files).toContain("tsconfig.json");

    // TDD task
    expect(tasks[1].title).toBe("Add feature with tests");
    expect(tasks[1].files).toContain("src/feature.ts");
    expect(tasks[1].files).toContain("src/feature.test.ts");
  });
});

// =============================================================================
// parsePlanToTasks — multi-workstream task parsing
// =============================================================================

describe("parsePlanToTasks — multi-workstream task parsing", () => {
  const cwd = "/tmp/test-project";

  test("parses tasks into separate workstreams with correct IDs", () => {
    const plan = `# Plan

## Requirements
- [REQ-01] Build the setup
- [REQ-02] Build the UI

## Setup
### Init project [REQ-01]
Initialize the project structure.
Files: package.json

### Configure lint [REQ-01]
Set up linting rules.
Files: .eslintrc.json

## Build UI
### Build UI
Create the interface.
Files: src/ui.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(3);
    expect(tasks[0].workstream).toBe("A");
    expect(tasks[0].id).toBe("A1");
    expect(tasks[1].workstream).toBe("A");
    expect(tasks[1].id).toBe("A2");
    expect(tasks[2].workstream).toBe("B");
    expect(tasks[2].id).toBe("B1");
  });
});

// =============================================================================
// parsePlanToTasks — metadata sections skipped for workstream assignment
// =============================================================================

describe("parsePlanToTasks — metadata sections skipped for workstream assignment", () => {
  const cwd = "/tmp/test-project";

  test("metadata sections (Decisions, Requirements) do not affect workstream lettering", () => {
    const plan = `# Plan

## Decisions
### Locked
- Use React for frontend

### Discretionary
- Team decides on state management

## Requirements
- [REQ-01] Build the setup
- [REQ-02] Build the UI

## Setup
### Init project [REQ-01]
Initialize the project structure.
Files: package.json

### Configure lint [REQ-01]
Set up linting rules.
Files: .eslintrc.json

## Build UI
### Build UI
Create the interface.
Files: src/ui.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(3);
    expect(tasks[0].workstream).toBe("A");
    expect(tasks[0].id).toBe("A1");
    expect(tasks[1].workstream).toBe("A");
    expect(tasks[1].id).toBe("A2");
    expect(tasks[2].workstream).toBe("B");
    expect(tasks[2].id).toBe("B1");
  });

  test("sequential sections get sequential workstream letters (A, B, C) [REQ-03]", () => {
    const plan = `# Plan

## Decisions
### Locked
- No backward compat needed
### Deferred
- Future work

## Requirements
- [REQ-01] Setup works
- [REQ-02] API works
- [REQ-03] UI works

## Testing
Test command: bun test
Framework: bun test
Conventions: *.test.ts

## Setup
### Initialize project [REQ-01]
Set up the project.
Files: src/setup.ts

## API
### Build endpoints [REQ-02]
Create REST API.
Files: src/api.ts

## UI
### Create dashboard [REQ-03]
Build the frontend.
Files: src/Dashboard.tsx
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(3);
    expect(tasks[0].workstream).toBe("A");
    expect(tasks[1].workstream).toBe("B");
    expect(tasks[2].workstream).toBe("C");
  });

  test("plan without metadata sections still assigns workstreams correctly [REQ-04]", () => {
    const plan = `# Plan

## Backend
### Build API
Create REST endpoints.
Files: src/api.ts

### Add auth
Add authentication.
Files: src/auth.ts

## Frontend
### Build UI
Create the interface.
Files: src/ui.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(3);
    expect(tasks[0].workstream).toBe("A");
    expect(tasks[0].id).toBe("A1");
    expect(tasks[1].workstream).toBe("A");
    expect(tasks[1].id).toBe("A2");
    expect(tasks[2].workstream).toBe("B");
    expect(tasks[2].id).toBe("B1");
  });
});

// =============================================================================
// parsePlanToTasks — code fences must not be parsed as headings
// =============================================================================

describe("parsePlanToTasks — code fences ignored", () => {
  const cwd = "/tmp/test-project";

  test("## and ### headings inside code fences are not parsed as workstreams or tasks", () => {
    const plan = `# Plan

## Requirements
- [REQ-01] Feature works

## Testing
Test command: bun test

## Fix Parser
### Skip metadata sections [REQ-01]
Modify the parser.

**Test first:**
\`\`\`typescript
test("metadata sections do not affect lettering", () => {
  const plan = \\\`# Plan

## Requirements
- [REQ-01] API works

## Backend
### Build API [REQ-01]
Create endpoints.

## Frontend
### Build dashboard
Create the UI.
\\\`;
  const { tasks } = parsePlanToTasks(plan, cwd);
  expect(tasks.length).toBe(2);
});
\`\`\`

Files: src/plan.ts, src/plan.test.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    // Only one real task: "Skip metadata sections"
    // The ## and ### inside the code fence should be ignored
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe("A1");
    expect(tasks[0].title).toBe("Skip metadata sections [REQ-01]");
  });

  test("multiple code fences with headings do not create phantom tasks", () => {
    const plan = `# Plan

## Work
### Real task one
Description.

\`\`\`markdown
## Fake Section
### Fake task
This is inside a code fence.
\`\`\`

### Real task two
Another description.

\`\`\`
## Another fake
### Another fake task
\`\`\`
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(2);
    expect(tasks[0].title).toBe("Real task one");
    expect(tasks[1].title).toBe("Real task two");
  });
});

// =============================================================================
// extractTaskContentBlocks — [REQ-01] content extraction per task
// =============================================================================

describe("extractTaskContentBlocks", () => {
  const cwd = "/tmp/test-project";

  test("returns full content for each task between ### headings", () => {
    const plan = `# Plan: Test
## Requirements
- [REQ-01] Do something

## Testing
Test command: bun test
Framework: bun test
Conventions: *.test.ts

## Feature
### Task one [REQ-01]
Description of task one.

**Test first:**
- Create \`src/thing.test.ts\`
\`\`\`typescript
test("it works", () => { expect(true).toBe(true); });
\`\`\`
- Run: \`bun test src/thing.test.ts\`
- Expected: FAIL

**Implementation:**
- Modify \`src/thing.ts\`

**Verify:**
- Run: \`bun test src/thing.test.ts\`
- Expected: PASS

Files: src/thing.ts, src/thing.test.ts

### Task two [REQ-01]
Second task description.
Files: src/other.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    const blocks = extractTaskContentBlocks(plan, tasks);
    // Use actual task IDs from parser
    const id0 = tasks[0].id;
    const id1 = tasks[1].id;
    expect(blocks.get(id0)).toContain("**Test first:**");
    expect(blocks.get(id0)).toContain("src/thing.test.ts");
    expect(blocks.get(id0)).toContain("**Implementation:**");
    expect(blocks.get(id0)).toContain("**Verify:**");
    expect(blocks.get(id1)).toContain("Second task description");
    expect(blocks.get(id1)).not.toContain("Task one");
  });

  test("handles single task at end of file", () => {
    const plan = `# Plan

## Work
### Only task
This is the only task.
Files: src/main.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    const blocks = extractTaskContentBlocks(plan, tasks);
    expect(blocks.size).toBe(1);
    expect(blocks.get("A1")).toContain("This is the only task.");
    expect(blocks.get("A1")).toContain("src/main.ts");
  });

  test("stops content block at next ## heading", () => {
    const plan = `# Plan

## First Section
### Task A
Content for A.

## Second Section
### Task B
Content for B.
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    const blocks = extractTaskContentBlocks(plan, tasks);
    expect(blocks.get("A1")).toContain("Content for A.");
    expect(blocks.get("A1")).not.toContain("Second Section");
    expect(blocks.get("A1")).not.toContain("Content for B.");
  });

  test("preserves code fences in content blocks", () => {
    const plan = `# Plan

## Work
### Task with code
Description.

\`\`\`typescript
function hello() {
  return "world";
}
\`\`\`

Files: src/hello.ts
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    const blocks = extractTaskContentBlocks(plan, tasks);
    expect(blocks.get("A1")).toContain("```typescript");
    expect(blocks.get("A1")).toContain('return "world"');
    expect(blocks.get("A1")).toContain("```");
  });

  test("maps blocks to correct task IDs across workstreams", () => {
    const plan = `# Plan

## Requirements
- [REQ-01] Feature A
- [REQ-02] Feature B

## Testing
Test command: bun test

## Alpha
### First task [REQ-01]
Alpha content.

### Second task [REQ-01]
More alpha content.

## Beta
### Third task [REQ-02]
Beta content.
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    const blocks = extractTaskContentBlocks(plan, tasks);
    // All tasks should have blocks
    expect(blocks.size).toBe(tasks.length);
    // Each block should contain its own content
    for (const task of tasks) {
      expect(blocks.has(task.id)).toBe(true);
      expect(blocks.get(task.id)!.length).toBeGreaterThan(0);
    }
  });

  test("skips ### headings inside Decisions metadata section", () => {
    const plan = `# Plan: Test

## Decisions

### Locked
- Decision one

### Discretionary
- Decision two

### Deferred
- Decision three

## Requirements
- [REQ-01] First requirement
- [REQ-02] Second requirement

## CI Workflow
### Update publish job [REQ-01]
Publish job description.
Files: .github/workflows/ci.yml

### Add git permissions [REQ-02]
Git permissions description.
Files: .github/workflows/ci.yml
`;
    const { tasks } = parsePlanToTasks(plan, cwd);
    expect(tasks.length).toBe(2);
    const blocks = extractTaskContentBlocks(plan, tasks);
    expect(blocks.size).toBe(2);
    expect(blocks.get("A1")).toContain("Publish job description");
    expect(blocks.get("A1")).not.toContain("Locked");
    expect(blocks.get("A2")).toContain("Git permissions description");
    expect(blocks.get("A2")).not.toContain("Discretionary");
  });
});

// =============================================================================
// writeTaskMarkdownFiles — [REQ-01] [REQ-02] write task-{id}.md files
// =============================================================================

describe("writeTaskMarkdownFiles", () => {
  test("creates task-{id}.md files in the plan directory", () => {
    const tmpDir = join("/tmp", "bart-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const blocks = new Map<string, string>();
    blocks.set("A1", "### Task one\nDescription\n**Test first:**\n...");
    blocks.set("A2", "### Task two\nOther content");
    writeTaskMarkdownFiles(tmpDir, blocks);
    expect(existsSync(join(tmpDir, "task-A1.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "task-A2.md"))).toBe(true);
    expect(readFileSync(join(tmpDir, "task-A1.md"), "utf-8")).toContain("Task one");
    rmSync(tmpDir, { recursive: true });
  });

  test("file content matches the block content", () => {
    const tmpDir = join("/tmp", "bart-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const content = "### Build feature\nDetailed implementation notes.\n\n**Test first:**\n- Write tests";
    const blocks = new Map<string, string>();
    blocks.set("B1", content);
    writeTaskMarkdownFiles(tmpDir, blocks);
    const written = readFileSync(join(tmpDir, "task-B1.md"), "utf-8");
    expect(written).toBe(content);
    rmSync(tmpDir, { recursive: true });
  });
});

// =============================================================================
// generateTaskMarkdown — [REQ-02] [REQ-03] [REQ-04] [REQ-06] [REQ-07]
// =============================================================================

import { buildTaskGenPrompt, generateTaskMarkdown } from "./task-gen.js";
import type { GenerateTaskMarkdownOptions } from "./task-gen.js";

describe("buildTaskGenPrompt", () => {
  const baseOpts: GenerateTaskMarkdownOptions = {
    taskId: "A1",
    rawContent: "### Add user auth [REQ-01]\nImplement JWT-based auth.\nFiles: src/auth.ts",
    planContent: "# Plan: Auth\n## Requirements\n- [REQ-01] Users can authenticate",
    requirements: ["REQ-01"],
    testingMeta: { test_command: "bun test", framework: "bun test", conventions: "*.test.ts" },
  };

  test("includes raw task content in the prompt", () => {
    const prompt = buildTaskGenPrompt(baseOpts);
    expect(prompt).toContain("### Add user auth [REQ-01]");
    expect(prompt).toContain("Implement JWT-based auth.");
  });

  test("includes full plan context [REQ-07]", () => {
    const prompt = buildTaskGenPrompt(baseOpts);
    expect(prompt).toContain("# Plan: Auth");
    expect(prompt).toContain("[REQ-01] Users can authenticate");
  });

  test("includes specialist premises when provided [REQ-03]", () => {
    const prompt = buildTaskGenPrompt({
      ...baseOpts,
      specialistPremises: "Follow security best practices\nUse parameterized queries",
    });
    expect(prompt).toContain("Follow security best practices");
    expect(prompt).toContain("Use parameterized queries");
  });

  test("includes specialist test expectations when provided [REQ-03]", () => {
    const prompt = buildTaskGenPrompt({
      ...baseOpts,
      testExpectations: ["unit tests for all public functions", "integration tests for API endpoints"],
    });
    expect(prompt).toContain("unit tests for all public functions");
    expect(prompt).toContain("integration tests for API endpoints");
  });

  test("includes testing metadata [REQ-04]", () => {
    const prompt = buildTaskGenPrompt(baseOpts);
    expect(prompt).toContain("bun test");
    expect(prompt).toContain("*.test.ts");
  });

  test("includes requirements list [REQ-02]", () => {
    const prompt = buildTaskGenPrompt({
      ...baseOpts,
      requirements: ["REQ-01", "REQ-02"],
    });
    expect(prompt).toContain("REQ-01");
    expect(prompt).toContain("REQ-02");
  });

  test("instructs LLM to produce required sections [REQ-02] [REQ-06]", () => {
    const prompt = buildTaskGenPrompt(baseOpts);
    expect(prompt).toContain("## Scope");
    expect(prompt).toContain("## Requirements");
    expect(prompt).toContain("## Definition of Done");
    expect(prompt).toContain("## Tests");
  });

  test("instructs LLM to generate tests when plan lacks them [REQ-04]", () => {
    const prompt = buildTaskGenPrompt({
      ...baseOpts,
      rawContent: "### Simple task\nJust do it.\nFiles: src/thing.ts",
    });
    // Should instruct generating tests even when raw content has none
    expect(prompt).toMatch(/generate|write|create|include.*test/i);
  });

  test("works without optional specialist fields", () => {
    const prompt = buildTaskGenPrompt({
      taskId: "B1",
      rawContent: "### Basic task\nDo something.",
      planContent: "# Plan\n## Work\n### Basic task",
      requirements: [],
    });
    expect(prompt).toContain("### Basic task");
    expect(prompt).toContain("# Plan");
  });
});

describe("generateTaskMarkdown", () => {
  test("returns structured markdown with all required sections", async () => {
    const mockOutput = `## Scope
Build JWT-based authentication.

## Requirements
- [REQ-01] Users can authenticate

## Definition of Done
- [ ] Auth endpoint returns JWT token
- [ ] Tests pass

## Tests
\`\`\`typescript
test("auth endpoint returns token", () => {
  // test code
});
\`\`\``;

    const result = await generateTaskMarkdown(
      {
        taskId: "A1",
        rawContent: "### Add auth\nImplement auth.\nFiles: src/auth.ts",
        planContent: "# Plan\n## Requirements\n- [REQ-01] Auth",
        requirements: ["REQ-01"],
        testingMeta: { test_command: "bun test" },
      },
      async () => mockOutput,
    );

    expect(result).toContain("## Scope");
    expect(result).toContain("## Requirements");
    expect(result).toContain("## Definition of Done");
    expect(result).toContain("## Tests");
  });

  test("passes constructed prompt to the agent runner", async () => {
    let capturedPrompt = "";
    await generateTaskMarkdown(
      {
        taskId: "A1",
        rawContent: "### Task\nContent.",
        planContent: "# Plan",
        requirements: ["REQ-01"],
      },
      async (prompt) => {
        capturedPrompt = prompt;
        return "## Scope\nDone";
      },
    );

    expect(capturedPrompt).toContain("### Task");
    expect(capturedPrompt).toContain("# Plan");
    expect(capturedPrompt).toContain("REQ-01");
  });

  test("returns agent output as-is", async () => {
    const agentOutput = "## Scope\nCustom output\n## Tests\nSome tests";
    const result = await generateTaskMarkdown(
      {
        taskId: "B1",
        rawContent: "### Task",
        planContent: "# Plan",
        requirements: [],
      },
      async () => agentOutput,
    );

    expect(result).toBe(agentOutput);
  });

  test("includes specialist context in prompt sent to agent [REQ-03]", async () => {
    let capturedPrompt = "";
    await generateTaskMarkdown(
      {
        taskId: "A1",
        rawContent: "### Task",
        planContent: "# Plan",
        requirements: [],
        specialistPremises: "Security-first approach",
        testExpectations: ["E2E tests for auth flow"],
      },
      async (prompt) => {
        capturedPrompt = prompt;
        return "## Scope\nDone";
      },
    );

    expect(capturedPrompt).toContain("Security-first approach");
    expect(capturedPrompt).toContain("E2E tests for auth flow");
  });
});

// =============================================================================
// runPlanCommand — integration with generateTaskMarkdown [REQ-02] [REQ-03] [REQ-07]
// =============================================================================

describe("runPlanCommand — task markdown generation integration", () => {
  test("calls generateTaskMarkdown for each task and writes enriched files [REQ-02]", async () => {
    const tmpDir = join("/tmp", "bart-plan-integration-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });

    const planContent = `# Plan: Test Integration

## Requirements
- [REQ-01] Feature works

## Testing
Test command: bun test
Framework: bun test

## Core
### Build feature [REQ-01]
Implement the feature.
Files: src/feature.ts

### Add tests [REQ-01]
Write test coverage.
Files: src/feature.test.ts
`;
    const planPath = join(tmpDir, "plan.md");
    writeFileSync(planPath, planContent);

    const generatedContents: string[] = [];
    const mockRunner = async (prompt: string) => {
      const enriched = `## Scope\nEnriched content for prompt\n\n## Tests\nGenerated tests`;
      generatedContents.push(enriched);
      return enriched;
    };

    await runPlanCommand(tmpDir, join(tmpDir, "tasks.json"), planPath, false, true, mockRunner);

    // Should have called the runner for each task
    expect(generatedContents.length).toBe(2);

    // Find the generated plan directory
    const plansDir = join(tmpDir, ".bart", "plans");
    const planDirs = readdirSync(plansDir);
    expect(planDirs.length).toBe(1);
    const planDir = join(plansDir, planDirs[0]);

    // task-{id}.md files should contain enriched content, not raw content
    const tasksJson = JSON.parse(readFileSync(join(planDir, "tasks.json"), "utf-8"));
    const taskIds = tasksJson.tasks.map((t: any) => t.id);

    for (const taskId of taskIds) {
      const taskFile = join(planDir, `task-${taskId}.md`);
      expect(existsSync(taskFile)).toBe(true);
      const content = readFileSync(taskFile, "utf-8");
      expect(content).toContain("## Scope");
      expect(content).toContain("Enriched content");
    }

    rmSync(tmpDir, { recursive: true });
  });

  test("passes specialist premises to generateTaskMarkdown when task has specialist [REQ-03]", async () => {
    const tmpDir = join("/tmp", "bart-plan-specialist-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });

    // Create a specialist profile — premises as a single block so parseProfile captures it
    const specialistDir = join(tmpDir, ".bart", "specialists");
    mkdirSync(specialistDir, { recursive: true });
    writeFileSync(join(specialistDir, "security-expert.md"), `---
name: security-expert
role: security engineer
description: Security specialist for auth and crypto
test_expectations:
  - unit tests for all auth functions
  - integration tests for auth flow
---

Always validate input and use parameterized queries.
`);

    const planContent = `# Plan: Secure Auth

## Requirements
- [REQ-01] Auth is secure

## Core
### Build secure auth [REQ-01] [security-expert]
Implement secure authentication.
Files: src/auth.ts
`;
    const planPath = join(tmpDir, "plan.md");
    writeFileSync(planPath, planContent);

    const capturedPrompts: string[] = [];
    const mockRunner = async (prompt: string) => {
      capturedPrompts.push(prompt);
      return "## Scope\nSecure auth\n\n## Tests\nAuth tests";
    };

    await runPlanCommand(tmpDir, join(tmpDir, "tasks.json"), planPath, false, true, mockRunner);

    expect(capturedPrompts.length).toBe(1);
    // The prompt should include specialist premises
    expect(capturedPrompts[0]).toContain("Always validate input and use parameterized queries");
    // The prompt should include specialist test expectations
    expect(capturedPrompts[0]).toContain("unit tests for all auth functions");

    rmSync(tmpDir, { recursive: true });
  });

  test("writes raw content blocks when no agentRunner is provided", async () => {
    const tmpDir = join("/tmp", "bart-plan-no-runner-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });

    const planContent = `# Plan: Simple

## Work
### Simple task
Do something simple.
Files: src/simple.ts
`;
    const planPath = join(tmpDir, "plan.md");
    writeFileSync(planPath, planContent);

    // No agentRunner provided — should fall back to writing raw content blocks
    await runPlanCommand(tmpDir, join(tmpDir, "tasks.json"), planPath, false, true);

    const plansDir = join(tmpDir, ".bart", "plans");
    const planDirs = readdirSync(plansDir);
    const planDir = join(plansDir, planDirs[0]);

    // task file should exist with raw content (no enrichment)
    const taskFile = join(planDir, "task-A1.md");
    expect(existsSync(taskFile)).toBe(true);
    const content = readFileSync(taskFile, "utf-8");
    expect(content).toContain("### Simple task");
    expect(content).toContain("Do something simple");

    rmSync(tmpDir, { recursive: true });
  });

  test("passes full plan content and testing metadata to generateTaskMarkdown [REQ-07]", async () => {
    const tmpDir = join("/tmp", "bart-plan-context-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });

    const planContent = `# Plan: Full Context

## Requirements
- [REQ-01] Full context passed

## Testing
Test command: bun test
Framework: vitest
Conventions: *.test.ts

## Work
### Implement feature [REQ-01]
Build the feature.
Files: src/feature.ts
`;
    const planPath = join(tmpDir, "plan.md");
    writeFileSync(planPath, planContent);

    let capturedPrompt = "";
    const mockRunner = async (prompt: string) => {
      capturedPrompt = prompt;
      return "## Scope\nDone";
    };

    await runPlanCommand(tmpDir, join(tmpDir, "tasks.json"), planPath, false, true, mockRunner);

    // Full plan content should be in the prompt
    expect(capturedPrompt).toContain("# Plan: Full Context");
    expect(capturedPrompt).toContain("[REQ-01] Full context passed");
    // Testing metadata should be in the prompt
    expect(capturedPrompt).toContain("bun test");
    expect(capturedPrompt).toContain("vitest");
    expect(capturedPrompt).toContain("*.test.ts");
  });
});
