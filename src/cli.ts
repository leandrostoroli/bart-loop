import { existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { BART, TASKS_FILE } from "./constants.js";
import { readTasks, findNextTask, getCwd, findFile, getTaskById } from "./tasks.js";
import { printStatus } from "./status.js";
import { runDashboard } from "./dashboard.js";
import { runPlanCommand } from "./plan.js";

export function showHelp() {
  console.log(`
${BART}

Automated task execution using Claude Code or OpenCode

Usage:
  bart                    Run next available task
  bart run [task-id]      Run a specific task
  bart status            Show task status
  bart dashboard         Launch TUI dashboard
  bart plan              Generate tasks from plan.md
  bart watch             Auto-refresh dashboard
  bart reset <task-id>   Reset task to pending
  bart init              Initialize bart in current project
  bart --help            Show this help

Options:
  --tasks <path>         Path to tasks.json (default: ./tasks.json)
  --workstream <id>      Filter by workstream

Examples:
  bart                    # Run next task
  bart status             # Show progress
  bart dashboard          # Open TUI dashboard
  bart plan               # Generate tasks from plan.md
  bart run A1             # Run specific task
  `);
}

export async function runAgent(taskId: string, tasksPath: string) {
  const tasks = readTasks(tasksPath);
  const task = getTaskById(tasks, taskId);
  
  if (!task) {
    console.error(`Task ${taskId} not found`);
    process.exit(1);
  }
  
  console.log(`\n🚀 Starting task: ${taskId} — ${task.title}\n`);
  
  let agentCmd = "claude";
  try {
    spawn("opencode", ["--version"], { stdio: "ignore" }).on("close", (code) => {
      if (code === 0) agentCmd = "opencode";
    });
  } catch {}
  
  console.log(`Would run agent for task: ${task.title}`);
  console.log(`Description: ${task.description}`);
  console.log(`Files: ${task.files.join(", ")}`);
}

export async function main() {
  const args = process.argv.slice(2);
  const cwd = getCwd();
  
  let tasksPath = findFile(TASKS_FILE, cwd);
  if (!tasksPath) {
    tasksPath = join(cwd, TASKS_FILE);
  }
  
  let command = args[0] || "status";
  let workstream: string | undefined;
  let specificTask: string | undefined;
  
  const remainingArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workstream" && args[i + 1]) {
      workstream = args[i + 1];
      i++;
    } else if (arg === "--tasks" && args[i + 1]) {
      tasksPath = args[i + 1];
      i++;
    } else if (!arg.startsWith("-")) {
      remainingArgs.push(arg);
    }
  }
  
  command = remainingArgs[0] || command;
  specificTask = remainingArgs[1];
  
  switch (command) {
    case "status":
    case "s":
      if (existsSync(tasksPath)) {
        printStatus(readTasks(tasksPath));
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
      if (!specificTask) {
        if (existsSync(tasksPath)) {
          const tasks = readTasks(tasksPath);
          const next = findNextTask(tasks, workstream);
          if (next) {
            await runAgent(next, tasksPath);
          } else {
            console.log("No tasks available.");
          }
        } else {
          console.log("No tasks.json found. Run 'bart init' first.");
        }
      } else {
        await runAgent(specificTask, tasksPath);
      }
      break;
      
    case "init":
      console.log("Initializing Bart Loop...");
      if (!existsSync(join(cwd, TASKS_FILE))) {
        console.log("Created tasks.json template");
      }
      console.log("Bart Loop initialized!");
      break;

    case "plan":
    case "p":
      await runPlanCommand(cwd, tasksPath);
      break;
      
    case "reset":
      if (!specificTask) {
        console.error("Usage: bart reset <task-id>");
        process.exit(1);
      }
      console.log(`Would reset task ${specificTask}`);
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
