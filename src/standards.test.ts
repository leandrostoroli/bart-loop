import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { parseStandardsFile, loadStandards, resolveStandards, StandardsFileError } from "./standards.js";

// =============================================================================
// parseStandardsFile
// =============================================================================

describe("parseStandardsFile", () => {
  test("parses a single standard under a category", () => {
    const content = `## Testing\n### unit-tests\nAll functions must have tests.`;
    const result = parseStandardsFile(content);
    expect(result).toEqual([
      {
        name: "unit-tests",
        description: "All functions must have tests.",
        text: "All functions must have tests.",
        category: "Testing",
      },
    ]);
  });

  test("parses multiple standards under the same category", () => {
    const content = `## Code Quality\n### lint\nRun linter.\n### format\nUse prettier.`;
    const result = parseStandardsFile(content);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("lint");
    expect(result[0].category).toBe("Code Quality");
    expect(result[1].name).toBe("format");
    expect(result[1].category).toBe("Code Quality");
  });

  test("parses standards across multiple categories", () => {
    const content = `## Frontend\n### react\nUse React.\n## Backend\n### api\nREST API.`;
    const result = parseStandardsFile(content);
    expect(result).toHaveLength(2);
    expect(result[0].category).toBe("Frontend");
    expect(result[1].category).toBe("Backend");
  });

  test("handles multi-line text body", () => {
    const content = `## Cat\n### rule\nLine one.\nLine two.\nLine three.`;
    const result = parseStandardsFile(content);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Line one.\nLine two.\nLine three.");
    expect(result[0].description).toBe("Line one.");
  });

  test("description is the first line of text", () => {
    const content = `## Cat\n### rule\nFirst line is description.\nMore details here.`;
    const result = parseStandardsFile(content);
    expect(result[0].description).toBe("First line is description.");
  });

  test("returns empty array for empty string", () => {
    expect(parseStandardsFile("")).toEqual([]);
  });

  test("returns empty array for content with no headings", () => {
    expect(parseStandardsFile("Just some plain text.")).toEqual([]);
  });

  test("returns empty array when only ## headings exist (no ### standards)", () => {
    const content = `## Category One\nSome text.\n## Category Two\nMore text.`;
    expect(parseStandardsFile(content)).toEqual([]);
  });

  test("skips ### standard that has no body text", () => {
    const content = `## Cat\n### empty-rule\n### has-body\nSome text.`;
    const result = parseStandardsFile(content);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("has-body");
  });

  test("handles ### without a preceding ## (empty category)", () => {
    const content = `### orphan-rule\nOrphan text.`;
    const result = parseStandardsFile(content);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("orphan-rule");
    expect(result[0].category).toBe("");
  });

  test("trims whitespace from category names", () => {
    const content = `##   Spaced Category  \n### rule\nText.`;
    const result = parseStandardsFile(content);
    expect(result[0].category).toBe("Spaced Category");
  });

  test("trims whitespace from standard names", () => {
    const content = `## Cat\n###   spaced-name  \nText.`;
    const result = parseStandardsFile(content);
    expect(result[0].name).toBe("spaced-name");
  });

  test("trims leading/trailing whitespace from text body", () => {
    const content = `## Cat\n### rule\n\n  Body with leading blank line.\n`;
    const result = parseStandardsFile(content);
    expect(result[0].text).toBe("Body with leading blank line.");
  });

  test("does not treat #### as a category or standard heading", () => {
    const content = `## Cat\n### rule\nBody.\n#### Sub-heading inside body.`;
    const result = parseStandardsFile(content);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("#### Sub-heading inside body.");
  });

  test("distinguishes ## from ### correctly (### inside ## line not misread)", () => {
    // "### Foo" starts with "## " AND "### ", but the code checks "### " first via else-if
    // Actually the code checks "## " and !startsWith("### ") first
    const content = `### not-a-category\nBody text.`;
    const result = parseStandardsFile(content);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("not-a-category");
    expect(result[0].category).toBe("");
  });
});

// =============================================================================
// loadStandards
// =============================================================================

