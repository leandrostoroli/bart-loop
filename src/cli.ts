import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, chmodSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { spawn, ChildProcess } from "child_process";
import { BART, BART_DIR, DEFAULT_QUALITY_GATE } from "./constants.js";
import { readTasks, findNextTask, getCwd, getTaskById, resolvePlanTasksPath, countReviewRetriesForTask } from "./tasks.js";
import { printStatus, printWorkstreamStatus, printRequirementsReport } from "./status.js";
import { runDashboard } from "./dashboard.js";
import { runPlanCommand } from "./plan.js";
import { sendTelegram, sendTelegramTestMessage, formatTaskStarted, formatTaskCompleted, formatTaskError, formatCriticalError, formatWorkstreamCompleted, formatWorkstreamBlocked, formatMilestone, formatWorkstreamReview, formatReviewEscalation } from "./notify.js";
import { discoverSpecialists, printSpecialists, appendHistory, extractPlanSlug, countResetsForTask, countWorkstreamErrors, countWorkstreamReviewFailures, printSpecialistHistory, scoreSpecialists, loadHistory, recordPairing, loadSpecialistModel, printSpecialistBoard, generateSpecialistsSummary, appendProfileLearning, resolveProfileContext } from "./specialists.js";
import { generateZshCompletion, generateBashCompletion, installCompletions } from "./completions.js";

const CONFIG_DIR = join(process.env.HOME || "", ".bart");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface BartConfig {
  agent?: string;
  auto_continue?: boolean;
  telegram_bot_token?: string;
  telegram_chat_id?: string;
}

function loadConfig(): BartConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

function saveConfig(config: BartConfig) {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("Failed to save config:", e);
  }
}

// --- Graceful shutdown state ---
const STOP_FILE = "stop";
const LOCK_FILE = "bart.lock";
let currentChild: ChildProcess | null = null;
let currentTasksPath: string | null = null;
let currentTaskId: string | null = null;
let shuttingDown = false;

function checkStopSignal(cwd: string): boolean {
  const stopPath = join(cwd, BART_DIR, STOP_FILE);
  if (existsSync(stopPath)) {
    try { unlinkSync(stopPath); } catch {}
    return true;
  }
  return false;
}

/**
 * Write a lock file with the current PID so other bart processes
 * can tell whether an in_progress task belongs to a live process.
 */
function acquireLock(cwd: string): void {
  const lockPath = join(cwd, BART_DIR, LOCK_FILE);
  try {
    writeFileSync(lockPath, String(process.pid));
  } catch {}
}

function releaseLock(cwd: string): void {
  const lockPath = join(cwd, BART_DIR, LOCK_FILE);
  try {
    if (existsSync(lockPath)) {
      const pid = readFileSync(lockPath, "utf-8").trim();
      // Only remove if we own the lock
      if (pid === String(process.pid)) {
        unlinkSync(lockPath);
      }
    }
  } catch {}
}

/**
 * Check whether another bart process is actively running by reading
 * the lock file and verifying the PID is alive.
 */
function isAnotherBartRunning(cwd: string): boolean {
  const lockPath = join(cwd, BART_DIR, LOCK_FILE);
  try {
    if (!existsSync(lockPath)) return false;
    const pid = parseInt(readFileSync(lockPath, "utf-8").trim(), 10);
    if (isNaN(pid) || pid === process.pid) return false;
    // Signal 0 tests whether the process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    // process.kill throws if PID doesn't exist — stale lock
    return false;
  }
}

// --- Mode state file ---
const MODE_FILE = "mode";

/**
 * Write the current mode ("thinking" or "planning") to .bart/mode.
 * Used by hooks to block execution tools during skill phases.
 */
export function setMode(cwd: string, mode: "thinking" | "planning"): void {
  const bartDir = join(cwd, BART_DIR);
  if (!existsSync(bartDir)) mkdirSync(bartDir, { recursive: true });
  writeFileSync(join(bartDir, MODE_FILE), mode);
}

/**
 * Read the current mode from .bart/mode, or null if not set.
 */
export function getMode(cwd: string): "thinking" | "planning" | null {
  const modePath = join(cwd, BART_DIR, MODE_FILE);
  try {
    if (!existsSync(modePath)) return null;
    const value = readFileSync(modePath, "utf-8").trim();
    if (value === "thinking" || value === "planning") return value;
    return null;
  } catch {
    return null;
  }
}

/**
 * Remove the .bart/mode file, re-enabling execution tools.
 */
export function clearMode(cwd: string): void {
  const modePath = join(cwd, BART_DIR, MODE_FILE);
  try {
    if (existsSync(modePath)) unlinkSync(modePath);
  } catch {}
}

function resetInProgressTask(tasksPath: string, taskId: string) {
  try {
    const tasksData = readTasks(tasksPath);
    const idx = tasksData.tasks.findIndex(t => t.id === taskId);
    if (idx !== -1 && tasksData.tasks[idx].status === "in_progress") {
      tasksData.tasks[idx].status = "pending";
      tasksData.tasks[idx].started_at = null;
      writeFileSync(tasksPath, JSON.stringify(tasksData, null, 2));
      console.log(`\n↩️  Task ${taskId} reset to pending`);
    }
  } catch {}
}

