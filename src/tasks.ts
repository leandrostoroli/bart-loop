import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { Task, TasksData } from "./constants.js";

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
