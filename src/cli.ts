import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { spawn } from "child_process";
import { BART, BART_DIR } from "./constants.js";
import { readTasks, findNextTask, getCwd, getTaskById, resolvePlanTasksPath } from "./tasks.js";
import { printStatus, printWorkstreamStatus, printRequirementsReport } from "./status.js";
import { runDashboard } from "./dashboard.js";
import { runPlanCommand } from "./plan.js";
import { sendNotification, isNotificationConfigured } from "./notify.js";
import { discoverSpecialists, printSpecialists, parseFrontmatter } from "./specialists.js";
import { generateZshCompletion, generateBashCompletion, installCompletions } from "./completions.js";

const CONFIG_DIR = join(process.env.HOME || "", ".bart");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface BartConfig {
  agent?: string;
  auto_continue?: boolean;
  notify_url?: string;
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
  bart plan              Generate tasks from plan.md
  bart plan --latest     Generate tasks from latest plan (.bart/plans/ first, then Claude plans)
  bart plan --latest -y  Generate tasks from latest plan (skip confirmation)
  bart convert           Convert latest plan to bart tasks (checks .bart/plans/ first)
  bart convert <path>    Convert a specific plan file to bart tasks
  bart plan --plan-file <path>  Generate tasks from custom plan file
  bart watch             Auto-refresh dashboard
  bart requirements      Show requirements coverage report
  bart requirements --gaps  Show only uncovered/partial requirements
  bart specialists       List discovered specialists (skills, agents, commands)
  bart reset <task-id>   Reset task to pending
  bart completions zsh   Output zsh completion script to stdout
  bart completions bash  Output bash completion script to stdout
  bart completions install  Auto-detect shell and install completions
  bart install           Install bart skills and shell completions
  bart init              Initialize bart in current project
  bart config            Show current config
  bart config --agent <name>  Set default agent (claude, opencode)
  bart config --notify-url <url>  Set notification URL (iOS Shortcuts)
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

export async function runAgent(taskId: string, tasksPath: string, agentOverride?: string, autoContinue?: boolean) {
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
  
  console.log(`\n🚀 Starting task: ${taskId} — ${task.title}\n`);
  console.log(`📁 Working directory: ${projectRoot}\n`);
  
  const tasksData = readTasks(tasksPath);
  const taskIndex = tasksData.tasks.findIndex(t => t.id === taskId);
  if (taskIndex !== -1) {
    tasksData.tasks[taskIndex].status = "in_progress";
    tasksData.tasks[taskIndex].started_at = new Date().toISOString();
    writeFileSync(tasksPath, JSON.stringify(tasksData, null, 2));
  }
  
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
  if (task.specialist) {
    const specialists = discoverSpecialists(projectRoot);
    const specialist = specialists.find(s => s.name === task.specialist);
    if (specialist) {
      try {
        const content = readFileSync(specialist.path, "utf-8");
        const fm = parseFrontmatter(content);
        const desc = fm.description || specialist.description;
        specialistContext = `\nSpecialist: ${specialist.name} (${specialist.type})\nSpecialist context: ${desc}\n`;
        console.log(`   Specialist: ${specialist.name} (${specialist.type})\n`);
      } catch {
        specialistContext = `\nSpecialist: ${specialist.name} (${specialist.type})\nSpecialist context: ${specialist.description}\n`;
      }
    }
  }

  const taskPrompt = `Task: ${task.title}
Description: ${task.description}
Files to work on: ${task.files.join(", ")}${specialistContext}

Please complete this task.`;
  
  const args = [...agentConfig.args, taskPrompt];
  
  const child = spawn(agentConfig.cmd, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });
  
  await new Promise<void>((resolve) => {
    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`\n⚠️ Agent exited with code ${code}`);
        process.exit(code || 1);
      }
      resolve();
    });
  });
  
  const finalTasksData = readTasks(tasksPath);
  const finalTaskIndex = finalTasksData.tasks.findIndex(t => t.id === taskId);
  if (finalTaskIndex !== -1) {
    finalTasksData.tasks[finalTaskIndex].status = "completed";
    finalTasksData.tasks[finalTaskIndex].completed_at = new Date().toISOString();
    writeFileSync(tasksPath, JSON.stringify(finalTasksData, null, 2));
    console.log(`\n✅ Task ${taskId} marked as completed`);
  }
  
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
  let notifyUrl: string | undefined;

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
    } else if (arg === "--notify-url" && args[i + 1]) {
      notifyUrl = args[i + 1];
      skipNext = true;
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
      
      if (specificTask) {
        await runAgent(specificTask, tasksPath, agentOverride, autoContinue);
      } else {
        let running = true;
        let iterations = 0;
        while (running) {
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
            const shouldContinue = await runAgent(next, tasksPath, agentOverride, autoContinue);
            
            const tasksAfter = readTasks(tasksPath);
            const currentTask = tasksAfter.tasks.find(t => t.id === next);
            const ws = currentTask?.workstream;
            
            if (ws) {
              const wsTasks = tasksAfter.tasks.filter(t => t.workstream === ws);
              const completed = wsTasks.filter(t => t.status === "completed").length;
              const total = wsTasks.length;
              
              if (completed === total) {
                console.log(`\n🎉 Workstream ${ws} completed!`);
                await sendNotification({
                  name: ws,
                  status: "completed",
                  message: `Workstream ${ws} done ${completed} of ${total} tasks`
                });
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
                
                const depsList = [...depsFromOtherWs].join(", ");
                await sendNotification({
                  name: workstream || "unknown",
                  status: "blocked",
                  message: `Waiting on workstream ${depsList}`
                });
                
                running = false;
                continue;
              }
              
              console.log("\n🔄 Checking every 5 seconds for dependency resolution...");
              
              let waited = 0;
              while (waited < 120) {
                await new Promise(resolve => setTimeout(resolve, 5000));
                waited += 5;
                
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
        const allDone = finalTasks.tasks.every(t => 
          !workstream || t.workstream === workstream ? t.status === "completed" : true
        );
        if (allDone) {
          console.log("\n🎉 All tasks completed!");
        } else {
          console.log("\n📊 Run complete. Use 'bart status' to see progress.");
        }
      }
      break;
      
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

      const skills = [
        { src: join(packageRoot, "skills", "bart-plan", "SKILL.md"), dir: join(claudeSkillsDir, "bart-plan"), name: "bart-plan" },
        { src: join(packageRoot, "SKILL.md"), dir: join(claudeSkillsDir, "bart-loop"), name: "bart-loop" },
      ];

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

    case "init":
      console.log("Initializing Bart Loop...");
      if (!existsSync(join(cwd, BART_DIR, "tasks.json"))) {
        console.log("Created tasks.json template");
      }
      console.log("Bart Loop initialized!");
      break;

    case "plans":
      listPlans(cwd);
      break;

    case "convert":
    case "c":
      await runPlanCommand(cwd, tasksPath, planFilePath || specificTask, true, args.includes("-y") || args.includes("--yes"));
      break;

    case "plan":
    case "p":
      const useLatestPlan = args.includes("--latest") || args.includes("-l");
      const autoConfirm = args.includes("-y") || args.includes("--yes");
      await runPlanCommand(cwd, tasksPath, planFilePath, useLatestPlan, autoConfirm);
      break;
      
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
      {
        const specialists = discoverSpecialists(cwd);
        printSpecialists(specialists);
      }
      break;

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
      } else if (notifyUrl) {
        const config = loadConfig();
        config.notify_url = notifyUrl;
        saveConfig(config);
        console.log(`✅ Notification URL set`);
        console.log(`   Format: ${notifyUrl}&input=...`);
      } else {
        const config = loadConfig();
        console.log("\n📋 Current config:");
        console.log(`   agent: ${config.agent || "(not set)"}`);
        console.log(`   auto_continue: ${config.auto_continue !== undefined ? config.auto_continue : "(default: true)"}`);
        console.log(`   notify_url: ${config.notify_url || "(not set)"}`);
        console.log(`\nTo set agent: bart config --agent <claude|opencode>`);
        console.log(`To set auto-continue: bart config --auto-continue (or --no-auto-continue)`);
        console.log(`To set notify URL: bart config --notify-url "shortcuts://..."`);
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
      resetTasks.tasks[resetTaskIndex].status = "pending";
      resetTasks.tasks[resetTaskIndex].started_at = null;
      resetTasks.tasks[resetTaskIndex].completed_at = null;
      resetTasks.tasks[resetTaskIndex].error = null;
      writeFileSync(tasksPath, JSON.stringify(resetTasks, null, 2));
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
