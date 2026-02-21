import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, mkdirSync } from "fs";
import { join, basename, extname } from "path";
import { Specialist, Task, HistoryEntry, HISTORY_FILE, BART_DIR } from "./constants.js";

const HOME = process.env.HOME || "";

/**
 * Parse YAML frontmatter from a markdown file's content.
 * Returns key-value pairs from the --- delimited block.
 */
export function parseFrontmatter(content: string): Record<string, any> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, any> = {};
  let currentKey = "";
  let currentValue = "";
  let inMultiline = false;
  let inList = false;
  let listItems: string[] = [];

  for (const line of yaml.split("\n")) {
    // List item continuation
    if (inList && line.match(/^\s+-\s+/)) {
      listItems.push(line.replace(/^\s+-\s+/, "").trim());
      continue;
    }

    // Flush previous list
    if (inList) {
      result[currentKey] = listItems;
      inList = false;
      listItems = [];
    }

    // Multiline value continuation (indented lines under a key with |)
    if (inMultiline) {
      if (line.match(/^\s+/) && !line.match(/^\w+:/)) {
        currentValue += (currentValue ? "\n" : "") + line.trimEnd();
        continue;
      } else {
        result[currentKey] = currentValue.trim();
        inMultiline = false;
      }
    }

    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();

      if (val === "|" || val === ">") {
        inMultiline = true;
        currentValue = "";
      } else if (val === "") {
        // Could be start of a list
        inList = true;
        listItems = [];
      } else {
        result[currentKey] = val;
      }
    }
  }

  // Flush remaining
  if (inMultiline) {
    result[currentKey] = currentValue.trim();
  }
  if (inList && listItems.length > 0) {
    result[currentKey] = listItems;
  }

  return result;
}

/**
 * Scan a directory for .md files and return specialist entries.
 */
function scanDirectory(dir: string, type: Specialist["type"]): Specialist[] {
  if (!existsSync(dir)) return [];
  const specialists: Specialist[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && (entry.endsWith(".md") || entry.endsWith(".skill"))) {
        const content = readFileSync(fullPath, "utf-8");
        const fm = parseFrontmatter(content);
        const name = fm.name || basename(entry, extname(entry));
        const description = fm.description || "";

        if (name) {
          const tools = fm.tools || fm["allowed-tools"];
          specialists.push({
            name,
            description: typeof description === "string" ? description.split("\n")[0].trim() : String(description),
            type,
            path: fullPath,
            tools: Array.isArray(tools) ? tools : tools ? tools.split(/,\s*/) : undefined,
          });
        }
      }
    }
  } catch {}

  return specialists;
}

/**
 * Scan plugin skills directories (nested structure).
 * Searches marketplaces for skills, agents, and commands.
 */
/**
 * Scan a single plugin directory for skills, agents, and commands.
 */
function scanPluginDir(pluginDir: string, specialists: Specialist[]) {
  // Scan skills/*/SKILL.md
  const skillsDir = join(pluginDir, "skills");
  if (existsSync(skillsDir)) {
    for (const skillName of readdirSync(skillsDir)) {
      const skillDir = join(skillsDir, skillName);
      if (!statSync(skillDir).isDirectory()) continue;
      const skillFile = join(skillDir, "SKILL.md");
      if (existsSync(skillFile)) {
        const content = readFileSync(skillFile, "utf-8");
        const fm = parseFrontmatter(content);
        const name = fm.name || skillName;
        specialists.push({
          name,
          description: typeof fm.description === "string" ? fm.description.split("\n")[0].trim() : "",
          type: "skill",
          path: skillFile,
          tools: fm["allowed-tools"] || fm.tools || undefined,
        });
      }
    }
  }

  // Also check for standalone SKILL.md at plugin root
  const rootSkill = join(pluginDir, "SKILL.md");
  if (existsSync(rootSkill)) {
    const content = readFileSync(rootSkill, "utf-8");
    const fm = parseFrontmatter(content);
    const name = fm.name || basename(pluginDir);
    if (name) {
      specialists.push({
        name,
        description: typeof fm.description === "string" ? fm.description.split("\n")[0].trim() : "",
        type: "skill",
        path: rootSkill,
        tools: fm["allowed-tools"] || fm.tools || undefined,
      });
    }
  }

  // Scan agents/*.md
  const agentsDir = join(pluginDir, "agents");
  specialists.push(...scanDirectory(agentsDir, "agent"));

  // Scan commands/*.md
  const commandsDir = join(pluginDir, "commands");
  specialists.push(...scanDirectory(commandsDir, "command"));
}

