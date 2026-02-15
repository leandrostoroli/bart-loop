import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { Task, TasksData, Requirement, BART_DIR } from "./constants.js";

export function findFile(name: string, startDir: string): string | null {
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

export function getCwd(): string {
  return process.cwd();
}

export function readTasks(path: string): TasksData {
  const content = readFileSync(path, "utf-8");
  return JSON.parse(content);
}

export function getTaskField(tasks: TasksData, taskId: string, field: keyof Task): any {
  const task = tasks.tasks.find(t => t.id === taskId);
  return task?.[field] ?? null;
}

export function findNextTask(tasks: TasksData, workstream?: string): string | null {
  const pending = tasks.tasks.filter(t => t.status === "pending");
  
  for (const task of pending) {
    if (workstream && task.workstream !== workstream) {
      continue;
    }
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

export function depsMet(tasks: TasksData, taskId: string): boolean {
  const task = tasks.tasks.find(t => t.id === taskId);
  if (!task) return false;
  const deps = task.depends_on || [];
  return deps.every(depId => {
    const dep = tasks.tasks.find(t => t.id === depId);
    return dep?.status === "completed";
  });
}

export function getTaskById(tasks: TasksData, taskId: string): Task | undefined {
  return tasks.tasks.find(t => t.id === taskId);
}

/**
 * Resolve the correct tasks.json path for a plan.
 * - If planSlug provided, return `.bart/plans/<slug>/tasks.json`
 * - If no slug, find the most recently modified `tasks.json` under `.bart/plans/` subdirs
 * - Fallback to legacy `.bart/tasks.json`
 */
export function resolvePlanTasksPath(cwd: string, planSlug?: string): string {
  if (planSlug) {
    return join(cwd, ".bart", "plans", planSlug, "tasks.json");
  }

  // Auto-select latest tasks.json in .bart/plans/*/
  const plansDir = join(cwd, ".bart", "plans");
  if (existsSync(plansDir)) {
    let latestTasksFile: { path: string; mtime: number } | null = null;
    try {
      const entries = readdirSync(plansDir);
      for (const entry of entries) {
        const tasksFile = join(plansDir, entry, "tasks.json");
        if (existsSync(tasksFile)) {
          const stats = statSync(tasksFile);
          if (!latestTasksFile || stats.mtimeMs > latestTasksFile.mtime) {
            latestTasksFile = { path: tasksFile, mtime: stats.mtimeMs };
          }
        }
      }
    } catch {}
    if (latestTasksFile) {
      return latestTasksFile.path;
    }
  }

  // Fallback to legacy .bart/tasks.json
  const legacyFile = join(BART_DIR, "tasks.json");
  const legacyPath = findFile(legacyFile, cwd);
  return legacyPath || join(cwd, legacyFile);
}

export function calculateCoverage(tasks: TasksData): Requirement[] {
  if (!tasks.requirements || tasks.requirements.length === 0) return [];

  return tasks.requirements.map(req => {
    const coveringTasks = req.covered_by
      .map(id => tasks.tasks.find(t => t.id === id))
      .filter(Boolean) as Task[];

    const completedCount = coveringTasks.filter(t => t.status === "completed").length;
    const totalCount = coveringTasks.length;

    let status: Requirement["status"];
    if (totalCount === 0) {
      status = "none";
    } else if (completedCount === totalCount) {
      status = "complete";
    } else if (completedCount > 0) {
      status = "partial";
    } else {
      status = "none";
    }

    return { ...req, status };
  });
}
