import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import {
  buildTestingContextBlock,
  buildSelfReviewBlock,
  buildTaskPrompt,
  extractDefinitionOfDone,
  appendReviewFeedback,
  markReviewFeedbackResolved,
  resolveTaskFilePath,
} from "./cli.js";
import type { Task } from "./constants.js";

// =============================================================================
// buildTestingContextBlock
// =============================================================================

describe("buildTestingContextBlock", () => {
  test("includes test command, framework, and conventions when all provided", () => {
    const block = buildTestingContextBlock({
      test_command: "npm test",
      framework: "vitest",
      conventions: "tests in __tests__/, named *.test.ts",
    });
    expect(block).toContain("Test command: `npm test`");
    expect(block).toContain("Framework: vitest");
    expect(block).toContain(
      "Conventions: tests in __tests__/, named *.test.ts",
    );
  });

  test("includes only test command when other fields are absent", () => {
    const block = buildTestingContextBlock({ test_command: "bun test" });
    expect(block).toContain("Test command: `bun test`");
    expect(block).not.toContain("Framework:");
    expect(block).not.toContain("Conventions:");
  });

  test("includes only framework when other fields are absent", () => {
    const block = buildTestingContextBlock({ framework: "jest" });
    expect(block).toContain("Framework: jest");
    expect(block).not.toContain("Test command:");
    expect(block).not.toContain("Conventions:");
  });

  test("returns discovery instruction when metadata is null", () => {
    const block = buildTestingContextBlock(null);
    expect(block).toContain("No test command specified in the plan");
    expect(block).toContain("Discover the project's test setup");
    expect(block).toContain("package.json");
  });

  test("returns discovery instruction when metadata is undefined", () => {
    const block = buildTestingContextBlock(undefined);
    expect(block).toContain("No test command specified in the plan");
    expect(block).toContain("Discover the project's test setup");
  });
});

// =============================================================================
// buildSelfReviewBlock
// =============================================================================

