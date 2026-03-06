import { existsSync, readFileSync, watchFile, unwatchFile } from "fs";
import { join } from "path";
import { readTasks, depsMet } from "./tasks.js";
import { BART, BART_DIR, TasksData } from "./constants.js";
import {
  readCollabState,
  applyPushMessage,
  getWorkstreamCollab,
  CollabState,
  CollabPushMessage,
  collabStatePath,
  collabEventsPath,
} from "./collab/index.js";

// ANSI codes
const R = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

function statusColor(status: string): string {
  switch (status) {
    case "completed": return GREEN;
    case "in_progress": return YELLOW;
    case "error": return RED;
    default: return DIM;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed": return "\u2713";   // ✓
    case "in_progress": return "\u25D0"; // ◐
    case "error": return "\u2717";       // ✗
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

function getBartDir(tasksPath: string): string {
  try {
    const tasks = readTasks(tasksPath);
    if (tasks.project_root) {
      return join(tasks.project_root, BART_DIR);
    }
  } catch {}
  return join(process.cwd(), BART_DIR);
}

function renderDashboard(tasks: TasksData, collab: CollabState): string {
  const lines: string[] = [];
  const workstreams = [...new Set(tasks.tasks.map(t => t.workstream))].sort();

  const total = tasks.tasks.length;
  const completed = tasks.tasks.filter(t => t.status === "completed").length;
  const inProgress = tasks.tasks.filter(t => t.status === "in_progress").length;
  const errorCount = tasks.tasks.filter(t => t.status === "error").length;
  const pending = tasks.tasks.filter(t => t.status === "pending").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const barLen = 30;
  const filled = Math.round((pct / 100) * barLen);
  const bar =
    `${GREEN}${"█".repeat(filled)}${R}` +
    `${DIM}${"░".repeat(barLen - filled)}${R}`;

  lines.push(BART.trim());
  lines.push(
    `  [${bar}] ${BOLD}${pct}%${R}  ` +
    `${GREEN}${completed} done${R} \u2022 ` +
    `${YELLOW}${inProgress} active${R} \u2022 ` +
    `${pending} pending` +
    (errorCount > 0 ? ` \u2022 ${RED}${errorCount} failed${R}` : "") +
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

    const ci = getWorkstreamCollab(collab, ws);
    let engineerTag: string;
    let wsPrefix: string;

    if (ci.engineer) {
      if (ci.isRemote) {
        engineerTag = `${MAGENTA}[remote: ${ci.engineer}]${R}`;
        wsPrefix = `${MAGENTA}${BOLD}`;
      } else {
        engineerTag = `${CYAN}[local: ${ci.engineer}]${R}`;
        wsPrefix = `${CYAN}${BOLD}`;
      }
    } else {
      engineerTag = `${DIM}[available]${R}`;
      wsPrefix = BOLD;
    }

    lines.push(
      `${wsPrefix}Workstream ${ws}${R}  [${wsBar}] ${wsPct}% (${wsCompleted}/${wsTotal})  ${engineerTag}`
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

      if (task.status === "error" && task.error) {
        lines.push(`      ${RED}${task.error.substring(0, 80)}${R}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function readPendingEvents(
  eventsPath: string,
  lastOffset: number
): { messages: CollabPushMessage[]; nextOffset: number } {
  if (!existsSync(eventsPath)) return { messages: [], nextOffset: 0 };
  const content = readFileSync(eventsPath, "utf-8");
  if (content.length <= lastOffset) return { messages: [], nextOffset: lastOffset };

  const messages: CollabPushMessage[] = [];
  for (const line of content.slice(lastOffset).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as CollabPushMessage);
    } catch {}
  }
  return { messages, nextOffset: content.length };
}

export async function runDashboard(tasksPath: string): Promise<void> {
  const bartDir = getBartDir(tasksPath);
  const statePath = collabStatePath(bartDir);
  const eventsPath = collabEventsPath(bartDir);

  process.stdout.write("\x1b[?25l"); // hide cursor

  let collabState = readCollabState(statePath);
  let eventsOffset = 0;
  // Track departed hosts persistently so collab.json merges can't re-add their workstreams
  const departedHosts = new Set<string>();

  const render = () => {
    try {
      // Merge with fresh collab.json (written directly by remote instances)
      const fresh = readCollabState(statePath);
      collabState = {
        workstreams: { ...collabState.workstreams, ...fresh.workstreams },
      };

      // Re-apply releases for all previously departed hosts so stale collab.json
      // entries don't bring them back (REQ-06)
      for (const host of departedHosts) {
        collabState = applyPushMessage(collabState, {
          type: "peer-leave",
          engineer: "",
          host,
          timestamp: new Date().toISOString(),
        });
      }

      // Apply any new push messages from the events log (after the merge so they win)
      const { messages, nextOffset } = readPendingEvents(eventsPath, eventsOffset);
      eventsOffset = nextOffset;
      for (const msg of messages) {
        if (msg.type === "peer-leave") departedHosts.add(msg.host);
        collabState = applyPushMessage(collabState, msg);
      }

      const tasks = readTasks(tasksPath);
      process.stdout.write("\x1b[2J\x1b[H"); // clear + home
      process.stdout.write(renderDashboard(tasks, collabState));
    } catch {
      // Ignore read errors during rapid file updates
    }
  };

  render();
  const interval = setInterval(render, 2000);

  // Watch files for faster re-renders
  const watchedFiles = [tasksPath];
  if (existsSync(statePath)) watchedFiles.push(statePath);
  if (existsSync(eventsPath)) watchedFiles.push(eventsPath);
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
