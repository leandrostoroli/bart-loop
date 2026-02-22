import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join, basename, extname } from "path";
import { Specialist, Task, HistoryEntry, HISTORY_FILE, BART_DIR } from "./constants.js";

const HOME = process.env.HOME || "";

// --- ML-style Specialist Model [REQ-02] ---

const SPECIALIST_MODEL_FILE = "specialist-model.json";
const MIN_SAMPLES_FOR_TRUST = 5;

/** Features extracted from a task for matching purposes. */
export interface TaskFeatures {
  extensions: string[];   // e.g. [".ts", ".tsx", ".css"]
  keywords: string[];     // significant words from title + description
  complexity: number;     // file count as a proxy for complexity
  workstream: string;
}

/** A single recorded task-specialist pairing with its features. */
interface ModelEntry {
  specialist: string;
  features: TaskFeatures;
  success: boolean;
  timestamp: string;
}

/** The persisted specialist model structure. */
export interface SpecialistModel {
  version: number;
  entries: ModelEntry[];
}

/** Extract features from a task for model comparison. */
export function extractTaskFeatures(task: Task): TaskFeatures {
  const extensions = new Set<string>();
  for (const file of task.files || []) {
    const ext = extname(file);
    if (ext) extensions.add(ext);
  }

  const keywords = (task.title + " " + task.description)
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  const uniqueKeywords = [...new Set(keywords)];

  return {
    extensions: [...extensions],
    keywords: uniqueKeywords,
    complexity: (task.files || []).length,
    workstream: task.workstream,
  };
}

/** Common stop words to exclude from keyword extraction. */
const STOP_WORDS = new Set([
  "this", "that", "with", "from", "have", "will", "should", "would",
  "could", "into", "been", "also", "then", "than", "when", "where",
  "which", "what", "there", "their", "about", "each", "other",
  "them", "these", "those", "some", "more", "most", "only",
  "very", "just", "make", "like", "well", "back", "even", "still",
  "after", "before", "does", "done", "such", "much",
]);

/** Load the specialist model from .bart/specialist-model.json. */
export function loadSpecialistModel(cwd: string): SpecialistModel {
  const modelPath = join(cwd, BART_DIR, SPECIALIST_MODEL_FILE);
  if (!existsSync(modelPath)) return { version: 1, entries: [] };
  try {
    return JSON.parse(readFileSync(modelPath, "utf-8"));
  } catch {
    return { version: 1, entries: [] };
  }
}

/** Save the specialist model to .bart/specialist-model.json. */
export function saveSpecialistModel(cwd: string, model: SpecialistModel): void {
  const bartDir = join(cwd, BART_DIR);
  if (!existsSync(bartDir)) mkdirSync(bartDir, { recursive: true });
  const modelPath = join(bartDir, SPECIALIST_MODEL_FILE);
  writeFileSync(modelPath, JSON.stringify(model, null, 2));
}

/**
 * Record a task-specialist pairing outcome in the model.
 * Called after task completion or error to teach the model.
 */
export function recordPairing(cwd: string, task: Task, success: boolean): void {
  if (!task.specialist) return;
  const model = loadSpecialistModel(cwd);
  const features = extractTaskFeatures(task);
  model.entries.push({
    specialist: task.specialist,
    features,
    success,
    timestamp: new Date().toISOString(),
  });
  saveSpecialistModel(cwd, model);
}

/**
 * Compute feature similarity between two task feature sets.
 * Returns 0.0 - 1.0 based on extension overlap, keyword overlap, and complexity proximity.
 */