describe("buildSelfReviewBlock", () => {
  test("contains all three required sections", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).toContain("### 1. Scope Check");
    expect(block).toContain("### 2. Code Quality Check");
    expect(block).toContain("### 3. TDD Protocol (Mandatory)");
  });

  test("contains TDD protocol steps", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).toContain("WRITE the failing test first");
    expect(block).toContain("RUN the test and verify it FAILS");
    expect(block).toContain("WRITE the minimal implementation");
    expect(block).toContain("RUN the test and verify it PASSES");
    expect(block).toContain("COMMIT the test and implementation together");
  });

  test("contains evidence requirement section", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).toContain("### Evidence Requirement");
    expect(block).toContain("Show actual test command output");
    expect(block).toContain("All tests must pass with zero failures");
    expect(block).toContain(
      "If you cannot run tests, explain why and flag for review",
    );
  });

  test("includes testing context from metadata", () => {
    const testingBlock = buildTestingContextBlock({
      test_command: "pytest",
      framework: "pytest",
    });
    const block = buildSelfReviewBlock({ testingContextBlock: testingBlock });
    expect(block).toContain("Test command: `pytest`");
    expect(block).toContain("Framework: pytest");
  });

  test("includes discovery instruction when no testing metadata", () => {
    const testingBlock = buildTestingContextBlock(null);
    const block = buildSelfReviewBlock({ testingContextBlock: testingBlock });
    expect(block).toContain("No test command specified in the plan");
    expect(block).toContain("Discover the project's test setup");
  });

  test("uses specialist premises when provided", () => {
    const block = buildSelfReviewBlock({
      specialistPremises: "Use consistent naming\nFollow DRY principles",
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).toContain(
      "Apply the specialist's standards as the quality bar",
    );
    expect(block).toContain("Use consistent naming");
    expect(block).toContain("Follow DRY principles");
    expect(block).not.toContain("default quality standards");
  });

  test("uses default quality gate when no specialist premises", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).toContain("Apply these default quality standards");
    expect(block).toContain("Follow existing code style");
    expect(block).not.toContain("Apply the specialist's standards");
  });

  test("default quality gate includes TDD standards", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).toContain(
      "Write tests before production code — follow the RED-GREEN-REFACTOR cycle",
    );
    expect(block).toContain(
      "Show actual test command output as evidence before claiming task completion",
    );
    expect(block).toContain(
      "Tests must verify real behavior, not mock behavior",
    );
  });

  test("includes specialist test expectations when provided", () => {
    const block = buildSelfReviewBlock({
      specialistTestExpectations: [
        "Unit tests for all public functions",
        "Integration tests for API endpoints",
      ],
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).toContain("Specialist test expectations:");
    expect(block).toContain("Unit tests for all public functions");
    expect(block).toContain("Integration tests for API endpoints");
  });

  test("omits specialist test expectations when empty", () => {
    const block = buildSelfReviewBlock({
      specialistTestExpectations: [],
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).not.toContain("Specialist test expectations:");
  });

  test("omits specialist test expectations when undefined", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).not.toContain("Specialist test expectations:");
  });

  test("combines specialist premises, test expectations, and testing metadata", () => {
    const testingBlock = buildTestingContextBlock({
      test_command: "npm test",
      framework: "vitest",
      conventions: "co-located *.test.ts files",
    });
    const block = buildSelfReviewBlock({
      specialistPremises: "Follow strict typing",
      specialistTestExpectations: ["E2E tests for user flows"],
      testingContextBlock: testingBlock,
    });
    // All three sources present
    expect(block).toContain("Follow strict typing");
    expect(block).toContain("E2E tests for user flows");
    expect(block).toContain("Test command: `npm test`");
    expect(block).toContain("Framework: vitest");
    expect(block).toContain("Conventions: co-located *.test.ts files");
  });

  test("uses system prompt reference when premisesInSystemPrompt is true", () => {
    const block = buildSelfReviewBlock({
      specialistPremises: "Follow strict typing\nUse DRY principles",
      testingContextBlock: buildTestingContextBlock(null),
      premisesInSystemPrompt: true,
    });
    expect(block).toContain(
      "Apply your specialist guidelines and standards as the quality bar",
    );
    // Should NOT inline the actual premises text
    expect(block).not.toContain("Follow strict typing");
    expect(block).not.toContain("Use DRY principles");
    expect(block).not.toContain("default quality standards");
  });

  test("premisesInSystemPrompt takes priority over inline premises", () => {
    const block = buildSelfReviewBlock({
      specialistPremises: "Some premises",
      testingContextBlock: buildTestingContextBlock(null),
      premisesInSystemPrompt: true,
    });
    expect(block).toContain("system prompt");
    expect(block).not.toContain("Some premises");
  });
});

// =============================================================================
// extractDefinitionOfDone — [REQ-06] extract DoD section from task markdown
// =============================================================================

describe("extractDefinitionOfDone", () => {
  test("returns null when markdown has no Definition of Done section", () => {
    const md =
      "### Task\nSome instructions.\n\n## Implementation\nDo the thing.";
    expect(extractDefinitionOfDone(md)).toBeNull();
  });

  test("extracts Definition of Done section content", () => {
    const md = `### Task A1
Some instructions.

## Definition of Done
- [ ] All unit tests pass
- [ ] API endpoint returns 200
- [ ] Error handling covers edge cases

## Implementation
Do the thing.`;
    const dod = extractDefinitionOfDone(md);
    expect(dod).toContain("All unit tests pass");
    expect(dod).toContain("API endpoint returns 200");
    expect(dod).toContain("Error handling covers edge cases");
  });

  test("extracts Definition of Done at end of file (no following section)", () => {
    const md = `### Task A1
Some instructions.

## Definition of Done
- [ ] Tests pass
- [ ] Code reviewed`;
    const dod = extractDefinitionOfDone(md);
    expect(dod).toContain("Tests pass");
    expect(dod).toContain("Code reviewed");
  });

  test("returns trimmed content without the heading itself", () => {
    const md = `## Definition of Done
- [ ] Feature works`;
    const dod = extractDefinitionOfDone(md);
    expect(dod).not.toContain("## Definition of Done");
    expect(dod).toBe("- [ ] Feature works");
  });
});