function installSignalHandlers(cwd: string) {
  const handler = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n\n⛔ Caught ${signal} — shutting down gracefully...`);

    if (currentChild && !currentChild.killed) {
      console.log("   Terminating agent process...");
      currentChild.kill("SIGTERM");
      // Force kill after 3 seconds if still alive
      setTimeout(() => {
        if (currentChild && !currentChild.killed) {
          currentChild.kill("SIGKILL");
        }
      }, 3000).unref();
    }

    if (currentTasksPath && currentTaskId) {
      resetInProgressTask(currentTasksPath, currentTaskId);
    }

    releaseLock(cwd);
    clearMode(cwd);

    // Give child a moment to exit, then force exit
    setTimeout(() => process.exit(130), 3500).unref();
  };

  process.on("SIGINT", () => handler("SIGINT"));
  process.on("SIGTERM", () => handler("SIGTERM"));
}

/**
 * Resolve tasksPath with priority chain:
 * 1) --tasks flag (explicit escape hatch)
 * 2) --plan <slug> / auto-discover / legacy fallback (via resolvePlanTasksPath)
 */
function resolveTasksPath(cwd: string, tasksFlag?: string, planSlug?: string): string {
  if (tasksFlag) {
    return tasksFlag;
  }
  return resolvePlanTasksPath(cwd, planSlug);
}

/**
 * List all available plans with their task status, workstreams, and date.
 */
function listPlans(cwd: string) {
  const plansDir = join(cwd, ".bart", "plans");
  if (!existsSync(plansDir)) {
    console.log("No plans found. Run 'bart plan' to generate tasks from a plan.");
    return;
  }

  const entries = readdirSync(plansDir).sort();
  const plans: { slug: string; total: number; completed: number; workstreams: string[]; mtime: Date }[] = [];

  for (const entry of entries) {
    const entryPath = join(plansDir, entry);
    try {
      const stat = statSync(entryPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const tasksFile = join(entryPath, "tasks.json");
    if (existsSync(tasksFile)) {
      try {
        const data = readTasks(tasksFile);
        const total = data.tasks.length;
        const completed = data.tasks.filter(t => t.status === "completed").length;
        const workstreams = [...new Set(data.tasks.map(t => t.workstream).filter(Boolean))].sort();
        const fstat = statSync(tasksFile);
        plans.push({ slug: entry, total, completed, workstreams, mtime: fstat.mtime });
      } catch {
        plans.push({ slug: entry, total: 0, completed: 0, workstreams: [], mtime: new Date(0) });
      }
    }
  }

  if (plans.length === 0) {
    console.log("No plan executions found. Run 'bart plan' to generate tasks from a plan.");
    return;
  }

  // Sort by most recent first — first entry is active
  plans.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  console.log(`\n📋 Plans (${plans.length}):\n`);
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const isActive = i === 0;
    const pct = plan.total > 0 ? Math.round((plan.completed / plan.total) * 100) : 0;
    const icon = pct === 100 ? "✅" : pct > 0 ? "🔄" : "⏳";
    const activeTag = isActive ? " (active)" : "";
    const date = plan.mtime.toLocaleDateString();
    const ws = plan.workstreams.length > 0 ? plan.workstreams.join(", ") : "—";

    console.log(`  ${icon} ${plan.slug}${activeTag}`);
    console.log(`     Tasks: ${plan.completed}/${plan.total} done (${pct}%)  |  Workstreams: ${ws}  |  ${date}`);
  }
  console.log(`\nUse 'bart status --plan <slug>' to view a specific plan.`);
  console.log(`Use 'bart run --plan <slug>' to run tasks for a specific plan.`);
}

async function detectAgent(): Promise<{ cmd: string; args: string[] }> {
  const config = loadConfig();
  
  if (config.agent === "opencode") {
    return { cmd: "opencode", args: ["run"] };
  }
  if (config.agent === "claude") {
    return { cmd: "claude", args: ["-p"] };
  }
  
  const { promisify } = require("util");
  const exec = promisify(require("child_process").exec);
  
  try {
    await exec("opencode --version", { stdio: "ignore" });
    return { cmd: "opencode", args: ["run"] };
  } catch {}
  
  try {
    await exec("claude --version", { stdio: "ignore" });
    return { cmd: "claude", args: ["-p"] };
  } catch {}
  
  return { cmd: "claude", args: ["-p"] };
}

export function showHelp() {
  console.log(`
${BART}

Automated task execution using Claude Code or OpenCode

Usage:
  bart                    Run next available task
  bart run [task-id]      Run a specific task
  bart status            Show task status
  bart plans             List all plan executions
  bart dashboard         Launch TUI dashboard
  bart think             Start guided thinking session before planning
  bart think "topic"     Start thinking about a specific topic
  bart plan              Generate tasks from plan.md
  bart plan --latest     Generate tasks from latest plan (.bart/plans/ first, then Claude plans)
  bart plan --latest -y  Generate tasks from latest plan (skip confirmation)
  bart convert           Convert latest plan to bart tasks (checks .bart/plans/ first)
  bart convert <path>    Convert a specific plan file to bart tasks
  bart plan --plan-file <path>  Generate tasks from custom plan file
  bart watch             Auto-refresh dashboard
  bart requirements      Show requirements coverage report
  bart requirements --gaps  Show only uncovered/partial requirements
  bart suggest "<task>"  Suggest best specialists for a task description
  bart specialists            List discovered specialists (skills, agents, commands)
  bart specialists new        Create a new specialist profile (guided)
  bart specialists git        Discover standards from git history & PR reviews
  bart specialists git --since 3m  Scan last 3 months (default: 6m)
  bart specialists --board    Show specialist board grouped by effectiveness
  bart specialists --history  Show specialist performance from execution history
  bart stop              Send stop signal to a running 'bart run' (from another terminal)
  bart reset <task-id>   Reset task to pending
  bart completions zsh   Output zsh completion script to stdout
  bart completions bash  Output bash completion script to stdout
  bart completions install  Auto-detect shell and install completions
  bart install           Install bart skills and shell completions
  bart init              Initialize bart in current project
  bart config            Show current config
  bart config --agent <name>  Set default agent (claude, opencode)
  bart config --telegram         Setup Telegram notifications
  bart --help            Show this help

Options:
  --tasks <path>         Path to tasks.json (escape hatch, overrides all resolution)
  --plan <slug>          Select a plan execution by slug (e.g. --plan my-feature)
  --plan-file <path>     Path to plan file for 'bart plan' command (default: ./plan.md)
  --workstream <id>      Filter by workstream
  --agent <name>         Agent to use (claude, opencode)
  --auto-continue        Auto-continue to next task (default: true)
  --no-auto-continue     Ask before continuing to next task

Plan Resolution:
  Tasks are resolved in this order:
  1. --tasks <path>            Explicit path (escape hatch)
  2. --plan <slug>             .bart/plans/<slug>/tasks.json
  3. (auto)                    Latest tasks.json in .bart/plans/*/
  4. (fallback)                Legacy .bart/tasks.json

Examples:
  bart                           # Run next task (auto-selects latest plan)
  bart status                    # Show progress for latest plan
  bart plans                     # List all plan executions
  bart status --plan my-feature  # Show progress for specific plan
  bart run --plan my-feature     # Run tasks for specific plan
  bart run A1                    # Run specific task
  bart run --agent claude        # Run with claude, auto-continue
  bart run --no-auto-continue    # Ask before each task
  bart dashboard                 # Open TUI dashboard
  bart plan                      # Generate tasks from plan.md
  bart config --agent claude     # Set default agent to claude
  `);
}

const MILESTONE_THRESHOLDS = [25, 50, 80, 100] as const;

export interface WorkstreamReviewResult {
  verdict: "PASS" | "FAIL";
  issues: string[];
  summary: string;
}

/**
 * Spawn a dedicated Claude agent to review all completed tasks in a workstream.
 * The reviewer validates requirements coverage, test coverage, and cross-task code quality.
 * Returns a structured PASS/FAIL verdict with specific issues.
 */
export async function runWorkstreamReview(
  workstreamId: string,
  tasksPath: string,
  agentOverride?: string,
): Promise<WorkstreamReviewResult> {
  const tasksData = readTasks(tasksPath);
  const projectRoot = tasksData.project_root || process.cwd();
  const wsTasks = tasksData.tasks.filter(t => t.workstream === workstreamId);

  if (wsTasks.length === 0) {
    return { verdict: "PASS", issues: [], summary: "No tasks in workstream." };
  }

  console.log(`\n🔍 Starting workstream review for: ${workstreamId}`);
  console.log(`   Tasks to review: ${wsTasks.length}`);

  // 1. Collect all task descriptions and requirements
  const taskSummaries = wsTasks.map(t => {
    const reqs = t.requirements && t.requirements.length > 0
      ? `\n   Requirements: ${t.requirements.join(", ")}`
      : "";
    return `- [${t.id}] ${t.title}\n   Description: ${t.description}\n   Files: ${t.files.join(", ")}${reqs}`;
  }).join("\n\n");

  // 2. Collect all files modified across the workstream (deduplicated)
  const allFilesModified = [...new Set(
    wsTasks.flatMap(t => t.files_modified || [])
  )].sort();
  const allFilesDeclared = [...new Set(
    wsTasks.flatMap(t => t.files || [])
  )].sort();

  // 3. Collect requirements that should be covered
  const wsRequirementIds = [...new Set(
    wsTasks.flatMap(t => t.requirements || [])
  )];
  let requirementsSection = "";
  if (wsRequirementIds.length > 0 && tasksData.requirements) {
    const wsReqs = tasksData.requirements.filter(r => wsRequirementIds.includes(r.id));
    requirementsSection = `\n## Requirements to Validate\n\n${wsReqs.map(r =>
      `- ${r.id}: ${r.description} (covered by: ${r.covered_by.join(", ")})`
    ).join("\n")}`;
  }

  const filesModifiedSection = allFilesModified.length > 0
    ? `\n## Files Modified Across Workstream\n\n${allFilesModified.map(f => `- ${f}`).join("\n")}`
    : `\n## Files Declared in Tasks\n\n${allFilesDeclared.map(f => `- ${f}`).join("\n")}`;

  const reviewPrompt = `You are a workstream reviewer for an automated task pipeline. Your job is to review ALL completed work in workstream "${workstreamId}" and produce a quality verdict.

## Workstream Tasks

${taskSummaries}
${filesModifiedSection}
${requirementsSection}

## Review Instructions

Perform the following checks:

### 1. Requirements Coverage
- For each requirement listed, verify that the code changes actually implement what was required
- Flag any requirements that appear unmet or only partially addressed
- If no explicit requirements exist, verify each task's description was fulfilled

### 2. Test Coverage
- Check that tests exist for the changes made across all tasks
- Run the test suite and verify tests pass
- Flag any modified files that lack corresponding test coverage

### 3. Cross-Task Code Quality
- Review interactions between changes from different tasks
- Check for inconsistencies in naming, patterns, or approaches across tasks
- Verify no duplicate code was introduced across task boundaries
- Check for missing error handling at integration points between tasks

## Output Format

You MUST end your response with a verdict block in EXACTLY this format (on its own line):

VERDICT: PASS

or

VERDICT: FAIL
ISSUES:
- [issue description]
- [issue description]

Use PASS only if all checks pass with no significant issues. Use FAIL if any requirement is unmet, tests are missing/failing, or there are cross-task quality problems.`;

  // Resolve agent config
  let agentConfig: { cmd: string; args: string[] };
  if (agentOverride) {
    agentConfig = agentOverride === "opencode"
      ? { cmd: "opencode", args: ["run", "--dangerously-skip-permissions"] }
      : { cmd: "claude", args: ["-p", "--dangerously-skip-permissions", "--output-format", "text"] };
  } else {
    agentConfig = await detectAgent();
    if (agentConfig.cmd === "opencode") {
      agentConfig.args = ["run", "--dangerously-skip-permissions"];
    } else {
      agentConfig.args = ["-p", "--dangerously-skip-permissions", "--output-format", "text"];
    }
  }

  console.log(`   Agent: ${agentConfig.cmd}\n`);

  const args = [...agentConfig.args, reviewPrompt];

  // Capture output to parse verdict
  let output = "";
  const child = spawn(agentConfig.cmd, args, {
    cwd: projectRoot,
    stdio: ["inherit", "pipe", "inherit"],
  });

  child.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    output += text;
    process.stdout.write(text);
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", (err) => {
      console.error(`\n❌ Failed to start review agent: ${err.message}`);
      resolve(1);
    });
  });

  if (exitCode !== 0) {
    console.error(`\n⚠️ Review agent exited with code ${exitCode}`);
    return {
      verdict: "FAIL",
      issues: [`Review agent exited with code ${exitCode}`],
      summary: "Review could not be completed due to agent failure.",
    };
  }

  // Parse verdict from agent output
  return parseReviewVerdict(output);
}

function parseReviewVerdict(output: string): WorkstreamReviewResult {
  const lines = output.split("\n");

  // Find the VERDICT line (search from the end for the last occurrence)
  let verdictIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().startsWith("VERDICT:")) {
      verdictIdx = i;
      break;
    }
  }

  if (verdictIdx === -1) {
    return {
      verdict: "FAIL",
      issues: ["Review agent did not produce a VERDICT line"],
      summary: "Could not parse review output.",
    };
  }

  const verdictLine = lines[verdictIdx].trim();
  const verdict = verdictLine.includes("PASS") ? "PASS" : "FAIL";

  // Extract issues if FAIL
  const issues: string[] = [];
  if (verdict === "FAIL") {
    // Look for ISSUES: section after the VERDICT line
    let inIssues = false;
    for (let i = verdictIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("ISSUES:")) {
        inIssues = true;
        continue;
      }
      if (inIssues && line.startsWith("- ")) {
        issues.push(line.slice(2));
      } else if (inIssues && line === "") {
        // Allow blank lines within issues
        continue;
      } else if (inIssues && !line.startsWith("- ") && line !== "") {
        // Non-issue line encountered, stop parsing
        break;
      }
    }

    // If no ISSUES: section found, look for bullet points right after VERDICT
    if (issues.length === 0) {
      for (let i = verdictIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("- ")) {
          issues.push(line.slice(2));
        }
      }
    }
  }

  // Build summary from the text before the verdict
  const summaryLines = lines.slice(Math.max(0, verdictIdx - 5), verdictIdx)
    .map(l => l.trim())
    .filter(l => l.length > 0);
  const summary = summaryLines.length > 0
    ? summaryLines.join(" ")
    : verdict === "PASS" ? "All checks passed." : "Review found issues.";

  return { verdict, issues, summary };
}