/**
 * Scan plugin skills directories (nested structure).
 * Searches marketplaces for skills, agents, and commands.
 * Handles both standard structure (marketplaces/<name>/plugins/<plugin>/)
 * and flat structure (marketplaces/<name>/<plugin>/ with .claude-plugin dir).
 */
function scanPlugins(pluginsDir: string): Specialist[] {
  if (!existsSync(pluginsDir)) return [];
  const specialists: Specialist[] = [];

  try {
    // Scan marketplaces
    const marketplacesDir = join(pluginsDir, "marketplaces");
    if (!existsSync(marketplacesDir)) return [];

    for (const marketplace of readdirSync(marketplacesDir)) {
      const mpDir = join(marketplacesDir, marketplace);
      if (!statSync(mpDir).isDirectory()) continue;

      // Standard structure: marketplaces/<name>/plugins/<plugin>/
      const mpPluginsDir = join(mpDir, "plugins");
      if (existsSync(mpPluginsDir)) {
        for (const plugin of readdirSync(mpPluginsDir)) {
          const pluginDir = join(mpPluginsDir, plugin);
          if (!statSync(pluginDir).isDirectory()) continue;
          scanPluginDir(pluginDir, specialists);
        }
      }

      // Flat structure: marketplaces/<name>/<subdir>/ with .claude-plugin or skills/agents/commands
      for (const entry of readdirSync(mpDir)) {
        if (entry === "plugins" || entry.startsWith(".") || entry === "node_modules") continue;
        const subDir = join(mpDir, entry);
        if (!statSync(subDir).isDirectory()) continue;

        // Check if this subdirectory is a plugin (has .claude-plugin, skills, agents, or commands)
        const hasPlugin = existsSync(join(subDir, ".claude-plugin"));
        const hasSkills = existsSync(join(subDir, "skills"));
        const hasAgents = existsSync(join(subDir, "agents"));
        const hasCommands = existsSync(join(subDir, "commands"));
        const hasRootSkill = existsSync(join(subDir, "SKILL.md"));

        if (hasPlugin || hasSkills || hasAgents || hasCommands || hasRootSkill) {
          scanPluginDir(subDir, specialists);
        }
      }
    }
  } catch {}

  return specialists;
}

/**
 * Discover all available specialists from Claude Code directories.
 * Scans project-local then global: commands, agents, plugins, skills.
 */
export function discoverSpecialists(cwd?: string): Specialist[] {
  const projectRoot = cwd || process.cwd();
  const seen = new Set<string>();
  const specialists: Specialist[] = [];

  const add = (s: Specialist) => {
    // Deduplicate by name (first found wins — project-local takes priority)
    if (!seen.has(s.name)) {
      seen.add(s.name);
      specialists.push(s);
    }
  };

  // 1. Project-local commands
  for (const s of scanDirectory(join(projectRoot, ".claude", "commands"), "command")) add(s);
  // 2. Project-local agents
  for (const s of scanDirectory(join(projectRoot, ".claude", "agents"), "agent")) add(s);
  // 3. Global commands
  for (const s of scanDirectory(join(HOME, ".claude", "commands"), "command")) add(s);
  // 4. Global agents
  for (const s of scanDirectory(join(HOME, ".claude", "agents"), "agent")) add(s);
  // 5. Plugin skills, agents, commands
  for (const s of scanPlugins(join(HOME, ".claude", "plugins"))) add(s);
  // 6. Standalone skill files
  for (const s of scanDirectory(join(HOME, ".claude", "skills"), "skill")) add(s);

  return specialists;
}

/**
 * Match a task to the best specialist.
 *
 * Matching strategy (in priority order):
 * 1. Explicit tag in task title: [specialist-name]
 * 2. File extension heuristics (.tsx → frontend specialists)
 * 3. Keyword matching between task description and specialist description
 */