function featureSimilarity(a: TaskFeatures, b: TaskFeatures): number {
  let score = 0;
  let factors = 0;

  // Extension overlap (Jaccard similarity)
  if (a.extensions.length > 0 || b.extensions.length > 0) {
    const setA = new Set(a.extensions);
    const setB = new Set(b.extensions);
    const intersection = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    score += union > 0 ? intersection / union : 0;
    factors++;
  }

  // Keyword overlap (Jaccard similarity)
  if (a.keywords.length > 0 || b.keywords.length > 0) {
    const setA = new Set(a.keywords);
    const setB = new Set(b.keywords);
    const intersection = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    score += union > 0 ? intersection / union : 0;
    factors++;
  }

  // Complexity proximity (1.0 when equal, decays with distance)
  const maxComplexity = Math.max(a.complexity, b.complexity, 1);
  const complexityDiff = Math.abs(a.complexity - b.complexity);
  score += 1 - (complexityDiff / maxComplexity);
  factors++;

  return factors > 0 ? score / factors : 0;
}

/**
 * Compute model-based confidence for a specialist on a given task.
 * Uses learned pairings to score based on:
 * - Historical success rate for this specialist on similar tasks
 * - Feature similarity between the candidate task and past successful tasks
 * Returns null if insufficient data (< MIN_SAMPLES_FOR_TRUST).
 */
export function modelConfidence(
  model: SpecialistModel,
  specialistName: string,
  taskFeatures: TaskFeatures,
): { confidence: number; sampleCount: number; rationale: string } | null {
  const entries = model.entries.filter(e => e.specialist === specialistName);
  if (entries.length < MIN_SAMPLES_FOR_TRUST) return null;

  // 1. Overall success rate for this specialist
  const successes = entries.filter(e => e.success).length;
  const successRate = successes / entries.length;

  // 2. Feature-weighted success rate (weight by similarity to current task)
  let weightedSuccess = 0;
  let totalWeight = 0;
  for (const entry of entries) {
    const sim = featureSimilarity(taskFeatures, entry.features);
    const weight = sim;
    weightedSuccess += weight * (entry.success ? 1 : 0);
    totalWeight += weight;
  }
  const weightedRate = totalWeight > 0 ? weightedSuccess / totalWeight : successRate;

  // 3. Combined confidence: 40% global success rate + 60% feature-weighted rate
  const confidence = 0.4 * successRate + 0.6 * weightedRate;

  const rationale = `Model: ${successes}/${entries.length} successes (${Math.round(successRate * 100)}% global, ${Math.round(weightedRate * 100)}% feature-weighted)`;

  return { confidence, sampleCount: entries.length, rationale };
}

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
  // 7. ~/.agents/skills/<name>/SKILL.md (shared agent skills)
  const agentsSkillsDir = join(HOME, ".agents", "skills");
  if (existsSync(agentsSkillsDir)) {
    try {
      for (const skillName of readdirSync(agentsSkillsDir)) {
        const skillDir = join(agentsSkillsDir, skillName);
        if (!statSync(skillDir).isDirectory()) continue;
        const skillFile = join(skillDir, "SKILL.md");
        if (existsSync(skillFile)) {
          const content = readFileSync(skillFile, "utf-8");
          const fm = parseFrontmatter(content);
          const name = fm.name || skillName;
          add({
            name,
            description: typeof fm.description === "string" ? fm.description.split("\n")[0].trim() : "",
            type: "skill",
            path: skillFile,
            tools: fm["allowed-tools"] || fm.tools || undefined,
          });
        }
      }
    } catch {}
  }

  return specialists;
}

/**
 * Match a task to the best specialist.
 *
 * Matching strategy (in priority order):
 * 1. Explicit tag in task title: [specialist-name]
 * 2. ML model-based matching (if model has enough data) [REQ-02]
 * 3. File extension heuristics (.tsx → frontend specialists)
 * 4. Keyword matching between task description and specialist description
 */
const AUTO_MATCH_CONFIDENCE_THRESHOLD = 80;

