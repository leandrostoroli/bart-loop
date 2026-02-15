import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { Task } from "./constants.js";
import { findFile } from "./tasks.js";

export function findLatestClaudePlan(cwd: string): string | undefined {
  const claudePlansDir = join(process.env.HOME || "", ".claude", "plans");
  const projectPlansDir = join(cwd, ".claude", "plans");
  
  const searchDirs = [];
  if (existsSync(projectPlansDir)) {
    searchDirs.push(projectPlansDir);
  }
  if (existsSync(claudePlansDir)) {
    searchDirs.push(claudePlansDir);
  }
  
  let latestPlan: { path: string; mtime: number } | null = null;
  
  for (const dir of searchDirs) {
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = join(dir, file);
          const stats = statSync(filePath);
          if (!latestPlan || stats.mtimeMs > latestPlan.mtime) {
            latestPlan = { path: filePath, mtime: stats.mtimeMs };
          }
        }
      }
    } catch {}
  }
  
  return latestPlan?.path || undefined;
}

export function parsePlanToTasks(planContent: string, cwd: string): Task[] {
  const lines = planContent.split("\n");
  const tasks: Task[] = [];
  const workstreams = ["A", "B", "C", "D", "E", "F"];
  let currentWorkstreamIndex = 0;
  let currentWorkstreamTaskNum = 1;
  
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
      if (sectionIndex > 0 && sectionIndex % 2 === 0) {
        currentWorkstreamIndex = Math.min(currentWorkstreamIndex + 1, workstreams.length - 1);
        currentWorkstreamTaskNum = 1;
      }
      sectionIndex++;
      sectionTaskCounts[sectionIndex] = 0;
    }
    
    if (trimmed.startsWith("### ")) {
      const taskTitle = extractTitle(trimmed);
      const ws = workstreams[currentWorkstreamIndex];
      const taskId = `${ws}${currentWorkstreamTaskNum}`;
      
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
      
      const files: string[] = [];
      for (let k = i; k < Math.min(i + 10, lines.length); k++) {
        files.push(...extractFiles(lines[k]));
      }
      
      const lastTaskInSection = sectionTaskCounts[sectionIndex] > 0 
        ? `${ws}${sectionTaskCounts[sectionIndex]}` 
        : null;
      
      const hasDependency = taskTitle.toLowerCase().includes("depend") ||
        taskTitle.toLowerCase().includes("after") ||
        taskTitle.toLowerCase().includes("requir");
      
      const depends_on = hasDependency && lastTaskInSection ? [lastTaskInSection] : [];
      
      tasks.push({
        id: taskId,
        workstream: ws,
        title: taskTitle,
        description,
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

export async function runPlanCommand(cwd: string, tasksPath: string, planPathArg?: string, useLatestPlan?: boolean, autoConfirm?: boolean) {
  let planPath = planPathArg;
  
  if (!planPath && useLatestPlan) {
    console.log("🔍 Searching for latest Claude plan...");
    planPath = findLatestClaudePlan(cwd) || undefined;
    if (planPath) {
      console.log(`   Found: ${planPath}\n`);
      
      if (!autoConfirm) {
        const readline = require("readline").createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const confirmed = await new Promise<boolean>((resolve) => {
          readline.question("Use this plan? (Y/n) ", (answer: string) => {
            readline.close();
            resolve(answer.trim().toLowerCase() !== "n");
          });
        });
        
        if (!confirmed) {
          console.log("Cancelled.");
          return;
        }
      }
    }
  }
  
  if (!planPath) {
    const foundPlan = findFile("plan.md", cwd) || findFile("PLAN.md", cwd);
    planPath = foundPlan || undefined;
  } else if (!existsSync(planPath)) {
    console.error(`Plan file not found: ${planPath}`);
    process.exit(1);
  }
  
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
  const tasks = parsePlanToTasks(planContent, cwd);
  
  const bartDir = join(cwd, ".bart");
  if (!existsSync(bartDir)) {
    mkdirSync(bartDir, { recursive: true });
  }
  
  const destPlanPath = join(bartDir, "plan.md");
  writeFileSync(destPlanPath, planContent);
  
  const tasksData = {
    project: cwd.split("/").pop() || "project",
    plan_file: "./.bart/plan.md",
    project_root: cwd,
    tasks
  };
  
  writeFileSync(tasksPath, JSON.stringify(tasksData, null, 2));
  
  console.log(`✅ Generated ${tasks.length} tasks in ${tasksPath}\n`);
  
  const workstreams = [...new Set(tasks.map(t => t.workstream))].sort();
  console.log("Workstreams:");
  for (const ws of workstreams) {
    const wsTasks = tasks.filter(t => t.workstream === ws);
    console.log(`  ${ws}: ${wsTasks.length} tasks`);
  }
  console.log("\nRun 'bart status' or 'bart dashboard' to view progress.");
}
