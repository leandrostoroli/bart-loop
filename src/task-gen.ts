import type { TestingMetadata } from "./constants.js";

export interface GenerateTaskMarkdownOptions {
  taskId: string;
  rawContent: string;
  planContent: string;
  requirements: string[];
  specialistPremises?: string;
  testExpectations?: string[];
  testingMeta?: TestingMetadata;
}

/**
 * An agent runner function that takes a prompt and returns the LLM output.
 * In production, this spawns a real agent process (claude/opencode).
 * In tests, this can be replaced with a mock.
 */
export type AgentRunner = (prompt: string) => Promise<string>;

/**
 * Build the prompt sent to the LLM for generating a structured task markdown file.
 * This is a pure function — no side effects — making it fully testable.
 */
export function buildTaskGenPrompt(opts: GenerateTaskMarkdownOptions): string {
  const {
    taskId,
    rawContent,
    planContent,
    requirements,
    specialistPremises,
    testExpectations,
    testingMeta,
  } = opts;

  let prompt = `You are generating a structured task markdown file for task ${taskId} in an automated execution pipeline.

## Full Plan Context

${planContent}

## Raw Task Content

${rawContent}

## Task Requirements

${requirements.length > 0 ? requirements.map((r) => `- ${r}`).join("\n") : "No specific requirements tagged for this task."}`;

  if (specialistPremises) {
    prompt += `

## Specialist Standards

Apply these specialist standards when generating the task:
${specialistPremises}`;
  }

  if (testExpectations && testExpectations.length > 0) {
    prompt += `

## Specialist Test Expectations

The specialist requires these test coverage expectations:
${testExpectations.map((e) => `- ${e}`).join("\n")}`;
  }

  if (testingMeta) {
    prompt += `

## Testing Configuration`;
    if (testingMeta.test_command)
      prompt += `\nTest command: ${testingMeta.test_command}`;
    if (testingMeta.framework)
      prompt += `\nFramework: ${testingMeta.framework}`;
    if (testingMeta.conventions)
      prompt += `\nConventions: ${testingMeta.conventions}`;
  }

  prompt += `

## Instructions

Generate a structured task markdown file with EXACTLY these sections:

### ## Scope
Describe what this task does and what it explicitly does NOT do. Be specific and concise.

### ## Requirements
List which requirement IDs (REQ-XX) this task covers, with a brief explanation of what each means in this context.

### ## Definition of Done
Provide specific, measurable criteria for task completion. Each item should be verifiable — not vague or subjective.

### ## Tests
Include comprehensive test code for this task. If the raw task content already contains tests, preserve and expand them. If the raw task content does NOT contain tests, generate appropriate tests (unit, integration, acceptance, or e2e as needed).

Tests must:
- Use the project's test framework and conventions
- Cover the main functionality, edge cases, and error handling
- Include test commands and expected outcomes
- Be concrete and runnable, not placeholder stubs

Output ONLY the markdown content. Do not wrap in code fences or add explanatory text outside the markdown.`;

  return prompt;
}

/**
 * Generate a structured task markdown file by sending the constructed prompt to an LLM.
 *
 * @param opts - Task generation options (content, plan, specialist context, etc.)
 * @param runAgent - Agent runner function. Defaults to a real agent process in production.
 *                   Tests inject a mock here.
 * @returns The generated markdown string.
 */
export async function generateTaskMarkdown(
  opts: GenerateTaskMarkdownOptions,
  runAgent: AgentRunner,
): Promise<string> {
  const prompt = buildTaskGenPrompt(opts);
  return runAgent(prompt);
}
