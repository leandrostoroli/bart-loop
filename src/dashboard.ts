import { watchFile, unwatchFile } from "fs";
import { readTasks, depsMet } from "./tasks.js";
import { BART, TasksData } from "./constants.js";

// ANSI codes
const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function statusColor(status: string): string {
  switch (status) {
    case "completed": return GREEN;
    case "in_progress": return YELLOW;
    case "error": return RED;
    case "needs_escalation": return RED;
    default: return DIM;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed": return "\u2713";   // ✓
    case "in_progress": return "\u25D0"; // ◐
    case "error": return "\u2717";       // ✗
    case "needs_escalation": return "\u26A0"; // ⚠
    case "pending": return "\u25CB";     // ○
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

function renderDashboard(tasks: TasksData): string {
  const lines: string[] = [];
  const workstreams = [...new Set(tasks.tasks.map(t => t.workstream))].sort();

  const total = tasks.tasks.length;
  const completed = tasks.tasks.filter(t => t.status === "completed").length;
  const inProgress = tasks.tasks.filter(t => t.status === "in_progress").length;
  const errorCount = tasks.tasks.filter(t => t.status === "error").length;
  const escalatedCount = tasks.tasks.filter(t => t.status === "needs_escalation").length;
  const pending = tasks.tasks.filter(t => t.status === "pending").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const barLen = 30;
  const filled = Math.round((pct / 100) * barLen);
  const bar =
    `${GREEN}${"█".repeat(filled)}${R}` +
    `${DIM}${"░".repeat(barLen - filled)}${R}`;

  const dashExtras = [
    errorCount > 0 ? `${RED}${errorCount} failed${R}` : "",
    escalatedCount > 0 ? `${RED}${escalatedCount} escalated${R}` : "",
  ].filter(Boolean).map(s => ` \u2022 ${s}`).join("");

  lines.push(BART.trim());
  lines.push(
    `  [${bar}] ${BOLD}${pct}%${R}  ` +
    `${GREEN}${completed} done${R} \u2022 ` +
    `${YELLOW}${inProgress} active${R} \u2022 ` +
    `${pending} pending` +
    dashExtras +
    ` (${total} total)`
  );
  lines.push("");
  lines.push(
    `  ${DIM}${new Date().toLocaleTimeString()}  auto-refresh 2s  Ctrl+C to exit${R}`
  );
  lines.push("");

  for (const ws of workstreams) {
    const wsTasks = tasks.tasks.filter(t => t.workstream === ws);
    const wsCompleted = wsTasks.filter(t => t.status === "completed").length;
    const wsTotal = wsTasks.length;
    const wsPct = wsTotal > 0 ? Math.round((wsCompleted / wsTotal) * 100) : 0;
    const wsFilled = Math.round((wsPct / 100) * 12);
    const wsBar =
      `${GREEN}${"█".repeat(wsFilled)}${R}` +
      `${DIM}${"░".repeat(12 - wsFilled)}${R}`;

    lines.push(
      `${BOLD}Workstream ${ws}${R}  [${wsBar}] ${wsPct}% (${wsCompleted}/${wsTotal})`
    );

    for (const task of wsTasks) {
      const color = statusColor(task.status);
      const icon = statusIcon(task.status);
      const blocked = task.status === "pending" && !depsMet(tasks, task.id);
      const duration = task.started_at
        ? formatDuration(task.started_at, task.completed_at)
        : "";
      const deps =
        task.depends_on.length > 0 ? task.depends_on.join(",") : "";

      let line = `  ${color}${icon}${R} ${task.id}: ${task.title}`;
      if (task.specialist) line += ` ${DIM}[${task.specialist}]${R}`;
      if (duration) line += ` ${DIM}(${duration})${R}`;
      if (blocked && deps) line += ` ${YELLOW}[needs ${deps}]${R}`;
      lines.push(line);

      if ((task.status === "error" || task.status === "needs_escalation") && task.error) {
        lines.push(`      ${RED}${task.error.substring(0, 80)}${R}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function runDashboard(tasksPath: string): Promise<void> {
  process.stdout.write("\x1b[?25l"); // hide cursor

  const render = () => {
    try {
      const tasks = readTasks(tasksPath);
      process.stdout.write("\x1b[2J\x1b[H"); // clear + home
      process.stdout.write(renderDashboard(tasks));
    } catch {
      // Ignore read errors during rapid file updates
    }
  };

  render();
  const interval = setInterval(render, 2000);

  // Watch task file for faster re-renders
  const watchedFiles = [tasksPath];
  for (const f of watchedFiles) {
    watchFile(f, { interval: 300, persistent: false }, render);
  }

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      process.stdout.write("\x1b[?25h\n"); // show cursor
      clearInterval(interval);
      for (const f of watchedFiles) {
        try { unwatchFile(f); } catch {}
      }
      resolve();
    };
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  });
}