describe("loadStandards", () => {
  const tmpDir = join(import.meta.dir, "__test_tmp_standards__");
  const projectDir = join(tmpDir, "project");
  const globalDir = join(tmpDir, "global_home");
  let originalHome: string | undefined;

  beforeEach(() => {
    // Clean slate
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(join(projectDir, ".bart"), { recursive: true });
    mkdirSync(join(globalDir, ".bart"), { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = globalDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array when no standards files exist", () => {
    // Use a path with no .bart/standards.md
    const emptyDir = join(tmpDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    // Global dir has .bart but no standards.md
    const result = loadStandards(emptyDir);
    expect(result).toEqual([]);
  });

  test("loads only global standards when no project file exists", () => {
    writeFileSync(
      join(globalDir, ".bart", "standards.md"),
      `## Global\n### g-rule\nGlobal rule text.`,
    );
    const emptyProject = join(tmpDir, "no_project");
    mkdirSync(emptyProject, { recursive: true });

    const result = loadStandards(emptyProject);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("g-rule");
    expect(result[0].category).toBe("Global");
  });

  test("loads only project standards when no global file exists", () => {
    // Point HOME to a dir without .bart/standards.md
    process.env.HOME = join(tmpDir, "no_global_home");
    mkdirSync(join(tmpDir, "no_global_home"), { recursive: true });

    writeFileSync(
      join(projectDir, ".bart", "standards.md"),
      `## Project\n### p-rule\nProject rule text.`,
    );

    const result = loadStandards(projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("p-rule");
  });

  test("project standards override global standards with the same name", () => {
    writeFileSync(
      join(globalDir, ".bart", "standards.md"),
      `## Global\n### shared-rule\nGlobal version.`,
    );
    writeFileSync(
      join(projectDir, ".bart", "standards.md"),
      `## Project\n### shared-rule\nProject version.`,
    );

    const result = loadStandards(projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("shared-rule");
    expect(result[0].text).toBe("Project version.");
    expect(result[0].category).toBe("Project");
  });

  test("merges global and project standards with different names", () => {
    writeFileSync(
      join(globalDir, ".bart", "standards.md"),
      `## Global\n### g-only\nGlobal only.`,
    );
    writeFileSync(
      join(projectDir, ".bart", "standards.md"),
      `## Project\n### p-only\nProject only.`,
    );

    const result = loadStandards(projectDir);
    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name);
    expect(names).toContain("g-only");
    expect(names).toContain("p-only");
  });

  test("handles malformed/empty standards files gracefully", () => {
    writeFileSync(join(globalDir, ".bart", "standards.md"), "");
    writeFileSync(join(projectDir, ".bart", "standards.md"), "no headings here");

    const result = loadStandards(projectDir);
    expect(result).toEqual([]);
  });

  test("throws StandardsFileError when global standards file is unreadable", () => {
    // Create a directory where a file is expected — readFileSync will throw EISDIR
    const globalStdPath = join(globalDir, ".bart", "standards.md");
    rmSync(globalStdPath, { force: true });
    mkdirSync(globalStdPath, { recursive: true });

    expect(() => loadStandards(projectDir)).toThrow(StandardsFileError);
  });

  test("throws StandardsFileError when project standards file is unreadable", () => {
    const projectStdPath = join(projectDir, ".bart", "standards.md");
    rmSync(projectStdPath, { force: true });
    mkdirSync(projectStdPath, { recursive: true });

    expect(() => loadStandards(projectDir)).toThrow(StandardsFileError);
  });

  test("StandardsFileError includes file path and cause", () => {
    const projectStdPath = join(projectDir, ".bart", "standards.md");
    rmSync(projectStdPath, { force: true });
    mkdirSync(projectStdPath, { recursive: true });

    try {
      loadStandards(projectDir);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(StandardsFileError);
      const sfe = err as StandardsFileError;
      expect(sfe.filePath).toBe(projectStdPath);
      expect(sfe.cause).toBeDefined();
      expect(sfe.message).toContain(projectStdPath);
    }
  });
});

// =============================================================================
// resolveStandards
// =============================================================================

describe("resolveStandards", () => {
  const tmpDir = join(import.meta.dir, "__test_tmp_resolve__");
  const projectDir = join(tmpDir, "project");
  let originalHome: string | undefined;

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(join(projectDir, ".bart"), { recursive: true });
    originalHome = process.env.HOME;
    // Point HOME to a dir with no global standards
    process.env.HOME = join(tmpDir, "home");
    mkdirSync(join(tmpDir, "home"), { recursive: true });

    writeFileSync(
      join(projectDir, ".bart", "standards.md"),
      `## Cat\n### alpha\nAlpha text.\n### beta\nBeta text.\n### gamma\nGamma text.`,
    );
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array when names is undefined", () => {
    expect(resolveStandards(undefined, projectDir)).toEqual([]);
  });

  test("returns empty array when names is empty array", () => {
    expect(resolveStandards([], projectDir)).toEqual([]);
  });

  test("returns matching standards for given names", () => {
    const result = resolveStandards(["alpha", "gamma"], projectDir);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("alpha");
    expect(result[1].name).toBe("gamma");
  });

  test("filters out names that don't match any standard", () => {
    const result = resolveStandards(["alpha", "nonexistent"], projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("alpha");
  });

  test("returns empty array when no names match", () => {
    const result = resolveStandards(["nope", "missing"], projectDir);
    expect(result).toEqual([]);
  });

  test("preserves requested order of names", () => {
    const result = resolveStandards(["gamma", "alpha", "beta"], projectDir);
    expect(result.map((s) => s.name)).toEqual(["gamma", "alpha", "beta"]);
  });

  test("returns duplicates if same name is requested multiple times", () => {
    const result = resolveStandards(["alpha", "alpha"], projectDir);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("alpha");
    expect(result[1].name).toBe("alpha");
  });
});