export function matchSpecialist(task: Task, specialists: Specialist[]): Specialist | null {
  if (specialists.length === 0) return null;

  // 1. Explicit tag: [specialist-name] in title
  const tagMatch = task.title.match(/\[([^\]]+)\]/);
  if (tagMatch) {
    const tagName = tagMatch[1].toLowerCase();
    const found = specialists.find(s => s.name.toLowerCase() === tagName);
    if (found) return found;
  }

  // 2. File extension heuristics
  const extKeywords: Record<string, string[]> = {
    ".tsx": ["frontend", "react", "ui", "component", "view"],
    ".jsx": ["frontend", "react", "ui", "component", "view"],
    ".css": ["frontend", "style", "ui", "design"],
    ".scss": ["frontend", "style", "ui", "design"],
    ".sql": ["database", "query", "migration", "schema"],
    ".prisma": ["database", "schema", "orm"],
    ".test.ts": ["test", "testing", "spec"],
    ".spec.ts": ["test", "testing", "spec"],
    ".tf": ["infrastructure", "terraform", "deploy"],
    ".yml": ["config", "ci", "deploy", "pipeline"],
    ".yaml": ["config", "ci", "deploy", "pipeline"],
    ".dockerfile": ["docker", "container", "deploy"],
  };

  const taskFiles = task.files || [];
  const fileKeywords = new Set<string>();
  for (const file of taskFiles) {
    for (const [ext, keywords] of Object.entries(extKeywords)) {
      if (file.endsWith(ext)) {
        keywords.forEach(k => fileKeywords.add(k));
      }
    }
  }

  if (fileKeywords.size > 0) {
    let bestMatch: Specialist | null = null;
    let bestScore = 0;

    for (const s of specialists) {
      const desc = s.description.toLowerCase();
      let score = 0;
      for (const keyword of fileKeywords) {
        if (desc.includes(keyword)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = s;
      }
    }

    if (bestMatch && bestScore >= 2) return bestMatch;
  }

  // 3. Keyword matching between task description and specialist description
  const taskWords = (task.title + " " + task.description)
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 3);

  let bestMatch: Specialist | null = null;
  let bestScore = 0;

  for (const s of specialists) {
    const descWords = s.description.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    let score = 0;
    for (const word of taskWords) {
      if (descWords.includes(word)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = s;
    }
  }

  // Require a minimum keyword overlap to avoid weak matches
  if (bestMatch && bestScore >= 2) return bestMatch;

  return null;
}

/**
 * Print discovered specialists in a formatted table.
 */
export function printSpecialists(specialists: Specialist[]) {
  if (specialists.length === 0) {
    console.log("\nNo specialists found.");
    console.log("Specialists are discovered from:");
    console.log("  ./.claude/commands/    Project-local commands");
    console.log("  ./.claude/agents/      Project-local agents");
    console.log("  ~/.claude/commands/    Global commands");
    console.log("  ~/.claude/agents/      Global agents");
    console.log("  ~/.claude/plugins/     Plugin skills, agents, commands");
    console.log("  ~/.claude/skills/      Standalone skill files\n");
    return;
  }

  console.log(`\nFound ${specialists.length} specialist(s):\n`);

  const typeIcon = (t: Specialist["type"]) => {
    switch (t) {
      case "agent": return "A";
      case "skill": return "S";
      case "command": return "C";
    }
  };

  for (const s of specialists) {
    const icon = typeIcon(s.type);
    const desc = s.description.length > 60
      ? s.description.substring(0, 57) + "..."
      : s.description;
    console.log(`  [${icon}] ${s.name}`);
    console.log(`      ${desc}`);
    console.log(`      ${s.path}`);
  }
  console.log("");
}

// --- History tracking ---

export interface SpecialistStats {
  name: string;
  total: number;
  completed: number;
  errored: number;
  avg_duration_ms: number | null;
  reset_rate: number;       // resets / total (0.0 - 1.0)
  total_resets: number;
}

/**
 * Extract plan slug from a tasks.json path.
 * e.g. ".bart/plans/my-feature/tasks.json" → "my-feature"
 * Falls back to "_legacy" for .bart/tasks.json or unknown paths.
 */
export function extractPlanSlug(tasksPath: string): string {
  const match = tasksPath.match(/\.bart\/plans\/([^/]+)\/tasks\.json/);
  return match ? match[1] : "_legacy";
}

/**
 * Append a single history entry as a JSONL line to .bart/history.jsonl.
 * Creates the file and .bart/ directory if needed.
 */
export function appendHistory(cwd: string, entry: HistoryEntry): void {
  const bartDir = join(cwd, BART_DIR);
  if (!existsSync(bartDir)) {
    mkdirSync(bartDir, { recursive: true });
  }
  const historyPath = join(bartDir, HISTORY_FILE);
  appendFileSync(historyPath, JSON.stringify(entry) + "\n");
}