// =============================================================================
// buildSelfReviewBlock — [REQ-06] Definition of Done injection
// =============================================================================

describe("buildSelfReviewBlock with definitionOfDone", () => {
  test("injects Definition of Done checklist when provided", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
      definitionOfDone: "- [ ] All tests pass\n- [ ] Error handling verified",
    });
    expect(block).toContain("### 4. Task-Specific Definition of Done");
    expect(block).toContain("All tests pass");
    expect(block).toContain("Error handling verified");
  });

  test("does not include Definition of Done section when not provided", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
    });
    expect(block).not.toContain("### 4. Task-Specific Definition of Done");
  });

  test("does not include Definition of Done section when empty string", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
      definitionOfDone: "",
    });
    expect(block).not.toContain("### 4. Task-Specific Definition of Done");
  });

  test("Definition of Done appears after TDD Protocol and before Evidence Requirement", () => {
    const block = buildSelfReviewBlock({
      testingContextBlock: buildTestingContextBlock(null),
      definitionOfDone: "- [ ] API returns correct status codes",
    });
    const dodIdx = block.indexOf("### 4. Task-Specific Definition of Done");
    const tddIdx = block.indexOf("### 3. TDD Protocol");
    const evidenceIdx = block.indexOf("### Evidence Requirement");
    expect(dodIdx).toBeGreaterThan(tddIdx);
    expect(dodIdx).toBeLessThan(evidenceIdx);
  });
});

// =============================================================================
// buildTaskPrompt — [REQ-05] read task markdown instead of tasks.json fields
// =============================================================================

