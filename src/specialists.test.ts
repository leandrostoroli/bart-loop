import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { generateAgentFile, resolveProfileContext, writeAgentFile, syncAgentFiles } from "./specialists.js";
import type { Specialist } from "./constants.js";

const TMP = join(import.meta.dir, "__test_specialists_tmp__");

function writeSpecialistFile(name: string, content: string): string {
  const dir = join(TMP, "specialists");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  writeFileSync(path, content);
  return path;
}

function makeSpecialist(overrides: Partial<Specialist> & { name: string }): Specialist {
  return {
    description: "",
    type: "profile",
    path: "",
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// =============================================================================
// generateAgentFile
// =============================================================================

describe("generateAgentFile", () => {
  test("generates valid frontmatter with name, description, model", () => {
    const path = writeSpecialistFile(
      "backend",
      `---
name: backend
description: NestJS backend engineer
role: Backend platform engineer
---

## Premises

- Use strict typing
`,
    );
    const specialist = makeSpecialist({
      name: "backend",
      description: "NestJS backend engineer",
      role: "Backend platform engineer",
      path,
      premises: "- Use strict typing",
    });

    const result = generateAgentFile(specialist, []);

    expect(result).toContain("---");
    expect(result).toContain("name: bart-backend");
    expect(result).toContain("description: NestJS backend engineer");
    expect(result).toContain("model: sonnet");
  });

  test("includes tools in frontmatter when specified", () => {
    const path = writeSpecialistFile(
      "frontend",
      `---
name: frontend
description: React engineer
tools: Read, Write, Edit, Bash
---

## Premises

- Use functional components
`,
    );
    const specialist = makeSpecialist({
      name: "frontend",
      description: "React engineer",
      path,
      tools: ["Read", "Write", "Edit", "Bash"],
    });

    const result = generateAgentFile(specialist, []);

    expect(result).toContain("tools: Read, Write, Edit, Bash");
  });

  test("reads model from specialist frontmatter", () => {
    const path = writeSpecialistFile(
      "architect",
      `---
name: architect
description: System architect
model: opus
---

## Premises

- Design for scale
`,
    );
    const specialist = makeSpecialist({
      name: "architect",
      description: "System architect",
      path,
    });

    const result = generateAgentFile(specialist, []);

    expect(result).toContain("model: opus");
  });

  test("options.model overrides frontmatter model", () => {
    const path = writeSpecialistFile(
      "architect",
      `---
name: architect
description: System architect
model: opus
---

## Premises

- Design for scale
`,
    );
    const specialist = makeSpecialist({
      name: "architect",
      description: "System architect",
      path,
    });

    const result = generateAgentFile(specialist, [], { model: "haiku" });

    expect(result).toContain("model: haiku");
  });

  test("body contains role sentence", () => {
    const path = writeSpecialistFile(
      "backend",
      `---
name: backend
description: NestJS backend engineer
role: Backend platform engineer
---

## Premises

- Use strict typing
`,
    );
    const specialist = makeSpecialist({
      name: "backend",
      description: "NestJS backend engineer",
      role: "Backend platform engineer",
      path,
    });

    const result = generateAgentFile(specialist, []);

    expect(result).toContain("You are a Backend platform engineer.");
  });

  test("body contains premises as Guidelines & Standards", () => {
    // Use content before ## Learnings (fallback parser path) for multi-line premises
    const path = writeSpecialistFile(
      "backend",
      `---
name: backend
description: NestJS backend engineer
---

- Use strict typing
- Follow DRY principles

## Learnings
`,
    );
    const specialist = makeSpecialist({
      name: "backend",
      description: "NestJS backend engineer",
      path,
    });

    const result = generateAgentFile(specialist, []);

    expect(result).toContain("## Guidelines & Standards");
    expect(result).toContain("- Use strict typing");
    expect(result).toContain("- Follow DRY principles");
  });

  test("body includes recent learnings", () => {
    const path = writeSpecialistFile(
      "backend",
      `---
name: backend
description: NestJS backend engineer
---

## Premises

- Use strict typing

## Learnings

- **2026-03-15** | task A1 | success | 12m | Files: api.ts
- **2026-03-16** | task A2 | error | 5m | Files: db.ts
`,
    );
    const specialist = makeSpecialist({
      name: "backend",
      description: "NestJS backend engineer",
      path,
    });

    const result = generateAgentFile(specialist, []);

    expect(result).toContain("## Recent Learnings");
    expect(result).toContain("task A1 | success");
    expect(result).toContain("task A2 | error");
  });

  test("includes generated-by comment header", () => {
    const path = writeSpecialistFile(
      "backend",
      `---
name: backend
description: NestJS backend engineer
---

## Premises

- Use strict typing
`,
    );
    const specialist = makeSpecialist({
      name: "backend",
      description: "NestJS backend engineer",
      path,
    });

    const result = generateAgentFile(specialist, []);

    expect(result).toContain("<!-- Generated by bart from backend.md");
    expect(result).toContain("do not edit manually -->");
  });

  test("resolves referenced skills with invocation instructions", () => {
    const path = writeSpecialistFile(
      "backend",
      `---
name: backend
description: NestJS backend engineer
skills: code-reviewer
---

## Premises

- Use strict typing
`,
    );

    const skillPath = writeSpecialistFile(
      "code-reviewer",
      `---
name: code-reviewer
description: Reviews code for quality
---

Review all PRs for correctness and style.
`,
    );

    const specialist = makeSpecialist({
      name: "backend",
      description: "NestJS backend engineer",
      path,
      skills: ["code-reviewer"],
    });
    const codeReviewer = makeSpecialist({
      name: "code-reviewer",
      description: "Reviews code for quality",
      path: skillPath,
    });

    const result = generateAgentFile(specialist, [specialist, codeReviewer]);

    // Should have invocation list
    expect(result).toContain("## Available Skills");
    expect(result).toContain("Invoke them with the Skill tool");
    expect(result).toContain("`/code-reviewer` — Reviews code for quality");
    // Should have reference content
    expect(result).toContain("### Skill Reference");
    expect(result).toContain("#### code-reviewer");
    expect(result).toContain("Review all PRs for correctness and style.");
  });

  test("falls back to description when no role", () => {
    const path = writeSpecialistFile(
      "generic",
      `---
name: generic
description: A generic specialist
---

## Premises

- Be thorough
`,
    );
    const specialist = makeSpecialist({
      name: "generic",
      description: "A generic specialist",
      path,
    });

    const result = generateAgentFile(specialist, []);

    expect(result).toContain("You are a specialist: A generic specialist.");
  });
});

// =============================================================================
// resolveProfileContext (verify refactor didn't change behavior)
// =============================================================================

describe("resolveProfileContext", () => {
  test("returns specialist context header for profile type", () => {
    const path = writeSpecialistFile(
      "backend",
      `---
name: backend
description: NestJS backend engineer
---

## Premises

- Use strict typing
`,
    );
    const specialist = makeSpecialist({
      name: "backend",
      description: "NestJS backend engineer",
      path,
    });

    const result = resolveProfileContext(specialist, []);

    expect(result).toContain("Specialist: backend (profile)");
    expect(result).toContain("## Guidelines & Standards");
    expect(result).toContain("- Use strict typing");
  });

  test("falls back to description for non-profile specialists", () => {
    const specialist = makeSpecialist({
      name: "some-command",
      description: "A CLI command",
      type: "command",
    });

    const result = resolveProfileContext(specialist);

    expect(result).toContain("Specialist: some-command (command)");
    expect(result).toContain("Specialist context: A CLI command");
  });
});

// =============================================================================
// writeAgentFile
// =============================================================================

describe("writeAgentFile", () => {
  test("writes agent file to project .claude/agents/ for project-local specialist", () => {
    const projectRoot = join(TMP, "project");
    mkdirSync(projectRoot, { recursive: true });

    const path = writeSpecialistFile(
      "backend",
      `---
name: backend
description: NestJS backend engineer
role: Backend platform engineer
---

## Premises

- Use strict typing
`,
    );
    const specialist = makeSpecialist({
      name: "backend",
      description: "NestJS backend engineer",
      role: "Backend platform engineer",
      path,
    });

    const agentPath = writeAgentFile(specialist, [], projectRoot);

    expect(agentPath).toBe(join(projectRoot, ".claude", "agents", "bart-backend.md"));
    expect(existsSync(agentPath!)).toBe(true);
    const content = readFileSync(agentPath!, "utf-8");
    expect(content).toContain("name: bart-backend");
    expect(content).toContain("You are a Backend platform engineer.");
  });

  test("returns null for non-profile specialists", () => {
    const specialist = makeSpecialist({
      name: "some-command",
      type: "command",
    });

    const result = writeAgentFile(specialist, []);
    expect(result).toBeNull();
  });

  test("returns null when specialist has no path", () => {
    const specialist = makeSpecialist({
      name: "no-path",
      type: "profile",
      path: "",
    });

    const result = writeAgentFile(specialist, []);
    expect(result).toBeNull();
  });
});

// =============================================================================
// syncAgentFiles
// =============================================================================

describe("syncAgentFiles", () => {
  test("generates agent files for all profile specialists in project", () => {
    const projectRoot = join(TMP, "sync-project");
    const specDir = join(projectRoot, ".bart", "specialists");
    mkdirSync(specDir, { recursive: true });

    writeFileSync(
      join(specDir, "backend.md"),
      `---
name: backend
description: Backend engineer
role: Backend dev
---

## Premises

- Use TypeScript

## Learnings
`,
    );
    writeFileSync(
      join(specDir, "frontend.md"),
      `---
name: frontend
description: Frontend engineer
role: UI dev
---

## Premises

- Use React

## Learnings
`,
    );

    const written = syncAgentFiles(projectRoot);

    expect(written.length).toBe(2);
    for (const p of written) {
      expect(existsSync(p)).toBe(true);
    }
    const agentsDir = join(projectRoot, ".claude", "agents");
    expect(existsSync(join(agentsDir, "bart-backend.md"))).toBe(true);
    expect(existsSync(join(agentsDir, "bart-frontend.md"))).toBe(true);
  });

  test("returns empty array when no profile specialists exist", () => {
    const projectRoot = join(TMP, "empty-project");
    mkdirSync(projectRoot, { recursive: true });

    const written = syncAgentFiles(projectRoot);

    expect(written).toEqual([]);
  });
});