/**
 * Identify which tasks in a workstream are affected by review issues.
 * Matches issues to tasks by checking if the issue text references task IDs or file paths.
 * Falls back to returning all tasks if no specific matches are found.
 */
function identifyAffectedTasks(wsTasks: import("./constants.js").Task[], issues: string[]): import("./constants.js").Task[] {
  if (issues.length === 0) return wsTasks;

  const issueText = issues.join("\n").toLowerCase();
  const matched = new Set<string>();

  for (const task of wsTasks) {
    // Match by task ID (e.g., "A1", "B2")
    if (issueText.includes(task.id.toLowerCase())) {
      matched.add(task.id);
      continue;
    }
    // Match by file references
    for (const file of task.files) {
      if (issueText.includes(file.toLowerCase())) {
        matched.add(task.id);
        break;
      }
    }
  }

  // If no specific tasks matched, reset all tasks in the workstream
  if (matched.size === 0) return wsTasks;

  return wsTasks.filter(t => matched.has(t.id));
}

/**
 * Build the testing context block from plan-level ## Testing metadata.
 * When metadata is available, includes test command, framework, and conventions.
 * When absent, instructs the specialist to discover the test setup.
 */
export function buildTestingContextBlock(testingMeta: import("./constants.js").TestingMetadata | null | undefined): string {
  if (testingMeta) {
    const parts: string[] = [];
    if (testingMeta.test_command) parts.push(`Test command: \`${testingMeta.test_command}\``);
    if (testingMeta.framework) parts.push(`Framework: ${testingMeta.framework}`);
    if (testingMeta.conventions) parts.push(`Conventions: ${testingMeta.conventions}`);
    return `\n${parts.join("\n")}`;
  }
  return `\nNo test command specified in the plan. Discover the project's test setup by examining package.json, existing test files, CI config, or test configuration files, then use the appropriate test command.`;
}

/**
 * Extract the "## Definition of Done" section content from task markdown.
 * Returns the section body (without the heading) or null if not found.
 */
export function extractDefinitionOfDone(markdown: string): string | null {
  const lines = markdown.split("\n");
  let startIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "## Definition of Done") {
      startIdx = i + 1;
      continue;
    }
    if (startIdx !== -1 && /^## /.test(lines[i])) {
      // Hit the next ## section — extract what we have
      const content = lines.slice(startIdx, i).join("\n").trim();
      return content || null;
    }
  }

  if (startIdx !== -1) {
    // DoD was the last section in the file
    const content = lines.slice(startIdx).join("\n").trim();
    return content || null;
  }

  return null;
}

/**
 * Build the self-review block appended to every task prompt.
 * Includes scope check, code quality check, TDD protocol, and evidence requirement.
 * When definitionOfDone is provided, injects it as a task-specific completion checklist.
 */
export function buildSelfReviewBlock(options: {
  specialistPremises?: string;
  specialistTestExpectations?: string[];
  testingContextBlock: string;
  definitionOfDone?: string | null;
}): string {
  const { specialistPremises, specialistTestExpectations, testingContextBlock, definitionOfDone } = options;
  const defaultQualityGate = DEFAULT_QUALITY_GATE.map(s => `\n- ${s}`).join("");

  return `

## Mandatory Self-Review Gate

Before marking this task as done, you MUST perform a self-review. Do NOT consider the task complete until all checks pass.

### 1. Scope Check
- Re-read the task description above
- Verify you implemented exactly what was described — nothing more, nothing less
- If you added anything beyond the task scope, revert it

### 2. Code Quality Check
- Review all changes for correctness, readability, and maintainability${specialistPremises ? `
- Apply the specialist's standards as the quality bar:
${specialistPremises.split("\n").map(line => `  ${line}`).join("\n")}` : `
- Apply these default quality standards:${defaultQualityGate}`}

### 3. TDD Protocol (Mandatory)

You MUST follow this sequence for every change:
1. WRITE the failing test first — test file and test code before any production code
2. RUN the test and verify it FAILS for the expected reason
3. WRITE the minimal implementation to make the test pass
4. RUN the test and verify it PASSES
5. COMMIT the test and implementation together
${specialistTestExpectations && specialistTestExpectations.length > 0
? `\nSpecialist test expectations:${specialistTestExpectations.map(e => `\n- ${e}`).join("")}`
: ""}
${testingContextBlock}${definitionOfDone ? `
### 4. Task-Specific Definition of Done

Verify each item before marking this task complete:
${definitionOfDone}
` : ""}
### Evidence Requirement
Before marking this task complete, you MUST:
- Show actual test command output (not assumptions)
- All tests must pass with zero failures
- If you cannot run tests, explain why and flag for review

Only after all ${definitionOfDone ? "four" : "three"} checks pass should you consider this task complete.`;
}

/**
 * Build the task prompt for an agent. Checks for a task-{id}.md file in the plan
 * directory (dirname of tasksPath). When found, uses its contents as the primary
 * task context. Falls back to title+description from tasks.json when not found.
 */
export function buildTaskPrompt(
  task: import("./constants.js").Task,
  tasksPath: string,
  specialistContext: string,
  selfReviewBlock: string,
): string {
  const planDir = dirname(tasksPath);
  const taskMdPath = join(planDir, `task-${task.id}.md`);

  if (existsSync(taskMdPath)) {
    const markdownContent = readFileSync(taskMdPath, "utf-8");
    return `${markdownContent}${specialistContext}

Please complete this task.${selfReviewBlock}`;
  }

  return `Task: ${task.title}
Description: ${task.description}
Files to work on: ${task.files.join(", ")}${specialistContext}

Please complete this task.${selfReviewBlock}`;
}

/**
 * Append review feedback to a task-{id}.md file when a workstream review rejects the task.
 * Adds a `## Review Feedback` section (if not present) and appends a numbered attempt subsection.
 * Returns true if feedback was appended, false if the file does not exist (fallback to tasks.json).
 */
