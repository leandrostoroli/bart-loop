import { execSync, execFileSync, spawnSync } from "child_process";
import { readTasks } from "./tasks.js";

export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export function tmuxSessionExists(name: string): boolean {
  const result = spawnSync("tmux", ["has-session", "-t", name], { stdio: "ignore" });
  return result.status === 0;
}

export function sanitizeSessionName(slug: string): string {
  return slug.replace(/[.:]/g, "-").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50);
}

export function attachOrSwitchTmux(session: string): void {
  if (isInsideTmux()) {
    execSync(`tmux switch-client -t ${session}`, { stdio: "inherit" });
  } else {
    execFileSync("tmux", ["attach-session", "-t", session], { stdio: "inherit" });
  }
}

export function runWithTmux(opts: {
  tasksPath: string;
  planSlug: string;
  cwd: string;
  agentOverride?: string;
  autoContinue?: boolean;
  tasksFlag?: string;
}): void {
  const { tasksPath, planSlug, cwd, agentOverride, autoContinue, tasksFlag } = opts;

  const sessionName = sanitizeSessionName(planSlug);

  if (tmuxSessionExists(sessionName)) {
    attachOrSwitchTmux(sessionName);
    return;
  }

  const tasksData = readTasks(tasksPath);
  const workstreams = [...new Set(tasksData.tasks.map(t => t.workstream).filter(Boolean))].sort() as string[];

  const bartBin = process.argv[1] ? process.argv[1] : "bart";

  // Build passthrough flags for run sub-commands
  const passthroughFlags: string[] = [];
  if (tasksFlag) {
    passthroughFlags.push(`--tasks ${tasksFlag}`);
  } else {
    passthroughFlags.push(`--plan ${planSlug}`);
  }
  if (agentOverride) {
    passthroughFlags.push(`--agent ${agentOverride}`);
  }
  if (autoContinue === false) {
    passthroughFlags.push("--no-auto-continue");
  }

  // Create session with a blank initial window (pane 0 = first workstream or idle)
  const firstWsCmd = workstreams.length > 0
    ? `${bartBin} run --workstream ${workstreams[0]} ${passthroughFlags.join(" ")}`
    : "bash";
  execSync(`tmux new-session -d -s ${sessionName} -c ${cwd} "${firstWsCmd}"`, { stdio: "inherit" });

  // Split pane 0 horizontally at 65% to create the right pane (35% width) for the dashboard
  const dashboardCmd = `${bartBin} dashboard --plan ${planSlug}`;
  execSync(`tmux split-window -h -t ${sessionName}:0.0 -c ${cwd} -p 35 "${dashboardCmd}"`, { stdio: "inherit" });

  // Stack additional workstream panes on the left by splitting the last left pane vertically
  for (let i = 1; i < workstreams.length; i++) {
    const runCmd = `${bartBin} run --workstream ${workstreams[i]} ${passthroughFlags.join(" ")}`;
    // The left pane index grows: 0, 2, 3, 4, ... (pane 1 is the right dashboard pane)
    const leftPaneIndex = i === 1 ? 0 : i + 1;
    execSync(`tmux split-window -v -t ${sessionName}:0.${leftPaneIndex} -c ${cwd} "${runCmd}"`, { stdio: "inherit" });
  }

  // Focus pane 0 on attach
  execSync(`tmux select-pane -t ${sessionName}:0.0`, { stdio: "inherit" });
  attachOrSwitchTmux(sessionName);
}