export function matchSpecialist(task: Task, specialists: Specialist[], model?: SpecialistModel): Specialist | null {
  if (specialists.length === 0) return null;

  // 1. Explicit tag: [specialist-name] in title — always 100% confidence
  const tagMatch = task.title.match(/\[([^\]]+)\]/);
  if (tagMatch) {
    const tagName = tagMatch[1].toLowerCase();
    const found = specialists.find(s => s.name.toLowerCase() === tagName);
    if (found) return found;
  }

  // 2. ML model-based matching [REQ-02]: use learned pairings if enough data
  if (model && model.entries.length >= MIN_SAMPLES_FOR_TRUST) {
    const taskFeatures = extractTaskFeatures(task);
    let bestModelMatch: Specialist | null = null;
    let bestModelConfidence = 0;

    for (const s of specialists) {
      const mc = modelConfidence(model, s.name, taskFeatures);
      if (mc && mc.confidence > bestModelConfidence) {
        bestModelConfidence = mc.confidence;
        bestModelMatch = s;
      }
    }

    if (bestModelMatch && bestModelConfidence * 100 >= AUTO_MATCH_CONFIDENCE_THRESHOLD) {
      return bestModelMatch;
    }
  }

  // 3. File extension heuristics
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

    if (bestMatch && bestScore >= 2) {
      const confidence = Math.round((bestScore / fileKeywords.size) * 100);
      if (confidence >= AUTO_MATCH_CONFIDENCE_THRESHOLD) return bestMatch;
    }
  }

  // 4. Keyword matching between task description and specialist description
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

  if (bestMatch && bestScore >= 2) {
    const confidence = taskWords.length > 0
      ? Math.round((bestScore / taskWords.length) * 100)
      : 0;
    if (confidence >= AUTO_MATCH_CONFIDENCE_THRESHOLD) return bestMatch;
  }

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
    console.log("  ~/.claude/skills/      Standalone skill files");
    console.log("  ~/.agents/skills/      Shared agent skills\n");
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

export interface ScoredSpecialist {
  specialist: Specialist;
  confidence: number;   // 0.0 - 1.0
  rationale: string[];  // reasons contributing to the score
}

/**
 * Score all specialists against a task description and file list.
 * Returns a ranked list sorted by confidence descending.
 * When a specialist model is provided, integrates learned pairings into scoring.
 */