export function appendReviewFeedback(taskMdPath: string, issues: string[]): boolean {
  if (!existsSync(taskMdPath)) {
    return false;
  }

  const content = readFileSync(taskMdPath, "utf-8");

  // Count existing attempt subsections to determine the next attempt number
  const attemptMatches = content.match(/### Attempt \d+ — REJECTED/g);
  const attemptNumber = attemptMatches ? attemptMatches.length + 1 : 1;

  const issuesList = issues.map(issue => `- ${issue}`).join("\n");
  const attemptBlock = `### Attempt ${attemptNumber} — REJECTED\n${issuesList}\n`;

  let newContent: string;
  if (content.includes("## Review Feedback")) {
    // Append new attempt to existing feedback section
    newContent = content.trimEnd() + "\n\n" + attemptBlock;
  } else {
    // Add new feedback section at end
    newContent = content.trimEnd() + "\n\n## Review Feedback\n\n" + attemptBlock;
  }

  writeFileSync(taskMdPath, newContent);
  return true;
}

/**
 * Mark review feedback as resolved in a task-{id}.md file.
 * Appends a `### Resolved` subsection to the existing `## Review Feedback` section.
 * Returns true if resolved marker was appended, false if:
 * - The file does not exist
 * - No `## Review Feedback` section exists
 * - Already resolved (idempotent)
 */
export function markReviewFeedbackResolved(taskMdPath: string): boolean {
  if (!existsSync(taskMdPath)) {
    return false;
  }

  const content = readFileSync(taskMdPath, "utf-8");

  if (!content.includes("## Review Feedback")) {
    return false;
  }

  if (content.includes("### Resolved")) {
    return false;
  }

  const resolvedBlock = `### Resolved\nAll previous review issues have been addressed. Review passed.\n`;
  const newContent = content.trimEnd() + "\n\n" + resolvedBlock;
  writeFileSync(taskMdPath, newContent);
  return true;
}

/**
 * Assemble the full task prompt with DoD extraction from task markdown.
 * This encapsulates the prompt-assembly logic used by runAgent, making it testable.
 * Reads the task markdown file (if present), extracts Definition of Done,
 * and wires it into the self-review block.
 */
export function assembleTaskPrompt(options: {
  task: import("./constants.js").Task;
  tasksPath: string;
  specialistContext: string;
  specialistPremises: string;
  specialistTestExpectations?: string[];
  testingMetadata?: import("./constants.js").TestingMetadata | null;
}): string {
  const { task, tasksPath, specialistContext, specialistPremises, specialistTestExpectations, testingMetadata } = options;

  const testingContextBlock = buildTestingContextBlock(testingMetadata);

  // Extract Definition of Done from task markdown if it exists
  const planDir = dirname(tasksPath);
  const taskMdPath = join(planDir, `task-${task.id}.md`);
  let definitionOfDone: string | null = null;
  if (existsSync(taskMdPath)) {
    const taskMarkdown = readFileSync(taskMdPath, "utf-8");
    definitionOfDone = extractDefinitionOfDone(taskMarkdown);
  }

  const selfReviewBlock = buildSelfReviewBlock({
    specialistPremises,
    specialistTestExpectations,
    testingContextBlock,
    definitionOfDone,
  });

  return buildTaskPrompt(task, tasksPath, specialistContext, selfReviewBlock);
}

export async function runAgent(taskId: string, tasksPath: string, agentOverride?: string, autoContinue?: boolean, firedMilestones?: Set<number>) {
  const tasks = readTasks(tasksPath);
  const task = getTaskById(tasks, taskId);
  
  if (!task) {
    console.error(`Task ${taskId} not found`);
    process.exit(1);
  }
  
  const completedTasks = tasks.tasks.filter(t => t.status === "completed");
  if (completedTasks.length > 0) {
    console.log(`\n✅ Previously completed (${completedTasks.length}):`);
    for (const t of completedTasks) {
      console.log(`   ${t.id}: ${t.title}`);
    }
    console.log("");
  }
  
  const projectRoot = tasks.project_root || process.cwd();
  
  console.log(`\n🚀 Starting task: ${taskId} — ${task.title}`);
  console.log(`   Workstream: ${task.workstream}`);
  console.log(`📁 Working directory: ${projectRoot}\n`);

  const tasksData = readTasks(tasksPath);
  const taskIndex = tasksData.tasks.findIndex(t => t.id === taskId);
  if (taskIndex !== -1) {
    tasksData.tasks[taskIndex].status = "in_progress";
    tasksData.tasks[taskIndex].started_at = new Date().toISOString();
    writeFileSync(tasksPath, JSON.stringify(tasksData, null, 2));
    console.log(`   Status: ${taskId} → in_progress | Workstream ${task.workstream} → active\n`);
  }

  await sendTelegram(formatTaskStarted(task));
  
  let agentConfig: { cmd: string; args: string[] };
  if (agentOverride) {
    agentConfig = agentOverride === "opencode" 
      ? { cmd: "opencode", args: ["run", "--dangerously-skip-permissions"] }
      : { cmd: "claude", args: ["-p", "--dangerously-skip-permissions"] };
  } else {
    agentConfig = await detectAgent();
    if (agentConfig.cmd === "opencode") {
      agentConfig.args = ["run", "--dangerously-skip-permissions"];
    } else {
      agentConfig.args = ["-p", "--dangerously-skip-permissions"];
    }
  }
  
  console.log(`🤖 Using agent: ${agentConfig.cmd}\n`);
  
  // Build specialist context if task has an assigned specialist
  let specialistContext = "";
  let specialistPremises = "";
  let specialistTestExpectations: string[] | undefined;
  if (task.specialist) {
    const specialists = discoverSpecialists(projectRoot);
    const specialist = specialists.find(s => s.name === task.specialist);
    if (specialist) {
      specialistContext = "\n" + resolveProfileContext(specialist, specialists) + "\n";
      if (specialist.premises) {
        specialistPremises = specialist.premises;
      }
      specialistTestExpectations = specialist.test_expectations;
      console.log(`   Specialist: ${specialist.name} (${specialist.type})\n`);
    }
  }

  // Assemble the full task prompt with DoD extraction from task markdown
  const taskPrompt = assembleTaskPrompt({
    task,
    tasksPath,
    specialistContext,
    specialistPremises,
    specialistTestExpectations,
    testingMetadata: tasksData.testing,
  });
  
  const args = [...agentConfig.args, taskPrompt];

  // Track for graceful shutdown
  currentTasksPath = tasksPath;
  currentTaskId = taskId;

  const child = spawn(agentConfig.cmd, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });
  currentChild = child;

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      currentChild = null;
      resolve(code);
    });
    child.on("error", (err) => {
      currentChild = null;
      console.error(`\n❌ Failed to start agent: ${err.message}`);
      resolve(1);
    });
  });

  if (exitCode !== 0) {
    // If we're shutting down via signal, don't treat this as an error —
    // the signal handler already reset the task to pending
    if (shuttingDown) {
      return false;
    }

    console.error(`\n⚠️ Agent exited with code ${exitCode}`);

    // Log error to history and update task status
    const errTasksData = readTasks(tasksPath);
    const errTaskIndex = errTasksData.tasks.findIndex(t => t.id === taskId);
    if (errTaskIndex !== -1) {
      errTasksData.tasks[errTaskIndex].status = "error";
      errTasksData.tasks[errTaskIndex].error = `Agent exited with code ${exitCode}`;
      writeFileSync(tasksPath, JSON.stringify(errTasksData, null, 2));

      const errTask = errTasksData.tasks[errTaskIndex];
      const planSlug = extractPlanSlug(tasksPath);
      const resets = countResetsForTask(projectRoot, taskId, planSlug);
      appendHistory(projectRoot, {
        timestamp: new Date().toISOString(),
        event: "error",
        task_id: taskId,
        plan_slug: planSlug,
        specialist: errTask.specialist || null,
        status: "error",
        duration_ms: errTask.started_at ? Date.now() - new Date(errTask.started_at).getTime() : null,
        resets,
        files: errTask.files,
        workstream: errTask.workstream,
        title: errTask.title,
      });

      // Record failed pairing in specialist model [REQ-02]
      recordPairing(projectRoot, errTask, false);

      // Record learning in specialist profile [REQ-04]
      appendProfileLearning(errTask, {
        success: false,
        error: `Agent exited with code ${exitCode}`,
        durationMs: errTask.started_at ? Date.now() - new Date(errTask.started_at).getTime() : null,
        filesModified: errTask.files_modified || [],
      }, projectRoot);

      // Send error notification [REQ-05]
      await sendTelegram(formatTaskError(errTask, resets + 1));

      // Critical error detection [REQ-06]:
      // Trigger if same task failed 3+ times OR 3+ distinct tasks errored in this workstream
      const sameTaskFailures = resets + 1; // resets count + current error
      const wsErrors = countWorkstreamErrors(projectRoot, errTask.workstream, planSlug);
      if (sameTaskFailures >= 3) {
        await sendTelegram(formatCriticalError(
          `Task ${errTask.id} has failed ${sameTaskFailures} times.\n` +
          `Workstream: ${errTask.workstream}\n` +
          `Task: ${errTask.title}`
        ));
      } else if (wsErrors >= 3) {
        await sendTelegram(formatCriticalError(
          `${wsErrors} distinct tasks have errored in workstream ${errTask.workstream}.\n` +
          `Latest failure: ${errTask.id} — ${errTask.title}`
        ));
      }
    }

    process.exit(exitCode || 1);
  }
  
  const finalTasksData = readTasks(tasksPath);
  const finalTaskIndex = finalTasksData.tasks.findIndex(t => t.id === taskId);
  if (finalTaskIndex !== -1) {
    finalTasksData.tasks[finalTaskIndex].status = "completed";
    finalTasksData.tasks[finalTaskIndex].completed_at = new Date().toISOString();
    writeFileSync(tasksPath, JSON.stringify(finalTasksData, null, 2));
    console.log(`\n✅ Task ${taskId} marked as completed`);

    const completedTask = finalTasksData.tasks[finalTaskIndex];
    const planSlug = extractPlanSlug(tasksPath);
    appendHistory(projectRoot, {
      timestamp: new Date().toISOString(),
      event: "completed",
      task_id: taskId,
      plan_slug: planSlug,
      specialist: completedTask.specialist || null,
      status: "completed",
      duration_ms: completedTask.started_at ? Date.now() - new Date(completedTask.started_at).getTime() : null,
      resets: countResetsForTask(projectRoot, taskId, planSlug),
      files: completedTask.files,
      workstream: completedTask.workstream,
      title: completedTask.title,
    });

    // Record successful pairing in specialist model [REQ-02]
    recordPairing(projectRoot, completedTask, true);

    // Record learning in specialist profile [REQ-04]
    appendProfileLearning(completedTask, {
      success: true,
      durationMs: completedTask.started_at ? Date.now() - new Date(completedTask.started_at).getTime() : null,
      filesModified: completedTask.files_modified || [],
    }, projectRoot);

    await sendTelegram(formatTaskCompleted(completedTask));

    // Milestone check: right after task completion, check if we crossed a threshold
    const milestoneTotal = finalTasksData.tasks.length;
    const milestoneCompleted = finalTasksData.tasks.filter(t => t.status === "completed").length;
    if (milestoneTotal > 0) {
      const pct = Math.round((milestoneCompleted / milestoneTotal) * 100);
      // Seed firedMilestones on first use (single-task execution)
      if (!firedMilestones) {
        firedMilestones = new Set<number>();
        // Seed with thresholds already passed before this task
        const prevPct = Math.round((Math.max(0, milestoneCompleted - 1) / milestoneTotal) * 100);
        for (const threshold of MILESTONE_THRESHOLDS) {
          if (prevPct >= threshold) {
            firedMilestones.add(threshold);
          }
        }
      }
      for (const threshold of MILESTONE_THRESHOLDS) {
        if (pct >= threshold && !firedMilestones.has(threshold)) {
          firedMilestones.add(threshold);
          const activeWs = [...new Set(
            finalTasksData.tasks
              .filter(t => t.status === "in_progress" || t.status === "pending")
              .map(t => t.workstream)
              .filter(Boolean)
          )];
          await sendTelegram(formatMilestone(threshold, milestoneCompleted, milestoneTotal, activeWs));
        }
      }
    }
  }

  // Clear tracking state after task completes normally
  currentTaskId = null;

  const shouldAsk = autoContinue === false || (autoContinue === undefined && loadConfig().auto_continue === false);

  if (shouldAsk) {
    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise<boolean>((resolve) => {
      readline.question("\n🤔 Continue with next task? (Y/n) ", (answer: string) => {
        readline.close();
        const shouldContinue = answer.trim().toLowerCase() !== "n";
        resolve(shouldContinue);
      });
    });
  }
  
  return true;
}

