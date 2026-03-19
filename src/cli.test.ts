import { describe, test, expect } from "bun:test";
import { buildTestingContextBlock, buildSelfReviewBlock } from "./cli.js";

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
    expect(block).toContain("Conventions: tests in __tests__/, named *.test.ts");
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
    expect(block).toContain("If you cannot run tests, explain why and flag for review");
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
    expect(block).toContain("Apply the specialist's standards as the quality bar");
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
    expect(block).toContain("Write tests before production code — follow the RED-GREEN-REFACTOR cycle");
    expect(block).toContain("Show actual test command output as evidence before claiming task completion");
    expect(block).toContain("Tests must verify real behavior, not mock behavior");
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
});
