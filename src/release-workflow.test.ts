import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("Release workflow", () => {
  const workflowPath = join(
    import.meta.dir,
    "..",
    ".github",
    "workflows",
    "release.yml",
  );

  test("workflow file exists", () => {
    expect(existsSync(workflowPath)).toBe(true);
  });

  test("triggers on push to main", () => {
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("push");
    expect(content).toContain("main");
  });

  test("has a release creation job", () => {
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("gh release create");
  });

  test("tags releases with version from package.json", () => {
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("package.json");
  });
});

describe("Formula update job", () => {
  const workflowPath = join(
    import.meta.dir,
    "..",
    ".github",
    "workflows",
    "release.yml",
  );

  test("has an update-formula job", () => {
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("update-formula");
  });

  test("update-formula job depends on release job", () => {
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toMatch(/needs:\s*\[?\s*release/);
  });

  test("computes sha256 of the tarball", () => {
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("sha256");
  });

  test("pushes to homebrew-bart repo", () => {
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("homebrew-bart");
  });

  test("uses HOMEBREW_TAP_TOKEN secret", () => {
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("HOMEBREW_TAP_TOKEN");
  });

  test("creates Formula directory before copying", () => {
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("mkdir -p tap-repo/Formula");
  });
});