export async function main() {
  const args = process.argv.slice(2);
  const cwd = getCwd();

  let command = args[0] || "status";
  let workstream: string | undefined;
  let specificTask: string | undefined;
  let planFilePath: string | undefined;  // --plan-file <path> for 'bart plan' command
  let planSlug: string | undefined;      // --plan <slug> for plan execution selection
  let tasksFlag: string | undefined;     // --tasks <path> explicit escape hatch
  let agentOverride: string | undefined;
  let autoContinue: boolean | undefined;
  let telegramSetup = false;
  let showHistory = false;
  let showBoard = false;

  const remainingArgs: string[] = [];
  let skipNext = false;
  for (let i = 0; i < args.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const arg = args[i];
    if (arg === "--workstream" && args[i + 1]) {
      workstream = args[i + 1];
      skipNext = true;
    } else if (arg === "--tasks" && args[i + 1]) {
      tasksFlag = args[i + 1];
      skipNext = true;
    } else if (arg === "--plan" && args[i + 1]) {
      planSlug = args[i + 1];
      skipNext = true;
    } else if (arg === "--plan-file" && args[i + 1]) {
      planFilePath = args[i + 1];
      skipNext = true;
    } else if ((arg === "--agent" || arg === "-a") && args[i + 1] && (args[i + 1] === "claude" || args[i + 1] === "opencode")) {
      agentOverride = args[i + 1];
      skipNext = true;
    } else if (arg === "--auto-continue" || arg === "--no-auto-continue") {
      autoContinue = arg === "--auto-continue";
    } else if (arg === "--history") {
      showHistory = true;
    } else if (arg === "--board") {
      showBoard = true;
    } else if (arg === "--telegram") {
      telegramSetup = true;
    } else if (!arg.startsWith("-") || arg === "-a") {
      remainingArgs.push(arg);
    }
  }

  command = remainingArgs[0] || command;
  specificTask = remainingArgs[1];

  // Resolve tasksPath using priority chain
  const tasksPath = resolveTasksPath(cwd, tasksFlag, planSlug);
  
  switch (command) {
    case "status":
    case "s":
      if (existsSync(tasksPath)) {
        const tasks = readTasks(tasksPath);
        if (workstream) {
          printWorkstreamStatus(tasks, workstream);
        } else {
          printStatus(tasks);
        }
      } else {
        console.log("No tasks.json found. Run 'bart init' to initialize.");
      }
      break;
      
    case "dashboard":
    case "d":
      if (!existsSync(tasksPath)) {
        console.error("No tasks.json found. Run 'bart init' first.");
        process.exit(1);
      }
      await runDashboard(tasksPath);
      break;
      
    case "watch":
    case "w":
      console.log("Use Ctrl+C to exit dashboard. Auto-refresh every 2s.");
      if (!existsSync(tasksPath)) {
        console.error("No tasks.json found. Run 'bart init' first.");
        process.exit(1);
      }
      await runDashboard(tasksPath);
      break;
      
    case "run":
    case "r":
      if (!existsSync(tasksPath)) {
        console.log("No tasks.json found. Run 'bart init' first.");
        process.exit(1);
      }

      // Install signal handlers for graceful shutdown
      installSignalHandlers(cwd);

      // Clear any stale stop signal from a previous run
      checkStopSignal(cwd);

      // Recover tasks stuck in_progress from a previous interrupted run,
      // but only if no other bart process is actively running (PID lock check)
      if (!isAnotherBartRunning(cwd)) {
        const recoveryTasks = readTasks(tasksPath);
        const stale = recoveryTasks.tasks.filter(t => t.status === "in_progress");
        if (stale.length > 0) {
          console.log(`\n⚠️  Found ${stale.length} task(s) stuck in_progress from a previous run — resetting to pending:`);
          for (const t of stale) {
            t.status = "pending";
            t.started_at = null;
            console.log(`   ↩️  ${t.id}: ${t.title}`);
          }
          writeFileSync(tasksPath, JSON.stringify(recoveryTasks, null, 2));
        }
      } else {
        console.log(`\nℹ️  Another bart process is running — skipping stale task recovery`);
      }

      // Acquire lock so other bart processes know we're running
      acquireLock(cwd);

      if (specificTask) {
        await runAgent(specificTask, tasksPath, agentOverride, autoContinue);
        releaseLock(cwd);
      } else {
        let running = true;
        let iterations = 0;
        // Seed milestones already passed before this execution started [REQ-08]
        const firedMilestones = new Set<number>();
        // Track workstreams that passed review in this session to avoid re-reviewing [REQ-02]
        const passedWorkstreams = new Set<string>();
        {
          const initialTasks = readTasks(tasksPath);
          const initCompleted = initialTasks.tasks.filter(t => t.status === "completed").length;
          const initTotal = initialTasks.tasks.length;
          if (initTotal > 0) {
            const initPct = Math.round((initCompleted / initTotal) * 100);
            for (const threshold of MILESTONE_THRESHOLDS) {
              if (initPct >= threshold) {
                firedMilestones.add(threshold);
              }
            }
          }
        }
        while (running) {
          // Check for stop signal from `bart stop`
          if (checkStopSignal(cwd)) {
            console.log("\n⛔ Stop signal received (via 'bart stop'). Stopping after current iteration.");
            await sendTelegram("⛔ Bart run stopped by user (bart stop)");
            break;
          }

          iterations++;
          if (iterations > 100) {
            console.log("\n⚠️ Safety limit reached (100 iterations). Stopping.");
            break;
          }

          const tasks = readTasks(tasksPath);
          const next = findNextTask(tasks, workstream);
          
          if (next) {
            console.log("\n" + "=".repeat(50));
            console.log(`📋 Iteration ${iterations}: Running task ${next}`);
            const shouldContinue = await runAgent(next, tasksPath, agentOverride, autoContinue, firedMilestones);

            const tasksAfter = readTasks(tasksPath);
            const currentTask = tasksAfter.tasks.find(t => t.id === next);
            const ws = currentTask?.workstream;

            if (ws && !passedWorkstreams.has(ws)) {
              const wsTasks = tasksAfter.tasks.filter(t => t.workstream === ws);
              const wsCompleted = wsTasks.filter(t => t.status === "completed").length;
              const wsTotal = wsTasks.length;

              if (wsCompleted === wsTotal) {
                console.log(`\n🎉 Workstream ${ws} completed!`);
                await sendTelegram(formatWorkstreamCompleted(ws, wsCompleted, wsTotal));

                // Run workstream review [REQ-02]
                console.log("\n" + "=".repeat(50));
                console.log(`🔍 Running workstream review for: ${ws}`);
                const reviewResult = await runWorkstreamReview(ws, tasksPath, agentOverride);
                const planSlugForReview = extractPlanSlug(tasksPath);
                const projectRoot = tasksAfter.project_root || process.cwd();

                if (reviewResult.verdict === "PASS") {
                  console.log(`\n✅ Workstream ${ws} review: PASS`);
                  console.log(`   ${reviewResult.summary}`);
                  await sendTelegram(formatWorkstreamReview(ws, "PASS", reviewResult.summary, []));
                  passedWorkstreams.add(ws);

                  // Mark review feedback as resolved in each task's markdown [REQ-02] [REQ-03]
                  for (const t of wsTasks.filter(t => t.status === "completed")) {
                    const taskMdPath = join(dirname(tasksPath), `task-${t.id}.md`);
                    markReviewFeedbackResolved(taskMdPath);
                  }

                  // Record review pass in history [REQ-03]
                  appendHistory(projectRoot, {
                    timestamp: new Date().toISOString(),
                    event: "review_pass",
                    task_id: ws,
                    plan_slug: planSlugForReview,
                    specialist: null,
                    status: "review_pass",
                    duration_ms: null,
                    resets: 0,
                    files: [...new Set(wsTasks.flatMap(t => t.files))],
                    workstream: ws,
                    title: `Workstream ${ws} review passed`,
                  });
                } else {
                  // Review FAILED — trigger auto-retry [REQ-03]
                  console.log(`\n❌ Workstream ${ws} review: FAIL`);
                  console.log(`   ${reviewResult.summary}`);
                  for (const issue of reviewResult.issues) {
                    console.log(`   • ${issue}`);
                  }
                  await sendTelegram(formatWorkstreamReview(ws, "FAIL", reviewResult.summary, reviewResult.issues));

                  // Identify affected tasks: match issues to tasks by file or ID references,
                  // or reset all tasks in the workstream if no specific match
                  const affectedTasks = identifyAffectedTasks(wsTasks, reviewResult.issues);
                  const affectedTaskIds = affectedTasks.map(t => t.id);

                  // Per-task retry tracking [REQ-03]: check each task's prior review retries
                  const historyEntries = loadHistory(projectRoot);
                  const tasksToReset: string[] = [];
                  const tasksToEscalate: string[] = [];

                  for (const tid of affectedTaskIds) {
                    const priorRetries = countReviewRetriesForTask(historyEntries, tid, planSlugForReview);
                    if (priorRetries >= 2) {
                      tasksToEscalate.push(tid);
                    } else {
                      tasksToReset.push(tid);
                    }
                  }

                  // Record review failure in history (includes all affected tasks)
                  const priorWsFailures = countWorkstreamReviewFailures(projectRoot, ws, planSlugForReview);
                  appendHistory(projectRoot, {
                    timestamp: new Date().toISOString(),
                    event: "review_fail",
                    task_id: ws,
                    plan_slug: planSlugForReview,
                    specialist: null,
                    status: "review_fail",
                    duration_ms: null,
                    resets: priorWsFailures + 1,
                    files: [...new Set(wsTasks.flatMap(t => t.files))],
                    workstream: ws,
                    title: `Workstream ${ws} review failed`,
                    review_issues: reviewResult.issues,
                    tasks_reset: tasksToReset,
                  });

                  // Handle escalated tasks — mark as needs_escalation [REQ-03]
                  if (tasksToEscalate.length > 0) {
                    console.log(`\n🚨 ${tasksToEscalate.length} task(s) exceeded retry limit (2) — escalating: ${tasksToEscalate.join(", ")}`);
                    const escalateTasksData = readTasks(tasksPath);
                    for (const tid of tasksToEscalate) {
                      const idx = escalateTasksData.tasks.findIndex(t => t.id === tid);
                      if (idx !== -1) {
                        escalateTasksData.tasks[idx].status = "needs_escalation";
                        escalateTasksData.tasks[idx].error = `Review failed ${countReviewRetriesForTask(historyEntries, tid, planSlugForReview) + 1} times: ${reviewResult.issues.join("; ")}`;
                      }
                    }
                    writeFileSync(tasksPath, JSON.stringify(escalateTasksData, null, 2));
                    await sendTelegram(formatReviewEscalation(ws, tasksToEscalate, 3));
                  }

                  // Handle retryable tasks — reset to pending with feedback [REQ-03]
                  if (tasksToReset.length > 0) {
                    console.log(`\n🔄 Retrying ${tasksToReset.length} task(s) in workstream ${ws}: ${tasksToReset.join(", ")}`);

                    const retryTasksData = readTasks(tasksPath);
                    const feedbackPrefix = `[REVIEW FEEDBACK]: ${reviewResult.issues.join("; ")}`;

                    for (const tid of tasksToReset) {
                      const idx = retryTasksData.tasks.findIndex(t => t.id === tid);
                      if (idx !== -1) {
                        retryTasksData.tasks[idx].status = "pending";
                        retryTasksData.tasks[idx].started_at = null;
                        retryTasksData.tasks[idx].completed_at = null;
                        retryTasksData.tasks[idx].error = null;
                        // Append review feedback to task-{id}.md if it exists [REQ-01]
                        const taskMdPath = join(dirname(tasksPath), `task-${tid}.md`);
                        const feedbackAppended = appendReviewFeedback(taskMdPath, reviewResult.issues);

                        // Fall back to tasks.json description feedback if no .md file [REQ-04]
                        if (!feedbackAppended) {
                          if (!retryTasksData.tasks[idx].description.startsWith("[REVIEW FEEDBACK]:")) {
                            retryTasksData.tasks[idx].description = `${feedbackPrefix}\n\n${retryTasksData.tasks[idx].description}`;
                          } else {
                            // Replace existing feedback with latest
                            retryTasksData.tasks[idx].description = retryTasksData.tasks[idx].description.replace(
                              /^\[REVIEW FEEDBACK\]:.*?\n\n/s,
                              `${feedbackPrefix}\n\n`
                            );
                          }
                        }

                        // Record reset in history
                        appendHistory(projectRoot, {
                          timestamp: new Date().toISOString(),
                          event: "reset",
                          task_id: tid,
                          plan_slug: planSlugForReview,
                          specialist: retryTasksData.tasks[idx].specialist || null,
                          status: "reset",
                          duration_ms: null,
                          resets: countResetsForTask(projectRoot, tid, planSlugForReview) + 1,
                          files: retryTasksData.tasks[idx].files,
                          workstream: ws,
                          title: retryTasksData.tasks[idx].title,
                        });
                      }
                    }
                    writeFileSync(tasksPath, JSON.stringify(retryTasksData, null, 2));
                    console.log(`   Tasks reset with review feedback — loop will re-execute them`);
                  }

                  // If all affected tasks are escalated, mark workstream as done retrying
                  if (tasksToReset.length === 0) {
                    passedWorkstreams.add(ws);
                  }
                }
              }
            }

            if (!shouldContinue) {
              console.log("→ User chose to stop after task completion");
              running = false;
            }
          } else {
            const remaining = tasks.tasks.filter(t => 
              t.status === "pending" && (!workstream || t.workstream === workstream)
            );
            
            if (remaining.length > 0) {
              console.log("\n⏳ Waiting for dependencies...");
              
              const depsFromOtherWs = new Set<string>();
              
              for (const t of remaining) {
                const deps = t.depends_on || [];
                if (deps.length > 0) {
                  const depTasks = deps.map(depId => {
                    const dep = tasks.tasks.find(task => task.id === depId);
                    const ws = dep?.workstream || depId;
                    const status = dep?.status || "unknown";
                    const icon = status === "completed" ? "✓" : status === "in_progress" ? "◐" : "○";
                    if (ws !== workstream && status !== "completed") {
                      depsFromOtherWs.add(ws);
                    }
                    return `${icon} ${depId} (${ws})`;
                  });
                  console.log(`   ${t.id}: waiting on [${depTasks.join(", ")}]`);
                } else {
                  console.log(`   ${t.id}: ${t.title} (no dependencies, but blocked)`);
                }
              }
              
              if (depsFromOtherWs.size > 0) {
                console.log(`\n⚠️  Waiting on tasks from workstream(s): ${[...depsFromOtherWs].join(", ")}`);
                console.log("   These will NOT be auto-run. Either:");
                console.log("   • Run 'bart run' without --workstream to run all workstreams");
                console.log("   • Run 'bart run --workstream <X>' for each workstream in order");
                console.log("   • Manually run the dependent tasks first");
                
                await sendTelegram(formatWorkstreamBlocked(workstream || "unknown", [...depsFromOtherWs]));
                
                running = false;
                continue;
              }
              
              console.log("\n🔄 Checking every 5 seconds for dependency resolution...");
              
              let waited = 0;
              while (waited < 120) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                waited += 5;

                // Check for stop signal during wait
                if (checkStopSignal(cwd)) {
                  console.log("\n⛔ Stop signal received. Stopping.");
                  await sendTelegram("⛔ Bart run stopped by user (bart stop)");
                  running = false;
                  break;
                }

                const checkTasks = readTasks(tasksPath);
                const checkNext = findNextTask(checkTasks, workstream);
                
                if (checkNext) {
                  console.log("\n✅ Dependencies resolved! Continuing...");
                  break;
                }
                
                const newRemaining = checkTasks.tasks.filter(t => 
                  t.status === "pending" && (!workstream || t.workstream === workstream)
                );
                
                if (newRemaining.length === 0) {
                  console.log("\n📋 No more pending tasks.");
                  running = false;
                  break;
                }
                
                const inProgress = checkTasks.tasks.filter(t => t.status === "in_progress");
                if (inProgress.length > 0) {
                  console.log(`\n⏳ Waiting... (${waited}s) [${inProgress[0].id}: ${inProgress[0].title}]`);
                } else {
                  console.log(`\n⏳ Waiting... (${waited}s)`);
                }
              }
              
              if (waited >= 120) {
                console.log("\n⏰ Timeout reached (2 minutes). Stopping.");
                running = false;
              }
              continue;
            } else {
              const inThisWs = tasks.tasks.filter(t => t.workstream === workstream);
              if (inThisWs.length > 0) {
                const completed = inThisWs.filter(t => t.status === "completed").length;
                console.log(`\n⚠️  No tasks can run in workstream ${workstream}`);
                console.log(`   Completed: ${completed}/${inThisWs.length}`);
                const pending = inThisWs.filter(t => t.status === "pending");
                if (pending.length > 0) {
                  console.log(`   Pending but blocked:`);
                  for (const t of pending) {
                    const deps = t.depends_on || [];
                    if (deps.length > 0) {
                      console.log(`     - ${t.id}: depends on ${deps.join(", ")}`);
                    }
                  }
                }
              } else {
                console.log(`\n⚠️  No tasks found in workstream ${workstream}`);
              }
              running = false;
            }
          }
        }
        
        const finalTasks = readTasks(tasksPath);
        const relevantTasks = finalTasks.tasks.filter(t =>
          !workstream || t.workstream === workstream
        );
        const allDone = relevantTasks.every(t =>
          t.status === "completed" || t.status === "needs_escalation"
        );
        const escalated = relevantTasks.filter(t => t.status === "needs_escalation");
        if (allDone && escalated.length === 0) {
          console.log("\n🎉 All tasks completed!");
        } else if (allDone && escalated.length > 0) {
          console.log(`\n⚠️  Run complete. ${escalated.length} task(s) need manual intervention:`);
          for (const t of escalated) {
            console.log(`   🚨 ${t.id}: ${t.title}`);
          }
          console.log("   Use 'bart status' for details.");
        } else {
          console.log("\n📊 Run complete. Use 'bart status' to see progress.");
        }

        // Auto-generate .bart/specialists.md on run completion [REQ-06]
        const bartDir = join(cwd, BART_DIR);
        if (existsSync(bartDir)) {
          const specialists = discoverSpecialists(cwd);
          const summaryPath = join(bartDir, "specialists.md");
          writeFileSync(summaryPath, generateSpecialistsSummary(specialists, cwd));
        }

        releaseLock(cwd);
      }
      break;

    case "stop": {
      const bartDir = join(cwd, BART_DIR);
      if (!existsSync(bartDir)) {
        mkdirSync(bartDir, { recursive: true });
      }
      const stopPath = join(bartDir, STOP_FILE);
      writeFileSync(stopPath, new Date().toISOString());
      console.log("⛔ Stop signal sent. Bart will stop after the current task finishes.");
      console.log("   (The running agent will be allowed to complete its current task cleanly.)");
      break;
    }

    case "completions": {
      const subcommand = specificTask;
      if (subcommand === "zsh") {
        process.stdout.write(generateZshCompletion());
      } else if (subcommand === "bash") {
        process.stdout.write(generateBashCompletion());
      } else if (subcommand === "install") {
        const shellEnv = process.env.SHELL || "";
        const detectedShell = shellEnv.includes("zsh") ? "zsh" : shellEnv.includes("bash") ? "bash" : "";
        if (!detectedShell) {
          console.error("Could not detect shell from $SHELL. Use 'bart completions zsh' or 'bart completions bash' instead.");
          process.exit(1);
        }
        console.log(`\nInstalling ${detectedShell} completions...`);
        await installCompletions(detectedShell);
        console.log(`\n✅ ${detectedShell} completions installed. Restart your shell or run 'source ~/.${detectedShell}rc' to activate.`);
      } else {
        console.log("Usage: bart completions <zsh|bash|install>");
        console.log("  zsh     Output zsh completion script to stdout");
        console.log("  bash    Output bash completion script to stdout");
        console.log("  install Auto-detect shell and install completions");
      }
      break;
    }

    case "install": {
      const home = process.env.HOME || "";
      const claudeSkillsDir = join(home, ".claude", "skills");

      // Find package root (where skills/ directory lives)
      const packageRoot = dirname(dirname(new URL(import.meta.url).pathname));

      // Auto-discover skills: root SKILL.md + all subdirectories under skills/
      const skills: { src: string; dir: string; name: string }[] = [
        { src: join(packageRoot, "SKILL.md"), dir: join(claudeSkillsDir, "bart-loop"), name: "bart-loop" },
      ];
      const skillsSrcDir = join(packageRoot, "skills");
      if (existsSync(skillsSrcDir)) {
        for (const entry of readdirSync(skillsSrcDir, { withFileTypes: true })) {
          if (entry.isDirectory() && existsSync(join(skillsSrcDir, entry.name, "SKILL.md"))) {
            skills.push({
              src: join(skillsSrcDir, entry.name, "SKILL.md"),
              dir: join(claudeSkillsDir, entry.name),
              name: entry.name,
            });
          }
        }
      }

      let installed = 0;
      for (const skill of skills) {
        if (!existsSync(skill.src)) {
          console.log(`⚠️  Source not found: ${skill.src}`);
          continue;
        }
        mkdirSync(skill.dir, { recursive: true });
        copyFileSync(skill.src, join(skill.dir, "SKILL.md"));
        console.log(`✅ Installed ${skill.name} → ${skill.dir}/SKILL.md`);
        installed++;
      }

      if (installed > 0) {
        console.log(`\n🎉 ${installed} skill(s) installed to ${claudeSkillsDir}`);
      } else {
        console.error("\n❌ No skills found to install.");
        process.exit(1);
      }

      // Also install shell completions
      const shellEnv = process.env.SHELL || "";
      const detectedShell = shellEnv.includes("zsh") ? "zsh" : shellEnv.includes("bash") ? "bash" : "";
      if (detectedShell) {
        console.log(`\nInstalling ${detectedShell} completions...`);
        await installCompletions(detectedShell);
        console.log(`✅ Shell completions installed. Restart your shell or run 'source ~/.${detectedShell}rc' to activate.`);
      }
      break;
    }

    case "init": {
      console.log("Initializing Bart Loop...");
      const bartDir = join(cwd, BART_DIR);
      const plansDir = join(cwd, BART_DIR, "plans");
      if (!existsSync(bartDir)) {
        mkdirSync(bartDir, { recursive: true });
        console.log(`Created ${BART_DIR}/`);
      } else {
        console.log(`${BART_DIR}/ already exists`);
      }
      if (!existsSync(plansDir)) {
        mkdirSync(plansDir, { recursive: true });
        console.log(`Created ${BART_DIR}/plans/`);
      }

      // Add .bart to .gitignore if not already present
      const gitignorePath = join(cwd, ".gitignore");
      let gitignoreContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
      const hasEntry = gitignoreContent.split("\n").some(line => line.trim() === ".bart" || line.trim() === ".bart/");
      if (!hasEntry) {
        const newline = gitignoreContent.length > 0 && !gitignoreContent.endsWith("\n") ? "\n" : "";
        writeFileSync(gitignorePath, gitignoreContent + newline + ".bart\n");
        console.log(`Added .bart to .gitignore`);
      } else {
        console.log(`.bart already in .gitignore`);
      }

      // Install PostToolUse hook for auto-conversion on plan writes
      const claudeHooksDir = join(cwd, ".claude", "hooks");
      const hookDest = join(claudeHooksDir, "bart-post-plan.sh");
      const initPackageRoot = dirname(dirname(new URL(import.meta.url).pathname));
      const hookSrc = join(initPackageRoot, "hooks", "bart-post-plan.sh");

      if (existsSync(hookSrc)) {
        mkdirSync(claudeHooksDir, { recursive: true });
        copyFileSync(hookSrc, hookDest);
        chmodSync(hookDest, 0o755);
        console.log(`Installed hook → .claude/hooks/bart-post-plan.sh`);

        // Merge hook config into .claude/settings.json
        const settingsPath = join(cwd, ".claude", "settings.json");
        let settings: Record<string, any> = {};
        if (existsSync(settingsPath)) {
          try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch {}
        }

        // Ensure hooks.PostToolUse exists
        if (!settings.hooks) settings.hooks = {};
        if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

        // Check if our hook is already registered
        const hookCommand = ".claude/hooks/bart-post-plan.sh";
        const alreadyInstalled = settings.hooks.PostToolUse.some((entry: any) =>
          entry.matcher === "Write" &&
          entry.hooks?.some((h: any) => h.command === hookCommand)
        );

        if (!alreadyInstalled) {
          settings.hooks.PostToolUse.push({
            matcher: "Write",
            hooks: [
              {
                type: "command",
                command: hookCommand
              }
            ]
          });
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
          console.log(`Updated .claude/settings.json with PostToolUse hook`);
        } else {
          console.log(`PostToolUse hook already configured in .claude/settings.json`);
        }
      } else {
        console.log(`⚠️  Hook source not found: ${hookSrc}`);
      }

      console.log("Bart Loop initialized!");
      break;
    }

    case "think":
    case "t": {
      // 1. Lightweight init
      const bartDir = join(cwd, BART_DIR);
      const plansDir = join(cwd, BART_DIR, "plans");
      if (!existsSync(bartDir)) mkdirSync(bartDir, { recursive: true });
      if (!existsSync(plansDir)) mkdirSync(plansDir, { recursive: true });

      // 2. Check skill installed
      const skillPath = join(process.env.HOME || "", ".claude", "skills", "bart-think", "SKILL.md");
      if (!existsSync(skillPath)) {
        console.log("⚠️  bart-think skill not found. Run 'bart install' first.");
        process.exit(1);
      }

      console.log("\n🧠 Starting bart-think session...");
      console.log("This will guide you through structured thinking before planning.\n");
      console.log("Tell the agent what you want to build or solve.");
      console.log("The bart-think skill will auto-load when you describe your project.\n");

      // Snapshot existing plans before the session
      const plansBefore = new Set(existsSync(plansDir) ? readdirSync(plansDir) : []);

      // For think, we launch TUI mode (opencode without 'run') so it's interactive
      // The skill will auto-load based on keywords in the conversation
      const config = loadConfig();
      let thinkCmd: string;
      let thinkArgs: string[];
      
      if (config.agent === "claude") {
        thinkCmd = "claude";
        const prompt = specificTask
          ? `/bart-think ${specificTask}`
          : "/bart-think";
        thinkArgs = ["--dangerously-skip-permissions", prompt];
      } else {
        // Use opencode TUI (not 'run' mode) for interactive session
        thinkCmd = "opencode";
        thinkArgs = [];
      }

      // Install signal handlers so mode is cleared on SIGINT/SIGTERM
      installSignalHandlers(cwd);

      // Set mode to "thinking" so hooks can block execution tools
      setMode(cwd, "thinking");

      try {
        const thinkChild = spawn(thinkCmd, thinkArgs, {
          cwd,
          stdio: "inherit"
        });

        await new Promise<void>((resolve) => {
          thinkChild.on("close", () => resolve());
          thinkChild.on("error", () => resolve());
        });
      } finally {
        // Clear mode when the thinking session ends (including on crash/error)
        clearMode(cwd);
      }

      // After session ends, check if a new plan was written
      const plansAfter = existsSync(plansDir) ? readdirSync(plansDir) : [];
      const newPlans = plansAfter.filter(p => !plansBefore.has(p));
      if (newPlans.length > 0) {
        console.log("\n📋 Plan detected. Converting to tasks...");
        await runPlanCommand(cwd, resolveTasksPath(cwd), undefined, true, true);
      } else {
        console.log("\nNo plan was generated. Run 'bart think' again when ready.");
      }
      break;
    }

    case "plans":
      listPlans(cwd);
      break;

    case "convert":
    case "c":
      await runPlanCommand(cwd, tasksPath, planFilePath || specificTask, true, args.includes("-y") || args.includes("--yes"));
      break;

    case "plan":
    case "p": {
      const useLatestPlan = args.includes("--latest") || args.includes("-l");
      const autoConfirm = args.includes("-y") || args.includes("--yes");

      // Install signal handlers so mode is cleared on SIGINT/SIGTERM
      installSignalHandlers(cwd);

      // Set mode to "planning" so hooks can block execution tools
      setMode(cwd, "planning");

      try {
        await runPlanCommand(cwd, tasksPath, planFilePath, useLatestPlan, autoConfirm);
      } finally {
        clearMode(cwd);
      }
      break;
    }
      
    case "requirements":
    case "reqs":
      if (!existsSync(tasksPath)) {
        console.error("No tasks.json found. Run 'bart plan' first.");
        process.exit(1);
      }
      {
        const reqTasks = readTasks(tasksPath);
        const gapsOnly = args.includes("--gaps");
        printRequirementsReport(reqTasks, gapsOnly);
      }
      break;

    case "specialists":
      if (specificTask === "new") {
        // Launch guided specialist creation via bart-new-specialist skill
        const newSpecSkillPath = join(process.env.HOME || "", ".claude", "skills", "bart-new-specialist", "SKILL.md");
        if (!existsSync(newSpecSkillPath)) {
          console.log("⚠️  bart-new-specialist skill not found. Run 'bart install' first.");
          process.exit(1);
        }

        console.log("\n🧑‍🔬 Starting specialist creation session...");
        console.log("This will guide you through creating a new specialist profile.\n");

        const specConfig = loadConfig();
        let specCmd: string;
        let specArgs: string[];

        if (specConfig.agent === "claude") {
          specCmd = "claude";
          specArgs = ["--dangerously-skip-permissions", "/bart-new-specialist"];
        } else {
          specCmd = "opencode";
          specArgs = [];
        }

        const specChild = spawn(specCmd, specArgs, {
          cwd,
          stdio: "inherit"
        });

        await new Promise<void>((resolve) => {
          specChild.on("close", () => resolve());
        });
      } else if (specificTask === "git") {
        // Launch git-based specialist discovery via bart-specialists-git skill
        const gitSpecSkillPath = join(process.env.HOME || "", ".claude", "skills", "bart-specialists-git", "SKILL.md");
        if (!existsSync(gitSpecSkillPath)) {
          console.log("⚠️  bart-specialists-git skill not found. Run 'bart install' first.");
          process.exit(1);
        }

        console.log("\n🔍 Starting git standards analysis...");
        console.log("This will scan PR reviews and commit history to discover engineering standards.\n");

        const gitSpecConfig = loadConfig();
        let gitSpecCmd: string;
        let gitSpecArgs: string[];

        // Pass --since flag through if present
        const sinceIdx = args.indexOf("--since");
        const sinceArg = sinceIdx !== -1 && args[sinceIdx + 1] ? `--since ${args[sinceIdx + 1]}` : "";

        if (gitSpecConfig.agent === "claude") {
          gitSpecCmd = "claude";
          gitSpecArgs = ["--dangerously-skip-permissions", `/bart-specialists-git${sinceArg ? " " + sinceArg : ""}`];
        } else {
          gitSpecCmd = "opencode";
          gitSpecArgs = [];
        }

        const gitSpecChild = spawn(gitSpecCmd, gitSpecArgs, {
          cwd,
          stdio: "inherit"
        });

        await new Promise<void>((resolve) => {
          gitSpecChild.on("close", () => resolve());
        });
      } else {
        const specialists = discoverSpecialists(cwd);
        if (showBoard) {
          printSpecialistBoard(specialists, cwd);
          // Generate .bart/specialists.md
          const bartDir = join(cwd, BART_DIR);
          if (existsSync(bartDir)) {
            const summaryPath = join(bartDir, "specialists.md");
            writeFileSync(summaryPath, generateSpecialistsSummary(specialists, cwd));
            console.log(`  Updated ${summaryPath}\n`);
          }
        } else {
          printSpecialists(specialists);
          if (showHistory) printSpecialistHistory(cwd);
        }
      }
      break;

    case "suggest": {
      const taskDescription = specificTask;
      if (!taskDescription) {
        console.error('Usage: bart suggest "<task description>"');
        console.error('Example: bart suggest "Add dark mode toggle to settings page"');
        process.exit(1);
      }

      const specialists = discoverSpecialists(cwd);
      if (specialists.length === 0) {
        console.log("\nNo specialists found. Run 'bart install' to install skills.");
        process.exit(1);
      }

      // Extract file hints from remaining args (if any after the description)
      const fileHints = remainingArgs.slice(2);

      const history = loadHistory(cwd);
      const model = loadSpecialistModel(cwd);
      const scored = scoreSpecialists(taskDescription, fileHints, specialists, history, model);

      console.log(`\n🔍 Specialist suggestions for: "${taskDescription}"\n`);

      if (scored.length === 0) {
        console.log("  No specialists matched this task description.");
        console.log("  Try adding more detail or check available specialists with 'bart specialists'.\n");
        break;
      }

      const top = scored.slice(0, 10);
      for (let i = 0; i < top.length; i++) {
        const { specialist: s, confidence, rationale } = top[i];
        const pct = Math.round(confidence * 100);
        const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
        const typeLabel = s.type === "agent" ? "A" : s.type === "skill" ? "S" : s.type === "profile" ? "P" : "C";
        console.log(`  ${i + 1}. [${typeLabel}] ${s.name}  ${bar}  ${pct}%`);
        for (const r of rationale) {
          console.log(`     → ${r}`);
        }
        if (i < top.length - 1) console.log("");
      }
      console.log("");
      break;
    }

    case "config":
      if (agentOverride) {
        const agent = agentOverride;
        if (agent !== "claude" && agent !== "opencode") {
          console.error("Invalid agent. Use 'claude' or 'opencode'");
          process.exit(1);
        }
        const config = loadConfig();
        config.agent = agent;
        saveConfig(config);
        console.log(`✅ Default agent set to: ${agent}`);
      } else if (autoContinue !== undefined) {
        const config = loadConfig();
        config.auto_continue = autoContinue;
        saveConfig(config);
        console.log(`✅ Auto-continue set to: ${autoContinue}`);
      } else if (telegramSetup) {
        const rl = require("readline").createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const ask = (q: string): Promise<string> =>
          new Promise((resolve) => rl.question(q, (a: string) => resolve(a.trim())));

        console.log("\n📱 Telegram Setup");
        console.log("   1. Message @BotFather on Telegram and create a bot");
        console.log("   2. Copy the bot token");
        console.log("   3. Send a message to your bot, then get your chat ID\n");

        const botToken = await ask("Bot token: ");
        if (!botToken) {
          console.error("Bot token is required.");
          rl.close();
          process.exit(1);
        }
        const chatId = await ask("Chat ID: ");
        if (!chatId) {
          console.error("Chat ID is required.");
          rl.close();
          process.exit(1);
        }
        rl.close();

        console.log("\nSending test message...");
        const ok = await sendTelegramTestMessage(botToken, chatId);
        if (ok) {
          const config = loadConfig();
          config.telegram_bot_token = botToken;
          config.telegram_chat_id = chatId;
          saveConfig(config);
          console.log("✅ Telegram configured! Check your Telegram for a confirmation message.");
        } else {
          console.error("❌ Test message failed. Check your bot token and chat ID.");
          process.exit(1);
        }
      } else {
        const config = loadConfig();
        const tgStatus = config.telegram_bot_token && config.telegram_chat_id
          ? `configured (chat ${config.telegram_chat_id})`
          : "(not set)";
        console.log("\n📋 Current config:");
        console.log(`   agent: ${config.agent || "(not set)"}`);
        console.log(`   auto_continue: ${config.auto_continue !== undefined ? config.auto_continue : "(default: true)"}`);
        console.log(`   telegram: ${tgStatus}`);
        console.log(`\nTo set agent: bart config --agent <claude|opencode>`);
        console.log(`To set auto-continue: bart config --auto-continue (or --no-auto-continue)`);
        console.log(`To setup Telegram: bart config --telegram`);
      }
      break;
      
    case "reset":
      if (!specificTask) {
        console.error("Usage: bart reset <task-id>");
        process.exit(1);
      }
      if (!existsSync(tasksPath)) {
        console.error("No tasks.json found.");
        process.exit(1);
      }
      const resetTasks = readTasks(tasksPath);
      const resetTaskIndex = resetTasks.tasks.findIndex(t => t.id === specificTask);
      if (resetTaskIndex === -1) {
        console.error(`Task ${specificTask} not found`);
        process.exit(1);
      }
      const resetTask = resetTasks.tasks[resetTaskIndex];
      const resetPlanSlug = extractPlanSlug(tasksPath);
      const previousResets = countResetsForTask(cwd, specificTask, resetPlanSlug);

      resetTasks.tasks[resetTaskIndex].status = "pending";
      resetTasks.tasks[resetTaskIndex].started_at = null;
      resetTasks.tasks[resetTaskIndex].completed_at = null;
      resetTasks.tasks[resetTaskIndex].error = null;
      writeFileSync(tasksPath, JSON.stringify(resetTasks, null, 2));

      appendHistory(cwd, {
        timestamp: new Date().toISOString(),
        event: "reset",
        task_id: specificTask,
        plan_slug: resetPlanSlug,
        specialist: resetTask.specialist || null,
        status: "reset",
        duration_ms: null,
        resets: previousResets + 1,
        files: resetTask.files,
        workstream: resetTask.workstream,
        title: resetTask.title,
      });

      console.log(`✅ Task ${specificTask} reset to pending`);
      break;
      
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
      
    default:
      console.log(`Unknown command: ${command}`);
      showHelp();
  }
}
