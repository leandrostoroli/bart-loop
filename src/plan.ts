import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { Task, Requirement } from "./constants.js";
import { findFile } from "./tasks.js";
import { discoverSpecialists, matchSpecialist, loadSpecialistModel } from "./specialists.js";

function findLatestPlanInDirs(dirs: string[]): string | undefined {
  let latestPlan: { path: string; mtime: number } | null = null;

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
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

export function findLatestBartPlan(cwd: string): string | undefined {
  const plansDir = join(cwd, ".bart", "plans");
  if (!existsSync(plansDir)) return undefined;

  let latestPlan: { path: string; mtime: number } | null = null;

  try {
    for (const entry of readdirSync(plansDir)) {
      const entryPath = join(plansDir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      const planFile = join(entryPath, "plan.md");
      if (existsSync(planFile)) {
        const mtime = statSync(planFile).mtimeMs;
        if (!latestPlan || mtime > latestPlan.mtime) {
          latestPlan = { path: planFile, mtime };
        }
      }
    }
  } catch {}

  return latestPlan?.path;
}

export function findLatestClaudePlan(cwd: string): string | undefined {
  return findLatestPlanInDirs([
    join(cwd, ".claude", "plans"),
    join(process.env.HOME || "", ".claude", "plans"),
  ]);
}

function parseExplicitRequirements(lines: string[]): Requirement[] | null {
  const requirements: Requirement[] = [];
  let inReqSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^##\s+Requirements\s*$/i)) {
      inReqSection = true;
      continue;
    }
    if (inReqSection && trimmed.startsWith("## ")) {
      break;
    }
    if (inReqSection) {
      const match = trimmed.match(/^-\s*\[(REQ-\w+)\]\s*(.+)$/);
      if (match) {
        requirements.push({
          id: match[1],
          description: match[2].trim(),
          covered_by: [],
          status: "none"
        });
      }
    }
  }

  return requirements.length > 0 ? requirements : null;
}

function extractReqReferences(text: string): string[] {
  const matches = text.match(/\[REQ-\w+\]/g);
  if (!matches) return [];
  return matches.map(m => m.slice(1, -1));
}

export function parsePlanToTasks(planContent: string, cwd: string): { tasks: Task[]; requirements: Requirement[] } {
  const lines = planContent.split("\n");
  const tasks: Task[] = [];
  const workstreams = ["A", "B", "C", "D", "E", "F"];
  let currentWorkstreamIndex = 0;
  let currentWorkstreamTaskNum = 1;

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

  // Check for explicit requirements section
  const explicitReqs = parseExplicitRequirements(lines);
  const isExplicitMode = explicitReqs !== null;

  // Track current ## section for auto-extract mode
  let currentSectionName = "";
  const autoReqMap = new Map<string, Requirement>(); // sectionName -> Requirement

  let sectionIndex = 0;
  let sectionTaskCounts: { [key: number]: number } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
      // Skip the Requirements section itself in auto-extract mode
      const sectionTitle = extractTitle(trimmed);
      if (!sectionTitle.match(/^Requirements$/i)) {
        currentSectionName = sectionTitle;

        if (!isExplicitMode && currentSectionName) {
          const reqId = "REQ-" + currentSectionName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/-+$/, "");
          if (!autoReqMap.has(reqId)) {
            autoReqMap.set(reqId, {
              id: reqId,
              description: currentSectionName,
              covered_by: [],
              status: "none"
            });
          }
        }
      }

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

      // Determine requirements for this task
      let taskReqs: string[] = [];
      if (isExplicitMode) {
        // Scan title and description for [REQ-XX] references
        taskReqs = extractReqReferences(taskTitle + " " + description);
        // Also scan the next few lines for references
        for (let k = i; k < Math.min(i + 10, lines.length); k++) {
          taskReqs.push(...extractReqReferences(lines[k]));
        }
        taskReqs = [...new Set(taskReqs)];
      } else if (currentSectionName) {
        // Auto-extract: task inherits parent section's requirement
        const reqId = "REQ-" + currentSectionName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/-+$/, "");
        taskReqs = [reqId];
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
        error: null,
        requirements: taskReqs.length > 0 ? taskReqs : undefined
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

  // Build requirements list and coverage mapping
  let requirements: Requirement[];
  if (isExplicitMode) {
    requirements = explicitReqs!;
  } else {
    requirements = [...autoReqMap.values()];
  }

  // Map tasks to requirements (covered_by)
  for (const task of tasks) {
    if (task.requirements) {
      for (const reqId of task.requirements) {
        const req = requirements.find(r => r.id === reqId);
        if (req && !req.covered_by.includes(task.id)) {
          req.covered_by.push(task.id);
        }
      }
    }
  }

  return { tasks, requirements };
}

