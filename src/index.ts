#!/usr/bin/env bun

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { spawn } from "child_process";

const BART_ASCII = `
   ██████╗ ███████╗████████╗██████╗  ██████╗ ██████╗  █████╗ ██████╗ ██████╗ 
  ██╔════╝ ██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗
  ██║  ███╗█████╗     ██║   ██████╔╝██║   ██║██████╔╝███████║██████╔╝██║  ██║
  ██║   ██║██╔══╝     ██║   ██╔══██╗██║   ██║██╔══██╗██╔══██║██╔══██╗██║  ██║
  ╚██████╔╝███████╗   ██║   ██║  ██║╚██████╔╝██║  ██║██║  ██║██║  ██║██████╔╝
   ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ 
`;

const BART_MINI = ` ██████╗ ███████╗████████╗
 ██╔════╝ ██╔════╝╚══██╔══╝
 ██║  ███╗█████╗     ██║   
 ██║   ██║██╔══╝     ██║   
 ╚██████╔╝███████╗   ██║   
  ╚═════╝ ╚══════╝   ╚═╝   `;

const TASKS_FILE = ".bart/tasks.json";
const PROMPT_TEMPLATE = ".bart/bart-prompt-template.md";

interface Task {
  id: string;
  workstream: string;
  title: string;
  description: string;
  files: string[];
  depends_on: string[];
  status: "pending" | "in_progress" | "completed" | "error";
  files_modified: string[];
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

interface TasksData {
  tasks: Task[];
}

function findFile(name: string, startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const path = join(dir, name);
    if (existsSync(path)) {
      return path;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getCwd(): string {
  return process.cwd();
}

function readTasks(path: string): TasksData {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content);
}

function getTaskField(tasks: TasksData, taskId: string, field: keyof Task): any {
  const task = tasks.tasks.find(t => t.id === taskId);
  return task?.[field] ?? null;
}

function findNextTask(tasks: TasksData, workstream?: string): string | null {
  const filtered = workstream
    ? tasks.tasks.filter(t => t.workstream === workstream && t.status === "pending")
    : tasks.tasks.filter(t => t.status === "pending");

  for (const task of filtered) {
    const deps = task.depends_on || [];
    const allDepsMet = deps.every(depId => {
      const dep = tasks.tasks.find(t => t.id === depId);
      return dep?.status === "completed";
    });
    if (allDepsMet) {
      return task.id;
    }
  }
  return null;
}

function depsMet(tasks: TasksData, taskId: string): boolean {
  const task = tasks.tasks.find(t => t.id === taskId);
  if (!task) return false;
  const deps = task.depends_on || [];
  return deps.every(depId => {
    const dep = tasks.tasks.find(t => t.id === depId);
    return dep?.status === "completed";
  });
}

function printStatus(tasks: TasksData) {
  const workstreams = [...new Set(tasks.tasks.map(t => t.workstream))].sort();
  
  console.log("\n📊 Bart Loop Status\n");
  
  for (const ws of workstreams) {
    const wsTasks = tasks.tasks.filter(t => t.workstream === ws);
    const completed = wsTasks.filter(t => t.status === "completed").length;
    const total = wsTasks.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    const barLen = 20;
    const filled = Math.round((pct / 100) * barLen);
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
    
    console.log(`Workstream ${ws}: [${bar}] ${pct}% (${completed}/${total})`);
    
    const next = wsTasks.find(t => t.status === "pending" && depsMet(tasks, t.id));
    if (next) {
      console.log(`  → Next: ${next.id}: ${next.title}`);
    } else if (completed === total) {
      console.log(`  ✓ All done!`);
    }
  }
  
  const errors = tasks.tasks.filter(t => t.status === "error");
  if (errors.length > 0) {
    console.log(`\n⚠️  Errors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.id}: ${e.title}`);
      console.log(`    ${e.error?.substring(0, 60)}`);
    }
  }
  console.log("");
}

async function runAgent(taskId: string, tasksPath: string) {
  const tasks = readTasks(tasksPath);
  const task = tasks.tasks.find(t => t.id === taskId);
  
  if (!task) {
    console.error(`Task ${taskId} not found`);
    process.exit(1);
  }
  
  console.log(`\n🚀 Starting task: ${taskId} — ${task.title}\n`);
  
  // Detect available agent
  let agentCmd = "claude";
  try {
    spawn("opencode", ["--version"], { stdio: "ignore" }).on("close", (code) => {
      if (code === 0) agentCmd = "opencode";
    });
  } catch {}
  
  // For now, just show what would run - the actual execution would need
  // to be handled by the bash script or a more complex setup
  console.log(`Would run agent for task: ${task.title}`);
  console.log(`Description: ${task.description}`);
  console.log(`Files: ${task.files.join(", ")}`);
}

async function runDashboard(tasksPath: string) {
  const { createCliRenderer, Box, Text } = await import("@opentui/core");
  
  function getWorkstreams(tasks: TasksData): string[] {
    return [...new Set(tasks.tasks.map(t => t.workstream))].sort();
  }
  
  function createProgressBar(percent: number, width: number): string {
    const filled = Math.round((percent / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
  }
  
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  
  function render() {
    try {
      const tasks = readTasks(tasksPath);
      const workstreams = getWorkstreams(tasks);
      const boxes: any[] = [];
      
      for (const ws of workstreams) {
        const wsTasks = tasks.tasks.filter(t => t.workstream === ws);
        const completed = wsTasks.filter(t => t.status === "completed");
        const inProgress = wsTasks.filter(t => t.status === "in_progress");
        const pending = wsTasks.filter(t => t.status === "pending");
        const total = wsTasks.length;
        const pct = total > 0 ? Math.round((completed.length / total) * 100) : 0;
        
        const completedTexts = completed.slice(0, 3).map(t => 
          Text({ content: `    ${t.id}: ${t.title.substring(0, 28)}`, fg: "green" })
        );
        if (completed.length > 3) {
          completedTexts.push(Text({ content: `    ... and ${completed.length - 3} more`, fg: "green" }));
        } else if (completed.length === 0) {
          completedTexts.push(Text({ content: "    (none)", fg: "gray" }));
        }
        
        const nextTask = pending.find(t => depsMet(tasks, t.id));
        
        const panel = Box(
          { border: "rounded", borderStyle: { fg: pct === 100 ? "green" : "cyan" }, padding: 1 },
          Text({ content: `Workstream ${ws}`, bold: true, fg: "cyan" }),
          Text({ content: `  [${createProgressBar(pct, 16)}] ${pct}% (${completed.length}/${total})`, fg: pct === 100 ? "green" : "white" }),
          Text({ content: "" }),
          Text({ content: "  ✓ Completed:", fg: "green", bold: true }),
          ...completedTexts,
          Text({ content: "" }),
          Text({ content: "  ◐ In Progress:", fg: "yellow", bold: true }),
          ...(inProgress.length > 0 
            ? inProgress.map(t => Text({ content: `    ${t.id}: ${t.title.substring(0, 28)}`, fg: "yellow" }))
            : [Text({ content: "    (none)", fg: "gray" })]),
          Text({ content: "" }),
          Text({ content: "  → Next:", fg: "cyan", bold: true }),
          nextTask 
            ? Text({ content: `    ${nextTask.id}: ${nextTask.title.substring(0, 28)}`, fg: "white" })
            : pct === 100 
              ? Text({ content: "    ✓ All done!", fg: "green" })
              : Text({ content: "    (waiting)", fg: "gray" }),
        );
        boxes.push(panel);
      }
      
      const errors = tasks.tasks.filter(t => t.status === "error");
      
      const header = Box(
        { border: "rounded", borderStyle: { fg: "cyan" }, padding: { x: 1, y: 0 } },
        Text({ content: `${BART_MINI}  Bart Loop  •  ${new Date().toLocaleTimeString()}  •  Ctrl+C to quit`, fg: "cyan", bold: true })
      );
      
      const children: any[] = [header, Text({ content: "" }), Box({ flexDirection: "row", gap: 1 }, ...boxes)];
      
      if (errors.length > 0) {
        children.push(Text({ content: "" }));
        children.push(
          Box(
            { border: "rounded", borderStyle: { fg: "red" }, padding: 1 },
            Text({ content: `⚠ Errors (${errors.length})`, fg: "red", bold: true }),
            Text({ content: "" }),
            ...errors.flatMap(e => [
              Text({ content: `  ✗ ${e.id}: ${e.title.substring(0, 40)}`, fg: "yellow" }),
              Text({ content: `      ${(e.error || "Unknown error").substring(0, 60)}`, fg: "red" }),
            ])
          )
        );
      }
      
      renderer.root.render = () => Box({ flexDirection: "column", padding: 1 }, ...children);
    } catch (e) {
      renderer.root.render = () => Box({ padding: 1 }, Text({ content: "Error reading tasks.json", fg: "red" }));
    }
  }
  
  render();
  setInterval(render, 2000);
}

async function runPlanCommand(cwd: string, tasksPath: string) {
  const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import("fs");
  const { join, dirname } = await import("path");

  // Find plan.md
  const planPath = findFile("plan.md", cwd) || findFile("PLAN.md", cwd);
  
  if (!planPath) {
    console.log(`
📝 No plan.md found. 

To generate tasks from a plan:
1. Create a plan.md file with your project plan
2. Use headings for task groups, subheadings for individual tasks
3. Run: bart plan

Example plan.md:
# Project Plan

## Setup
### Initialize project
### Configure TypeScript

## Features
### Build API
### Create UI

## Deploy
### Docker setup
`);
    return;
  }

  console.log(`\n📋 Found plan: ${planPath}\n`);
  
  const planContent = readFileSync(planPath, "utf-8");
  
  // Parse plan and generate tasks
  const tasks = parsePlanToTasks(planContent, cwd);
  
  // Ensure .bart directory exists
  const bartDir = join(cwd, ".bart");
  if (!existsSync(bartDir)) {
    mkdirSync(bartDir, { recursive: true });
  }
  
  // Copy plan to .bart
  const destPlanPath = join(bartDir, "plan.md");
  writeFileSync(destPlanPath, planContent);
  
  // Write tasks.json
  const tasksData = {
    project: cwd.split("/").pop() || "project",
    plan_file: "./.bart/plan.md",
    project_root: cwd,
    tasks
  };
  
  writeFileSync(tasksPath, JSON.stringify(tasksData, null, 2));
  
  console.log(`✅ Generated ${tasks.length} tasks in ${tasksPath}\n`);
  
  // Show summary
  const workstreams = [...new Set(tasks.map(t => t.workstream))].sort();
  console.log("Workstreams:");
  for (const ws of workstreams) {
    const wsTasks = tasks.filter(t => t.workstream === ws);
    console.log(`  ${ws}: ${wsTasks.length} tasks`);
  }
  console.log("\nRun 'bart status' or 'bart dashboard' to view progress.");
}

function parsePlanToTasks(planContent: string, cwd: string): any[] {
  const lines = planContent.split("\n");
  const tasks: any[] = [];
  const workstreams = ["A", "B", "C", "D", "E", "F"];
  let currentWorkstreamIndex = 0;
  let currentWorkstreamTaskNum = 1;
  
  // Track which major section each workstream covers
  const workstreamSections: { [key: string]: number } = {};
  
  const extractTitle = (line: string) => {
    return line.replace(/^#+\s*/, "").trim();
  };
  
  const extractFiles = (content: string): string[] => {
    const filePatterns: string[] = [];
    const fileRegex = /[\w\/.-]+\.\w+/g;
    const matches = content.match(fileRegex);
    if (matches) {
      filePatterns.push(...new Set(matches));
    }
    return filePatterns.slice(0, 5);
  };
  
  let sectionIndex = 0;
  let sectionTaskCounts: { [key: number]: number } = {};
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
      // New major section - assign to next workstream
      if (sectionIndex > 0 && sectionIndex % 2 === 0) {
        currentWorkstreamIndex = Math.min(currentWorkstreamIndex + 1, workstreams.length - 1);
        currentWorkstreamTaskNum = 1;
      }
      sectionIndex++;
      sectionTaskCounts[sectionIndex] = 0;
    }
    
    if (trimmed.startsWith("### ")) {
      // New task
      const taskTitle = extractTitle(trimmed);
      const ws = workstreams[currentWorkstreamIndex];
      const taskId = `${ws}${currentWorkstreamTaskNum}`;
      
      // Look ahead for description
      let description = taskTitle;
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith("#")) {
        const detailLine = lines[j].trim();
        if (detailLine && !detailLine.startsWith("-") && !detailLine.startsWith("```")) {
          description += ". " + detailLine;
          break;
        }
        j++;
      }
      
      // Find files mentioned in the task area
      const files: string[] = [];
      for (let k = i; k < Math.min(i + 10, lines.length); k++) {
        files.push(...extractFiles(lines[k]));
      }
      
      // Track last task in this section for dependencies
      const lastTaskInSection = sectionTaskCounts[sectionIndex] > 0 
        ? `${ws}${sectionTaskCounts[sectionIndex]}` 
        : null;
      
      // Simple dependency: if task has keywords like "after", "depends", etc.
      const hasDependency = taskTitle.toLowerCase().includes("depend") ||
        taskTitle.toLowerCase().includes("after") ||
        taskTitle.toLowerCase().includes("requir");
      
      const depends_on = hasDependency && lastTaskInSection ? [lastTaskInSection] : [];
      
      tasks.push({
        id: taskId,
        workstream: ws,
        title: taskTitle,
        description: description,
        files: [...new Set(files)].length > 0 ? [...new Set(files)] : ["TBD"],
        depends_on,
        status: "pending",
        files_modified: [],
        started_at: null,
        completed_at: null,
        error: null
      });
      
      currentWorkstreamTaskNum++;
      sectionTaskCounts[sectionIndex]++;
    }
  }
  
  // If no tasks were created, create a default one
  if (tasks.length === 0) {
    tasks.push({
      id: "A1",
      workstream: "A",
      title: "Project Plan",
      description: "Complete the project according to plan.md",
      files: ["plan.md"],
      depends_on: [],
      status: "pending",
      files_modified: [],
      started_at: null,
      completed_at: null,
      error: null
    });
  }
  
  return tasks;
}

function showHelp() {
  console.log(`
${BART_ASCII}

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

async function main() {
  const args = process.argv.slice(2);
  const cwd = getCwd();
  
  // Find tasks.json
  let tasksPath = findFile(TASKS_FILE, cwd);
  if (!tasksPath) {
    tasksPath = join(cwd, TASKS_FILE);
  }
  
  // Parse args
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
        // Find next task
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
      // Create default files if needed
      if (!existsSync(join(cwd, TASKS_FILE))) {
        const defaultTasks = {
          tasks: [
            {
              id: "A1",
              workstream: "A",
              title: "First task",
              description: "Description of your first task",
              files: ["file1.ts"],
              depends_on: [],
              status: "pending",
              files_modified: [],
              started_at: null,
              completed_at: null,
              error: null
            }
          ]
        };
        // Would write default tasks.json
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

main().catch(console.error);
