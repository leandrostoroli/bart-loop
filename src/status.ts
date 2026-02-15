import { BART, TasksData, Task } from "./constants.js";
import { depsMet } from "./tasks.js";

function statusIcon(status: Task["status"]): string {
  switch (status) {
    case "completed": return "\u2713";
    case "in_progress": return "\u25D0";
    case "error": return "\u2717";
    case "pending": return "\u25CB";
    default: return "?";
  }
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diff = Math.round((e - s) / 1000);
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  if (mins < 60) return `${mins}m${secs > 0 ? ` ${secs}s` : ""}`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function printStatus(tasks: TasksData) {
  const workstreams = [...new Set(tasks.tasks.map(t => t.workstream))].sort();

  const total = tasks.tasks.length;
  const completed = tasks.tasks.filter(t => t.status === "completed").length;
  const inProgress = tasks.tasks.filter(t => t.status === "in_progress").length;
  const errorCount = tasks.tasks.filter(t => t.status === "error").length;
  const pending = tasks.tasks.filter(t => t.status === "pending").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

  console.log(`\n${BART}`);
  console.log(`  [${bar}] ${pct}%  ${completed} done \u2022 ${inProgress} active \u2022 ${pending} pending${errorCount > 0 ? ` \u2022 ${errorCount} failed` : ""} (${total} total)\n`);

  for (const ws of workstreams) {
    const wsTasks = tasks.tasks.filter(t => t.workstream === ws);
    const wsCompleted = wsTasks.filter(t => t.status === "completed").length;
    const wsTotal = wsTasks.length;
    const wsPct = wsTotal > 0 ? Math.round((wsCompleted / wsTotal) * 100) : 0;

    const wsFilled = Math.round((wsPct / 100) * 12);
    const wsBar = "\u2588".repeat(wsFilled) + "\u2591".repeat(12 - wsFilled);

    console.log(`Workstream ${ws}: [${wsBar}] ${wsPct}% (${wsCompleted}/${wsTotal})`);

    for (const task of wsTasks) {
      const icon = statusIcon(task.status);
      const blocked = task.status === "pending" && !depsMet(tasks, task.id);
      const duration = task.started_at ? formatDuration(task.started_at, task.completed_at) : "";
      const deps = task.depends_on.length > 0 ? task.depends_on.join(",") : "";

      let line = `  ${icon} ${task.id}: ${task.title}`;
      if (duration) line += ` (${duration})`;
      if (blocked && deps) line += ` [needs ${deps}]`;
      console.log(line);

      if (task.status === "error" && task.error) {
        console.log(`      ${task.error.substring(0, 70)}`);
      }
    }
    console.log("");
  }

  const errors = tasks.tasks.filter(t => t.status === "error");
  if (errors.length > 0) {
    console.log(`\u26A0\uFE0F  Errors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  \u2717 ${e.id}: ${e.title}`);
      console.log(`    ${e.error}`);
    }
    console.log("");
  }
}

export function printWorkstreamStatus(tasks: TasksData, workstream: string) {
  const wsTasks = tasks.tasks.filter(t => t.workstream === workstream);
  
  if (wsTasks.length === 0) {
    console.log(`\nNo tasks found in workstream ${workstream}\n`);
    return;
  }
  
  const completed = wsTasks.filter(t => t.status === "completed").length;
  const inProgress = wsTasks.filter(t => t.status === "in_progress").length;
  const errorCount = wsTasks.filter(t => t.status === "error").length;
  const pending = wsTasks.filter(t => t.status === "pending").length;
  const total = wsTasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const barLen = 20;
  const filled = Math.round((pct / 100) * barLen);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);

  console.log(`\nWorkstream ${workstream}: [${bar}] ${pct}%  ${completed} done \u2022 ${inProgress} active \u2022 ${pending} pending${errorCount > 0 ? ` \u2022 ${errorCount} failed` : ""} (${total} total)\n`);

  for (const task of wsTasks) {
    const icon = statusIcon(task.status);
    const blocked = task.status === "pending" && !depsMet(tasks, task.id);
    const duration = task.started_at ? formatDuration(task.started_at, task.completed_at) : "";
    const deps = task.depends_on.length > 0 ? task.depends_on.join(",") : "";

    let line = `  ${icon} ${task.id}: ${task.title}`;
    if (duration) line += ` (${duration})`;
    if (blocked && deps) line += ` [needs ${deps}]`;
    console.log(line);
    
    if (task.description) {
      console.log(`      ${task.description.substring(0, 70)}`);
    }

    if (task.status === "error" && task.error) {
      console.log(`      ${task.error.substring(0, 70)}`);
    }
  }
  console.log("");
}