export function scoreSpecialists(
  description: string,
  files: string[],
  specialists: Specialist[],
  history?: HistoryEntry[],
  model?: SpecialistModel,
): ScoredSpecialist[] {
  if (specialists.length === 0) return [];

  const results: ScoredSpecialist[] = [];

  // Pre-compute task keywords
  const taskWords = description
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 3);

  // File extension → keyword sets
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

  const fileKeywords = new Set<string>();
  for (const file of files) {
    for (const [ext, keywords] of Object.entries(extKeywords)) {
      if (file.endsWith(ext)) {
        keywords.forEach(k => fileKeywords.add(k));
      }
    }
  }

  // Build history stats per specialist
  const historyStats = new Map<string, { completed: number; errored: number; avgMs: number | null }>();
  if (history && history.length > 0) {
    for (const e of history) {
      const name = e.specialist || "";
      if (!name) continue;
      if (!historyStats.has(name)) {
        historyStats.set(name, { completed: 0, errored: 0, avgMs: null });
      }
      const stats = historyStats.get(name)!;
      if (e.event === "completed") {
        stats.completed++;
      } else if (e.event === "error") {
        stats.errored++;
      }
    }
    // Compute avg duration from completed entries
    const durationMap = new Map<string, number[]>();
    for (const e of history) {
      if (e.event === "completed" && e.specialist && e.duration_ms != null) {
        if (!durationMap.has(e.specialist)) durationMap.set(e.specialist, []);
        durationMap.get(e.specialist)!.push(e.duration_ms);
      }
    }
    for (const [name, durations] of durationMap) {
      const stats = historyStats.get(name);
      if (stats) {
        stats.avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
      }
    }
  }

  for (const s of specialists) {
    let score = 0;
    const rationale: string[] = [];
    const descLower = s.description.toLowerCase();
    const descWords = descLower.split(/\W+/).filter(w => w.length > 3);

    // 1. Keyword overlap between task description and specialist description
    let kwOverlap = 0;
    const matchedWords: string[] = [];
    for (const word of taskWords) {
      if (descWords.includes(word)) {
        kwOverlap++;
        matchedWords.push(word);
      }
    }
    if (kwOverlap > 0) {
      const kwScore = Math.min(kwOverlap * 0.12, 0.5);
      score += kwScore;
      rationale.push(`${kwOverlap} keyword match${kwOverlap > 1 ? "es" : ""}: ${matchedWords.slice(0, 5).join(", ")}`);
    }

    // 2. File extension heuristic match
    if (fileKeywords.size > 0) {
      let fileScore = 0;
      const matchedFileKw: string[] = [];
      for (const keyword of fileKeywords) {
        if (descLower.includes(keyword)) {
          fileScore++;
          matchedFileKw.push(keyword);
        }
      }
      if (fileScore > 0) {
        const fsNorm = Math.min(fileScore * 0.1, 0.3);
        score += fsNorm;
        rationale.push(`File-type match: ${matchedFileKw.join(", ")}`);
      }
    }

    // 3. Specialist name match in task description
    const nameLower = s.name.toLowerCase();
    if (description.toLowerCase().includes(nameLower) && nameLower.length > 3) {
      score += 0.2;
      rationale.push(`Name "${s.name}" found in task description`);
    }

    // 4. History-based scoring
    const stats = historyStats.get(s.name);
    if (stats && (stats.completed + stats.errored) > 0) {
      const total = stats.completed + stats.errored;
      const successRate = stats.completed / total;
      if (total >= 3 && successRate >= 0.8) {
        score += 0.15;
        rationale.push(`Strong track record: ${stats.completed}/${total} tasks succeeded`);
      } else if (total >= 3 && successRate < 0.5) {
        score -= 0.1;
        rationale.push(`Poor track record: ${stats.completed}/${total} tasks succeeded`);
      } else if (total > 0) {
        rationale.push(`History: ${stats.completed}/${total} completed`);
      }
    }

    // 5. Type bonus (skills and agents tend to be more specialized)
    if (s.type === "agent" || s.type === "skill") {
      score += 0.05;
    }

    // 6. ML model-based scoring [REQ-02]: learned task-specialist pairings
    if (model && model.entries.length > 0) {
      const taskFeatures: TaskFeatures = {
        extensions: [...new Set(files.map(f => extname(f)).filter(Boolean))],
        keywords: description.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)),
        complexity: files.length,
        workstream: "",
      };
      const mc = modelConfidence(model, s.name, taskFeatures);
      if (mc) {
        // Model has enough samples — blend model confidence with heuristic score
        // Give model 50% weight when trusted (>= MIN_SAMPLES)
        score = 0.5 * score + 0.5 * mc.confidence;
        rationale.push(mc.rationale);
      }
    }

    // Clamp confidence 0-1
    const confidence = Math.max(0, Math.min(1, score));

    if (confidence > 0) {
      results.push({ specialist: s, confidence, rationale });
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

/**
 * Print a board view of specialists grouped by effectiveness.
 * Groups: Effective (>=80% success, low resets), Needs Attention (<80% or high resets), Untested (<3 tasks).
 */
export function printSpecialistBoard(specialists: Specialist[], cwd: string): void {
  const entries = loadHistory(cwd);
  const statsMap = new Map<string, SpecialistStats>();
  if (entries.length > 0) {
    for (const s of computeSpecialistStats(entries)) {
      statsMap.set(s.name, s);
    }
  }

  // Compute last-used timestamp per specialist
  const lastUsed = new Map<string, string>();
  for (const e of entries) {
    const name = e.specialist || "";
    if (name && e.timestamp) {
      const prev = lastUsed.get(name);
      if (!prev || e.timestamp > prev) lastUsed.set(name, e.timestamp);
    }
  }

  // Categorize specialists
  const effective: { s: Specialist; stats: SpecialistStats; last: string | null }[] = [];
  const needsAttention: { s: Specialist; stats: SpecialistStats; last: string | null }[] = [];
  const untested: { s: Specialist; stats: SpecialistStats | null; last: string | null }[] = [];

  for (const s of specialists) {
    const stats = statsMap.get(s.name);
    const last = lastUsed.get(s.name) || null;

    if (!stats || stats.total < 3) {
      untested.push({ s, stats: stats || null, last });
    } else {
      const successRate = stats.total > 0 ? stats.completed / stats.total : 0;
      const resetRate = stats.reset_rate;
      if (successRate >= 0.8 && resetRate < 0.3) {
        effective.push({ s, stats, last });
      } else {
        needsAttention.push({ s, stats, last });
      }
    }
  }

  const typeIcon = (t: Specialist["type"]) => {
    switch (t) {
      case "agent": return "A";
      case "skill": return "S";
      case "command": return "C";
    }
  };

  const formatLast = (ts: string | null): string => {
    if (!ts) return "—";
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "1d ago";
    return `${diffDays}d ago`;
  };

  const printRow = (name: string, type: string, done: string, rate: string, avgTime: string, resets: string, last: string) => {
    console.log(`  [${type}] ${name.padEnd(24)} ${done.padStart(5)}  ${rate.padStart(6)}  ${avgTime.padStart(9)}  ${resets.padStart(7)}  ${last.padStart(8)}`);
  };

  const printHeader = () => {
    console.log(`  ${"".padEnd(4)}${"Name".padEnd(24)} ${"Done".padStart(5)}  ${"Rate".padStart(6)}  ${"Avg Time".padStart(9)}  ${"Resets".padStart(7)}  ${"Last".padStart(8)}`);
    console.log(`  ${"─".repeat(72)}`);
  };

  console.log(`\nSpecialist Board (${specialists.length} total)\n`);

  if (effective.length > 0) {
    console.log(`  Effective (${effective.length}):`);
    printHeader();
    for (const { s, stats, last } of effective) {
      const rate = `${Math.round((stats.completed / stats.total) * 100)}%`;
      const avgTime = stats.avg_duration_ms != null ? formatDuration(stats.avg_duration_ms) : "—";
      printRow(s.name, typeIcon(s.type), String(stats.completed), rate, avgTime, String(stats.total_resets), formatLast(last));
    }
    console.log("");
  }

  if (needsAttention.length > 0) {
    console.log(`  Needs Attention (${needsAttention.length}):`);
    printHeader();
    for (const { s, stats, last } of needsAttention) {
      const rate = stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}%` : "—";
      const avgTime = stats.avg_duration_ms != null ? formatDuration(stats.avg_duration_ms) : "—";
      printRow(s.name, typeIcon(s.type), String(stats.completed), rate, avgTime, String(stats.total_resets), formatLast(last));
    }
    console.log("");
  }

  if (untested.length > 0) {
    console.log(`  Untested (${untested.length}):`);
    printHeader();
    for (const { s, stats, last } of untested) {
      const done = stats ? String(stats.completed) : "0";
      const rate = stats && stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}%` : "—";
      const avgTime = stats?.avg_duration_ms != null ? formatDuration(stats.avg_duration_ms) : "—";
      const resets = stats ? String(stats.total_resets) : "0";
      printRow(s.name, typeIcon(s.type), done, rate, avgTime, resets, formatLast(last));
    }
    console.log("");
  }
}