describe("buildTaskPrompt", () => {
  const makeTask = (overrides: Partial<Task> = {}): Task => ({
    id: "A1",
    workstream: "A",
    title: "Build API endpoint",
    description: "Create the REST endpoint for users.",
    files: ["src/api.ts", "src/api.test.ts"],
    depends_on: [],
    status: "pending",
    files_modified: [],
    started_at: null,
    completed_at: null,
    error: null,
    ...overrides,
  });

  const selfReviewBlock = "\n\n## Self-Review\nCheck everything.";
  const specialistContext = "\nSpecialist: code-architect";

  test("uses task markdown file content when task-{id}.md exists", () => {
    const tmpDir = join("/tmp", "bart-prompt-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    const markdownContent =
      "### Build API endpoint\nDetailed instructions.\n\n**Test first:**\n- Create `src/api.test.ts`\n\n**Implementation:**\n- Modify `src/api.ts`";
    writeFileSync(join(tmpDir, "task-A1.md"), markdownContent);

    const task = makeTask();
    const prompt = buildTaskPrompt(
      task,
      tasksPath,
      specialistContext,
      selfReviewBlock,
    );

    expect(prompt).toContain(markdownContent);
    expect(prompt).toContain(specialistContext);
    expect(prompt).toContain(selfReviewBlock);
    expect(prompt).toContain("Please complete this task.");
    // Should NOT contain the fallback format
    expect(prompt).not.toMatch(/^Task: Build API endpoint\n/);

    rmSync(tmpDir, { recursive: true });
  });

  test("falls back to title+description when no task markdown file exists", () => {
    const tmpDir = join("/tmp", "bart-prompt-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    // No task-A1.md file created

    const task = makeTask();
    const prompt = buildTaskPrompt(
      task,
      tasksPath,
      specialistContext,
      selfReviewBlock,
    );

    expect(prompt).toContain("Task: Build API endpoint");
    expect(prompt).toContain(
      "Description: Create the REST endpoint for users.",
    );
    expect(prompt).toContain("Files to work on: src/api.ts, src/api.test.ts");
    expect(prompt).toContain(specialistContext);
    expect(prompt).toContain(selfReviewBlock);
    expect(prompt).toContain("Please complete this task.");

    rmSync(tmpDir, { recursive: true });
  });

  test("includes specialist context and self-review with markdown content", () => {
    const tmpDir = join("/tmp", "bart-prompt-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    writeFileSync(join(tmpDir, "task-B2.md"), "### Task B2\nMarkdown content.");

    const task = makeTask({ id: "B2" });
    const prompt = buildTaskPrompt(
      task,
      tasksPath,
      specialistContext,
      selfReviewBlock,
    );

    expect(prompt).toContain("### Task B2\nMarkdown content.");
    expect(prompt).toContain(specialistContext);
    expect(prompt).toContain(selfReviewBlock);

    rmSync(tmpDir, { recursive: true });
  });

  test("works with empty specialist context", () => {
    const tmpDir = join("/tmp", "bart-prompt-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    writeFileSync(join(tmpDir, "task-A1.md"), "### Task\nContent.");

    const task = makeTask();
    const prompt = buildTaskPrompt(task, tasksPath, "", selfReviewBlock);

    expect(prompt).toContain("### Task\nContent.");
    expect(prompt).toContain(selfReviewBlock);

    rmSync(tmpDir, { recursive: true });
  });

  test("extracts Definition of Done from markdown and includes it in self-review", () => {
    const tmpDir = join("/tmp", "bart-prompt-dod-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    const markdownContent = `### Build API endpoint
Detailed instructions.

## Definition of Done
- [ ] All endpoints return correct status codes
- [ ] Input validation covers edge cases
- [ ] Integration tests pass

## Implementation
- Modify \`src/api.ts\``;
    writeFileSync(join(tmpDir, "task-A1.md"), markdownContent);

    const task = makeTask();
    // Use the real buildSelfReviewBlock to verify the integration
    const testingBlock = buildTestingContextBlock(null);
    const dod = extractDefinitionOfDone(markdownContent);
    const reviewBlock = buildSelfReviewBlock({
      testingContextBlock: testingBlock,
      definitionOfDone: dod,
    });
    const prompt = buildTaskPrompt(task, tasksPath, "", reviewBlock);

    expect(prompt).toContain("### 4. Task-Specific Definition of Done");
    expect(prompt).toContain("All endpoints return correct status codes");
    expect(prompt).toContain("Input validation covers edge cases");

    rmSync(tmpDir, { recursive: true });
  });

  test("does not include Definition of Done section when task markdown lacks it", () => {
    const tmpDir = join("/tmp", "bart-prompt-dod-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    writeFileSync(
      join(tmpDir, "task-A1.md"),
      "### Task\nJust instructions, no DoD.",
    );

    const task = makeTask();
    const testingBlock = buildTestingContextBlock(null);
    const dod = extractDefinitionOfDone("### Task\nJust instructions, no DoD.");
    const reviewBlock = buildSelfReviewBlock({
      testingContextBlock: testingBlock,
      definitionOfDone: dod,
    });
    const prompt = buildTaskPrompt(task, tasksPath, "", reviewBlock);

    expect(prompt).not.toContain("### 4. Task-Specific Definition of Done");

    rmSync(tmpDir, { recursive: true });
  });

  test("reads markdown from same directory as tasksPath", () => {
    // Verify it reads from dirname(tasksPath), not cwd
    const tmpDir = join(
      "/tmp",
      "bart-prompt-test-" + Date.now(),
      "nested",
      "plan",
    );
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    writeFileSync(
      join(tmpDir, "task-C1.md"),
      "### Nested task\nFrom nested dir.",
    );

    const task = makeTask({ id: "C1" });
    const prompt = buildTaskPrompt(task, tasksPath, "", selfReviewBlock);

    expect(prompt).toContain("### Nested task\nFrom nested dir.");

    rmSync(
      join(
        "/tmp",
        "bart-prompt-test-" +
          tmpDir.split("bart-prompt-test-")[1].split("/")[0],
      ),
      { recursive: true },
    );
  });
});

// =============================================================================
// assembleTaskPrompt — [REQ-06] end-to-end prompt assembly with DoD extraction
// =============================================================================

import { assembleTaskPrompt } from "./cli.js";

describe("assembleTaskPrompt", () => {
  const makeTask = (overrides: Partial<Task> = {}): Task => ({
    id: "A1",
    workstream: "A",
    title: "Build API endpoint",
    description: "Create the REST endpoint for users.",
    files: ["src/api.ts", "src/api.test.ts"],
    depends_on: [],
    status: "pending",
    files_modified: [],
    started_at: null,
    completed_at: null,
    error: null,
    ...overrides,
  });

  test("extracts DoD from task markdown and injects into self-review block", () => {
    const tmpDir = join("/tmp", "bart-assemble-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    const markdownContent = `### Build API endpoint
Detailed instructions.

## Definition of Done
- [ ] All endpoints return correct status codes
- [ ] Input validation covers edge cases

## Implementation
- Modify \`src/api.ts\``;
    writeFileSync(join(tmpDir, "task-A1.md"), markdownContent);

    const task = makeTask();
    const prompt = assembleTaskPrompt({
      task,
      tasksPath,
      specialistContext: "",
      specialistPremises: "",
      specialistTestExpectations: undefined,
      testingMetadata: null,
    });

    expect(prompt).toContain("### 4. Task-Specific Definition of Done");
    expect(prompt).toContain("All endpoints return correct status codes");
    expect(prompt).toContain("Input validation covers edge cases");

    rmSync(tmpDir, { recursive: true });
  });

  test("does not inject DoD when task markdown has no Definition of Done section", () => {
    const tmpDir = join("/tmp", "bart-assemble-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    writeFileSync(
      join(tmpDir, "task-A1.md"),
      "### Task\nJust instructions, no DoD.",
    );

    const task = makeTask();
    const prompt = assembleTaskPrompt({
      task,
      tasksPath,
      specialistContext: "",
      specialistPremises: "",
      specialistTestExpectations: undefined,
      testingMetadata: null,
    });

    expect(prompt).not.toContain("### 4. Task-Specific Definition of Done");

    rmSync(tmpDir, { recursive: true });
  });

  test("does not inject DoD when no task markdown file exists", () => {
    const tmpDir = join("/tmp", "bart-assemble-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    // No task-A1.md file

    const task = makeTask();
    const prompt = assembleTaskPrompt({
      task,
      tasksPath,
      specialistContext: "",
      specialistPremises: "",
      specialistTestExpectations: undefined,
      testingMetadata: null,
    });

    expect(prompt).not.toContain("### 4. Task-Specific Definition of Done");
    // Should still have the basic self-review structure
    expect(prompt).toContain("### 1. Scope Check");
    expect(prompt).toContain("### 3. TDD Protocol");

    rmSync(tmpDir, { recursive: true });
  });

  test("includes specialist context and testing metadata alongside DoD", () => {
    const tmpDir = join("/tmp", "bart-assemble-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    writeFileSync(
      join(tmpDir, "task-A1.md"),
      `### Task
Instructions.

## Definition of Done
- [ ] Tests pass`,
    );

    const task = makeTask();
    const prompt = assembleTaskPrompt({
      task,
      tasksPath,
      specialistContext: "\nSpecialist: code-architect",
      specialistPremises: "Follow strict typing",
      specialistTestExpectations: ["E2E tests for user flows"],
      testingMetadata: { test_command: "bun test", framework: "bun" },
    });

    expect(prompt).toContain("### 4. Task-Specific Definition of Done");
    expect(prompt).toContain("Tests pass");
    expect(prompt).toContain("Specialist: code-architect");
    expect(prompt).toContain("Follow strict typing");
    expect(prompt).toContain("E2E tests for user flows");
    expect(prompt).toContain("Test command: `bun test`");

    rmSync(tmpDir, { recursive: true });
  });
});

// =============================================================================
// appendReviewFeedback — [REQ-01] [REQ-03] [REQ-04] append rejection reasons to task markdown
// =============================================================================

describe("appendReviewFeedback", () => {
  test("appends Review Feedback section with Attempt 1 on first failure", () => {
    const tmpDir = join("/tmp", "bart-feedback-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const taskMdPath = join(tmpDir, "task-A1.md");
    writeFileSync(
      taskMdPath,
      "### Task A1\nBuild the API endpoint.\n\n## Definition of Done\n- [ ] Tests pass\n",
    );

    const result = appendReviewFeedback(taskMdPath, [
      "Missing error handling",
      "No input validation",
    ]);

    expect(result).toBe(true);
    const content = readFileSync(taskMdPath, "utf-8");
    expect(content).toContain("## Review Feedback");
    expect(content).toContain("### Attempt 1 — REJECTED");
    expect(content).toContain("- Missing error handling");
    expect(content).toContain("- No input validation");

    rmSync(tmpDir, { recursive: true });
  });

  test("appends Attempt 2 on second failure, preserving Attempt 1", () => {
    const tmpDir = join("/tmp", "bart-feedback-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const taskMdPath = join(tmpDir, "task-A1.md");
    writeFileSync(
      taskMdPath,
      `### Task A1
Build the API endpoint.

## Review Feedback

### Attempt 1 — REJECTED
- Missing error handling
`,
    );

    const result = appendReviewFeedback(taskMdPath, [
      "Still no validation",
      "Tests incomplete",
    ]);

    expect(result).toBe(true);
    const content = readFileSync(taskMdPath, "utf-8");
    // Attempt 1 preserved
    expect(content).toContain("### Attempt 1 — REJECTED");
    expect(content).toContain("- Missing error handling");
    // Attempt 2 added
    expect(content).toContain("### Attempt 2 — REJECTED");
    expect(content).toContain("- Still no validation");
    expect(content).toContain("- Tests incomplete");

    rmSync(tmpDir, { recursive: true });
  });

  test("returns false and does not create file when task markdown does not exist", () => {
    const taskMdPath = join(
      "/tmp",
      "bart-feedback-test-nonexistent-" + Date.now(),
      "task-X1.md",
    );

    const result = appendReviewFeedback(taskMdPath, ["Some issue"]);

    expect(result).toBe(false);
    expect(existsSync(taskMdPath)).toBe(false);
  });

  test("does not corrupt existing markdown sections", () => {
    const tmpDir = join("/tmp", "bart-feedback-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const taskMdPath = join(tmpDir, "task-B1.md");
    const originalContent = `### Task B1
Implementation details.

## Scope
- Included: API routes
- Excluded: Database

## Requirements
- REQ-01

## Definition of Done
- [ ] All tests pass
- [ ] Code reviewed

## Tests
\`\`\`typescript
test("works", () => { expect(true).toBe(true); });
\`\`\`
`;
    writeFileSync(taskMdPath, originalContent);

    appendReviewFeedback(taskMdPath, ["Fix the bug"]);

    const content = readFileSync(taskMdPath, "utf-8");
    // All original sections preserved
    expect(content).toContain("## Scope");
    expect(content).toContain("- Included: API routes");
    expect(content).toContain("## Requirements");
    expect(content).toContain("## Definition of Done");
    expect(content).toContain("## Tests");
    // Feedback appended at end
    expect(content).toContain("## Review Feedback");
    expect(content).toContain("### Attempt 1 — REJECTED");
    // Feedback appears after Tests section
    const testsIdx = content.indexOf("## Tests");
    const feedbackIdx = content.indexOf("## Review Feedback");
    expect(feedbackIdx).toBeGreaterThan(testsIdx);

    rmSync(tmpDir, { recursive: true });
  });

  test("feedback is picked up by buildTaskPrompt automatically", () => {
    const tmpDir = join("/tmp", "bart-feedback-prompt-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    const taskMdPath = join(tmpDir, "task-A1.md");
    writeFileSync(taskMdPath, "### Task A1\nDo the thing.\n");

    appendReviewFeedback(taskMdPath, ["Missing tests"]);

    const task: Task = {
      id: "A1",
      workstream: "A",
      title: "Task A1",
      description: "Do the thing.",
      files: ["src/a.ts"],
      depends_on: [],
      status: "pending",
      files_modified: [],
      started_at: null,
      completed_at: null,
      error: null,
    };
    const prompt = buildTaskPrompt(
      task,
      tasksPath,
      "",
      "\n\n## Self-Review\nCheck.",
    );

    expect(prompt).toContain("## Review Feedback");
    expect(prompt).toContain("### Attempt 1 — REJECTED");
    expect(prompt).toContain("- Missing tests");

    rmSync(tmpDir, { recursive: true });
  });

  test("correctly counts attempt number from multiple existing subsections", () => {
    const tmpDir = join("/tmp", "bart-feedback-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const taskMdPath = join(tmpDir, "task-A1.md");
    writeFileSync(
      taskMdPath,
      `### Task A1
Do the thing.

## Review Feedback

### Attempt 1 — REJECTED
- Issue one

### Attempt 2 — REJECTED
- Issue two
`,
    );

    appendReviewFeedback(taskMdPath, ["Issue three"]);

    const content = readFileSync(taskMdPath, "utf-8");
    expect(content).toContain("### Attempt 3 — REJECTED");
    expect(content).toContain("- Issue three");
    // Previous attempts preserved
    expect(content).toContain("### Attempt 1 — REJECTED");
    expect(content).toContain("### Attempt 2 — REJECTED");

    rmSync(tmpDir, { recursive: true });
  });
});

// =============================================================================
// markReviewFeedbackResolved — [REQ-02] [REQ-03]
// =============================================================================

describe("markReviewFeedbackResolved", () => {
  test("appends ### Resolved when ## Review Feedback section exists", () => {
    const tmpDir = join("/tmp", "bart-resolved-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const taskMdPath = join(tmpDir, "task-A1.md");
    writeFileSync(
      taskMdPath,
      `### Task A1
Do the thing.

## Review Feedback

### Attempt 1 — REJECTED
- Missing error handling
`,
    );

    const result = markReviewFeedbackResolved(taskMdPath);

    expect(result).toBe(true);
    const content = readFileSync(taskMdPath, "utf-8");
    expect(content).toContain("### Resolved");
    expect(content).toContain(
      "All previous review issues have been addressed. Review passed.",
    );
    // Original feedback preserved as audit trail
    expect(content).toContain("### Attempt 1 — REJECTED");
    expect(content).toContain("- Missing error handling");

    rmSync(tmpDir, { recursive: true });
  });

  test("returns false when no ## Review Feedback section exists (no-op)", () => {
    const tmpDir = join("/tmp", "bart-resolved-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const taskMdPath = join(tmpDir, "task-A1.md");
    writeFileSync(taskMdPath, "### Task A1\nDo the thing.\n");

    const result = markReviewFeedbackResolved(taskMdPath);

    expect(result).toBe(false);
    const content = readFileSync(taskMdPath, "utf-8");
    expect(content).not.toContain("### Resolved");

    rmSync(tmpDir, { recursive: true });
  });

  test("returns false when already resolved (idempotent)", () => {
    const tmpDir = join("/tmp", "bart-resolved-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const taskMdPath = join(tmpDir, "task-A1.md");
    writeFileSync(
      taskMdPath,
      `### Task A1
Do the thing.

## Review Feedback

### Attempt 1 — REJECTED
- Missing error handling

### Resolved
All previous review issues have been addressed. Review passed.
`,
    );

    const result = markReviewFeedbackResolved(taskMdPath);

    expect(result).toBe(false);
    // Content unchanged — still only one ### Resolved
    const content = readFileSync(taskMdPath, "utf-8");
    const resolvedCount = (content.match(/### Resolved/g) || []).length;
    expect(resolvedCount).toBe(1);

    rmSync(tmpDir, { recursive: true });
  });

  test("returns false when file does not exist", () => {
    const result = markReviewFeedbackResolved(
      "/tmp/nonexistent-file-" + Date.now() + ".md",
    );
    expect(result).toBe(false);
  });
});

// =============================================================================
// resolveTaskFilePath — [REQ-01] resolve task markdown file path for display
// =============================================================================

describe("resolveTaskFilePath", () => {
  test("returns absolute path when task markdown file exists", () => {
    const tmpDir = join("/tmp", "bart-taskfile-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    writeFileSync(join(tmpDir, "task-A1.md"), "### Task A1\nContent.");

    const result = resolveTaskFilePath(tasksPath, "A1");

    expect(result).toBe(join(tmpDir, "task-A1.md"));

    rmSync(tmpDir, { recursive: true });
  });

  test("returns '(no task file)' when task markdown file does not exist", () => {
    const tmpDir = join("/tmp", "bart-taskfile-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    // No task-B2.md created

    const result = resolveTaskFilePath(tasksPath, "B2");

    expect(result).toBe("(no task file)");

    rmSync(tmpDir, { recursive: true });
  });

  test("resolves path relative to tasksPath directory, not cwd", () => {
    const tmpDir = join(
      "/tmp",
      "bart-taskfile-test-" + Date.now(),
      "nested",
      "plan",
    );
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    writeFileSync(join(tmpDir, "task-C1.md"), "### Task C1\nNested.");

    const result = resolveTaskFilePath(tasksPath, "C1");

    expect(result).toBe(join(tmpDir, "task-C1.md"));
    expect(result).toContain("/nested/plan/task-C1.md");

    rmSync(
      join(
        "/tmp",
        "bart-taskfile-test-" +
          tmpDir.split("bart-taskfile-test-")[1].split("/")[0],
      ),
      { recursive: true },
    );
  });
});

// =============================================================================
// Integration: buildTaskPrompt picks up resolved feedback from task-{id}.md
// =============================================================================

describe("buildTaskPrompt with resolved review feedback", () => {
  test("prompt includes both feedback and resolved marker after round-trip", () => {
    const tmpDir = join(
      "/tmp",
      "bart-feedback-resolved-integration-" + Date.now(),
    );
    mkdirSync(tmpDir, { recursive: true });
    const tasksPath = join(tmpDir, "tasks.json");
    const taskMdPath = join(tmpDir, "task-A1.md");
    writeFileSync(taskMdPath, "### Task A1\nBuild the endpoint.\n");

    // Simulate: first review fails, then passes
    appendReviewFeedback(taskMdPath, ["Missing validation"]);
    markReviewFeedbackResolved(taskMdPath);

    const task: Task = {
      id: "A1",
      workstream: "A",
      title: "Task A1",
      description: "Build the endpoint.",
      files: ["src/a.ts"],
      depends_on: [],
      status: "pending",
      files_modified: [],
      started_at: null,
      completed_at: null,
      error: null,
    };
    const prompt = buildTaskPrompt(
      task,
      tasksPath,
      "",
      "\n\n## Self-Review\nCheck.",
    );

    // Both feedback and resolved marker visible in agent prompt
    expect(prompt).toContain("### Attempt 1 — REJECTED");
    expect(prompt).toContain("- Missing validation");
    expect(prompt).toContain("### Resolved");
    expect(prompt).toContain(
      "All previous review issues have been addressed. Review passed.",
    );

    rmSync(tmpDir, { recursive: true });
  });
});