export async function runPlanCommand(cwd: string, _tasksPath: string, planPathArg?: string, useLatestPlan?: boolean, autoConfirm?: boolean) {
  let planPath = planPathArg;

  if (!planPath && useLatestPlan) {
    // Check .bart/plans/ first, then Claude's plans
    console.log("🔍 Searching for latest plan...");
    planPath = findLatestBartPlan(cwd) || undefined;
    if (planPath) {
      console.log(`   Found (bart): ${planPath}\n`);
    } else {
      planPath = findLatestClaudePlan(cwd) || undefined;
      if (planPath) {
        console.log(`   Found (claude): ${planPath}\n`);
      }
    }

    if (planPath && !autoConfirm) {
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

  if (!planPath) {
    // Fall back to plan.md in .bart/ or project root
    const bartPlan = join(cwd, ".bart", "plan.md");
    if (existsSync(bartPlan)) {
      planPath = bartPlan;
    } else {
      const foundPlan = findFile("plan.md", cwd) || findFile("PLAN.md", cwd);
      planPath = foundPlan || undefined;
    }
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
  const { tasks, requirements } = parsePlanToTasks(planContent, cwd);

  // Auto-assign specialists to tasks (uses ML model when available [REQ-02])
  const specialists = discoverSpecialists(cwd);
  if (specialists.length > 0) {
    const model = loadSpecialistModel(cwd);
    let assigned = 0;
    for (const task of tasks) {
      const match = matchSpecialist(task, specialists, model);
      if (match) {
        task.specialist = match.name;
        assigned++;
      }
    }
    if (assigned > 0) {
      console.log(`Specialists: ${assigned} task(s) auto-assigned from ${specialists.length} available specialist(s)`);
    }
  }

  const bartPlansDir = join(cwd, ".bart", "plans");

  // Derive a descriptive name from the plan's first heading or source filename
  const titleMatch = planContent.match(/^#\s+(?:Plan:\s*)?(.+)/m);
  const slug = titleMatch
    ? titleMatch[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "").slice(0, 60)
    : "plan";
  const timestamp = new Date().toISOString().slice(0, 10);
  const planDirName = `${timestamp}-${slug}`;
  const planDir = join(bartPlansDir, planDirName);
  mkdirSync(planDir, { recursive: true });

  const destPlanPath = join(planDir, "plan.md");
  writeFileSync(destPlanPath, planContent);

  const planTasksPath = join(planDir, "tasks.json");

  const tasksData = {
    project: cwd.split("/").pop() || "project",
    plan_file: `.bart/plans/${planDirName}/plan.md`,
    project_root: cwd,
    requirements: requirements.length > 0 ? requirements : undefined,
    tasks
  };

  writeFileSync(planTasksPath, JSON.stringify(tasksData, null, 2));

  console.log(`✅ Generated ${tasks.length} tasks in ${planTasksPath}\n`);

  const workstreams = [...new Set(tasks.map(t => t.workstream))].sort();
  console.log("Workstreams:");
  for (const ws of workstreams) {
    const wsTasks = tasks.filter(t => t.workstream === ws);
    console.log(`  ${ws}: ${wsTasks.length} tasks`);
  }

  if (requirements.length > 0) {
    const covered = requirements.filter(r => r.covered_by.length > 0).length;
    console.log(`\nRequirements: ${covered}/${requirements.length} covered`);
    const uncovered = requirements.filter(r => r.covered_by.length === 0);
    if (uncovered.length > 0) {
      console.log("  Uncovered:");
      for (const r of uncovered) {
        console.log(`    ${r.id}: ${r.description}`);
      }
    }
  }

  console.log("\nRun 'bart status' or 'bart dashboard' to view progress.");
}