/**
 * Generate recommendations for when to use a specialist
 * based on description keywords, file type affinities, and performance history.
 */
function generateRecommendations(
  s: Specialist,
  stats: SpecialistStats | undefined,
  entries: HistoryEntry[],
): string[] {
  const recs: string[] = [];
  const descLower = s.description.toLowerCase();

  // File type affinity from history
  const fileExts = new Map<string, number>();
  for (const e of entries) {
    if (e.specialist !== s.name || e.event !== "completed") continue;
    for (const file of e.files || []) {
      const ext = extname(file);
      if (ext) fileExts.set(ext, (fileExts.get(ext) || 0) + 1);
    }
  }
  if (fileExts.size > 0) {
    const sorted = [...fileExts.entries()].sort((a, b) => b[1] - a[1]);
    const topExts = sorted.slice(0, 3).map(([ext]) => `\`${ext}\``).join(", ");
    recs.push(`Strong with ${topExts} files`);
  }

  // Performance-based recommendations
  if (stats && stats.total >= 3) {
    const successRate = stats.completed / stats.total;
    if (successRate >= 0.9 && stats.reset_rate < 0.1) {
      recs.push("Highly reliable — completes tasks consistently");
    } else if (successRate >= 0.8) {
      recs.push("Reliable — good success rate");
    } else if (successRate < 0.5) {
      recs.push("Use with caution — low success rate, consider alternatives");
    }
    if (stats.avg_duration_ms != null) {
      if (stats.avg_duration_ms < 60000) recs.push("Fast execution — good for quick tasks");
      else if (stats.avg_duration_ms > 180000) recs.push("Long execution time — best for complex tasks");
    }
  }

  // Keyword-based suggestions from description
  const kwMap: Record<string, string> = {
    "review": "Use for code review and quality checks",
    "test": "Use for testing-related tasks",
    "frontend": "Best for UI and frontend work",
    "database": "Use for database and schema tasks",
    "deploy": "Use for deployment and infrastructure tasks",
    "security": "Use for security audits and vulnerability checks",
    "refactor": "Use for code refactoring and cleanup",
    "documentation": "Use for documentation tasks",
    "hook": "Use for hook and automation development",
    "plugin": "Use for plugin structure and development",
    "architecture": "Use for architectural design and planning",
  };
  for (const [kw, rec] of Object.entries(kwMap)) {
    if (descLower.includes(kw) && recs.length < 4) {
      recs.push(rec);
    }
  }

  return recs;
}