/**
 * Load all history entries from .bart/history.jsonl.
 * Skips malformed lines silently.
 */
export function loadHistory(cwd: string): HistoryEntry[] {
  const historyPath = join(cwd, BART_DIR, HISTORY_FILE);
  if (!existsSync(historyPath)) return [];

  const entries: HistoryEntry[] = [];
  const content = readFileSync(historyPath, "utf-8");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

/**
 * Count the number of reset events for a specific task+plan combination.
 */
export function countResetsForTask(cwd: string, taskId: string, planSlug: string): number {
  const entries = loadHistory(cwd);
  return entries.filter(
    e => e.event === "reset" && e.task_id === taskId && e.plan_slug === planSlug
  ).length;
}

/**
 * Count distinct tasks that are currently errored in a workstream+plan combination.
 * Excludes tasks that were later completed (reset + completed cycle).
 */
export function countWorkstreamErrors(cwd: string, workstream: string, planSlug: string): number {
  const entries = loadHistory(cwd);
  const erroredTasks = new Set(
    entries
      .filter(e => e.event === "error" && e.workstream === workstream && e.plan_slug === planSlug)
      .map(e => e.task_id)
  );
  for (const entry of entries) {
    if (entry.event === "completed" && entry.workstream === workstream && entry.plan_slug === planSlug) {
      erroredTasks.delete(entry.task_id);
    }
  }
  return erroredTasks.size;
}

/**
 * Aggregate per-specialist performance stats from history entries.
 */
export function computeSpecialistStats(entries: HistoryEntry[]): SpecialistStats[] {
  const map = new Map<string, {
    total: number;
    completed: number;
    errored: number;
    durations: number[];
    resets: number;
  }>();

  for (const e of entries) {
    const name = e.specialist || "(default agent)";

    if (!map.has(name)) {
      map.set(name, { total: 0, completed: 0, errored: 0, durations: [], resets: 0 });
    }
    const stats = map.get(name)!;

    if (e.event === "completed") {
      stats.total++;
      stats.completed++;
      if (e.duration_ms != null) stats.durations.push(e.duration_ms);
    } else if (e.event === "error") {
      stats.total++;
      stats.errored++;
    } else if (e.event === "reset") {
      stats.resets++;
    }
  }

  const result: SpecialistStats[] = [];
  for (const [name, data] of map) {
    const total = data.total;
    const avg = data.durations.length > 0
      ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length
      : null;
    result.push({
      name,
      total,
      completed: data.completed,
      errored: data.errored,
      avg_duration_ms: avg,
      reset_rate: total > 0 ? data.resets / total : 0,
      total_resets: data.resets,
    });
  }

  // Sort by total tasks descending
  result.sort((a, b) => b.total - a.total);
  return result;
}

/**
 * Print formatted specialist performance stats from execution history.
 */
export function printSpecialistHistory(cwd: string): void {
  const entries = loadHistory(cwd);
  if (entries.length === 0) {
    console.log("\nNo execution history found.");
    console.log("History is recorded when tasks are completed, errored, or reset.\n");
    return;
  }

  const stats = computeSpecialistStats(entries);

  console.log(`\nExecution History (${entries.length} events):\n`);

  // Header
  const nameW = Math.max(20, ...stats.map(s => s.name.length)) + 2;
  const header = [
    "Specialist".padEnd(nameW),
    "Done".padStart(5),
    "Err".padStart(5),
    "Resets".padStart(7),
    "Reset%".padStart(7),
    "Avg Time".padStart(10),
  ].join("  ");
  console.log(`  ${header}`);
  console.log(`  ${"─".repeat(header.length)}`);

  for (const s of stats) {
    const resetPct = s.total > 0 ? `${Math.round(s.reset_rate * 100)}%` : "—";
    const avgTime = s.avg_duration_ms != null ? formatDuration(s.avg_duration_ms) : "—";
    const row = [
      s.name.padEnd(nameW),
      String(s.completed).padStart(5),
      String(s.errored).padStart(5),
      String(s.total_resets).padStart(7),
      resetPct.padStart(7),
      avgTime.padStart(10),
    ].join("  ");
    console.log(`  ${row}`);
  }
  console.log("");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}
