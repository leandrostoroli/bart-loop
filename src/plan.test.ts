import { describe, test, expect } from "bun:test";
import { parsePlanToTasks } from "./plan.js";

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

    // Requirements coverage — workstream B because ## Requirements and ## Testing
    // each count as section increments, so ## Core Changes is sectionIndex=3
    const task0Id = tasks[0].id;
    const task1Id = tasks[1].id;
    expect(requirements[0].covered_by).toContain(task0Id);
    expect(requirements[1].covered_by).toContain(task1Id);
  });

  test("## Testing and ## Requirements count toward section index for workstream assignment", () => {
    // sectionIndex increments for ALL ## headings including Requirements and Testing.
    // This means metadata sections shift subsequent workstream lettering.
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

    // Both tasks end up in the same workstream since metadata sections
    // consume section indices, pushing real workstreams into the same bucket
    expect(tasks[0].workstream).toBe(tasks[1].workstream);
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