/**
 * Generate .bart/specialists.md summary content.
 * Includes specialist details, performance stats, and usage recommendations.
 */
export function generateSpecialistsSummary(specialists: Specialist[], cwd: string): string {
  const entries = loadHistory(cwd);
  const statsMap = new Map<string, SpecialistStats>();
  if (entries.length > 0) {
    for (const s of computeSpecialistStats(entries)) {
      statsMap.set(s.name, s);
    }
  }

  const lines: string[] = [];
  lines.push("# Specialists");
  lines.push("");
  lines.push(`> Auto-generated summary of ${specialists.length} discovered specialist(s).`);
  lines.push(`> Last updated: ${new Date().toISOString()}`);
  lines.push("");

  for (const s of specialists) {
    lines.push(`## ${s.name} (${s.type})`);
    lines.push("");
    if (s.description) lines.push(s.description);
    lines.push("");
    lines.push(`- **Path:** \`${s.path}\``);
    if (s.tools && Array.isArray(s.tools) && s.tools.length > 0) {
      lines.push(`- **Tools:** ${s.tools.join(", ")}`);
    }

    const stats = statsMap.get(s.name);
    if (stats && stats.total > 0) {
      const rate = Math.round((stats.completed / stats.total) * 100);
      const avgTime = stats.avg_duration_ms != null ? formatDuration(stats.avg_duration_ms) : "n/a";
      lines.push("");
      lines.push("**Performance:**");
      lines.push(`| Done | Errors | Success Rate | Avg Time | Resets |`);
      lines.push(`|------|--------|-------------|----------|--------|`);
      lines.push(`| ${stats.completed} | ${stats.errored} | ${rate}% | ${avgTime} | ${stats.total_resets} |`);
    }

    const recs = generateRecommendations(s, stats, entries);
    if (recs.length > 0) {
      lines.push("");
      lines.push("**Recommendations:**");
      for (const rec of recs) {
        lines.push(`- ${rec}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
