import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface Standard {
  name: string;
  description: string;  // First line of text
  text: string;         // Full text body
  category: string;     // Parent ## heading
}

export class StandardsFileError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to read standards file ${filePath}: ${reason}`);
    this.name = "StandardsFileError";
  }
}

/**
 * Parse a standards markdown file into Standard objects.
 * Format:
 *   ## Category
 *   ### name
 *   Full text body (may be multi-line)
 */
export function parseStandardsFile(content: string): Standard[] {
  const standards: Standard[] = [];
  let currentCategory = "";
  let currentName = "";
  let currentLines: string[] = [];

  function flush() {
    if (currentName && currentLines.length > 0) {
      const text = currentLines.join("\n").trim();
      standards.push({
        name: currentName,
        description: text.split("\n")[0],
        text,
        category: currentCategory,
      });
    }
    currentLines = [];
  }

  for (const line of content.split("\n")) {
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      flush();
      currentCategory = line.slice(3).trim();
      currentName = "";
    } else if (line.startsWith("### ")) {
      flush();
      currentName = line.slice(4).trim();
    } else if (currentName) {
      currentLines.push(line);
    }
  }
  flush();

  return standards;
}

/**
 * Load all standards from global (~/.bart/standards.md) and project (.bart/standards.md).
 * Project standards override global ones with the same name.
 */
export function loadStandards(cwd: string): Standard[] {
  const globalPath = join(process.env.HOME || "", ".bart", "standards.md");
  const projectPath = join(cwd, ".bart", "standards.md");

  let globalStandards: Standard[] = [];
  let projectStandards: Standard[] = [];

  if (existsSync(globalPath)) {
    try {
      globalStandards = parseStandardsFile(readFileSync(globalPath, "utf-8"));
    } catch (err: unknown) {
      throw new StandardsFileError(globalPath, err);
    }
  }

  if (existsSync(projectPath)) {
    try {
      projectStandards = parseStandardsFile(readFileSync(projectPath, "utf-8"));
    } catch (err: unknown) {
      throw new StandardsFileError(projectPath, err);
    }
  }

  // Merge: project overrides global by name
  const merged = new Map<string, Standard>();
  for (const s of globalStandards) {
    merged.set(s.name, s);
  }
  for (const s of projectStandards) {
    merged.set(s.name, s);
  }

  return Array.from(merged.values());
}

/**
 * Resolve specific standard names to their full Standard objects.
 * Returns only standards that match the given names.
 */
export function resolveStandards(names: string[] | undefined, cwd: string): Standard[] {
  if (!names || names.length === 0) return [];
  const all = loadStandards(cwd);
  return names
    .map(name => all.find(s => s.name === name))
    .filter((s): s is Standard => s !== undefined);
}

/**
 * Print all loaded standards grouped by category.
 * If a name filter is given, print only that standard's full text.
 */
export function printStandards(cwd: string, nameFilter?: string): void {
  const all = loadStandards(cwd);

  if (all.length === 0) {
    console.log("No standards found.");
    console.log("  Add standards to .bart/standards.md (project) or ~/.bart/standards.md (global).");
    return;
  }

  if (nameFilter) {
    const match = all.find(s => s.name === nameFilter);
    if (!match) {
      console.error(`Standard "${nameFilter}" not found.`);
      console.log(`  Available: ${all.map(s => s.name).join(", ")}`);
      process.exit(1);
    }
    console.log(`\n### ${match.name}  [${match.category || "uncategorized"}]\n`);
    console.log(match.text);
    console.log("");
    return;
  }

  // Group by category
  const byCategory = new Map<string, Standard[]>();
  for (const s of all) {
    const cat = s.category || "Uncategorized";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(s);
  }

  console.log(`\n📏 Standards (${all.length}):\n`);
  for (const [category, standards] of byCategory) {
    console.log(`  ${category}`);
    for (const s of standards) {
      console.log(`    ${s.name} — ${s.description}`);
    }
    console.log("");
  }

  console.log(`Use 'bart standards <name>' to view full text of a standard.`);
}
