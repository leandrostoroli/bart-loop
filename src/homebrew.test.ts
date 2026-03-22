import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("Homebrew formula template", () => {
  const formulaPath = join(import.meta.dir, "..", "homebrew", "bart.rb");

  test("formula file exists", () => {
    expect(existsSync(formulaPath)).toBe(true);
  });

  test("declares bun as a dependency", () => {
    const content = readFileSync(formulaPath, "utf-8");
    expect(content).toContain('depends_on "bun"');
  });

  test("has url pointing to GitHub release tarball", () => {
    const content = readFileSync(formulaPath, "utf-8");
    expect(content).toMatch(
      /url\s+"https:\/\/github\.com\/leandrostoroli\/bart-loop\/archive/,
    );
  });

  test("has sha256 field", () => {
    const content = readFileSync(formulaPath, "utf-8");
    expect(content).toMatch(/sha256\s+"/);
  });

  test("has install method with bun install", () => {
    const content = readFileSync(formulaPath, "utf-8");
    expect(content).toContain("def install");
    expect(content).toMatch(/bun.*install/);
  });

  test("has test block", () => {
    const content = readFileSync(formulaPath, "utf-8");
    expect(content).toContain("test do");
    expect(content).toContain("bart");
  });
});
