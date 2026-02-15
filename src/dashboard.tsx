import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput } from "ink";
import { BART, TasksData, Task } from "./constants.js";
import { readTasks, depsMet } from "./tasks.js";

function getWorkstreams(tasks: TasksData): string[] {
  return [...new Set(tasks.tasks.map(t => t.workstream))].sort();
}

function createProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}

function statusIcon(status: Task["status"]): string {
  switch (status) {
    case "completed": return "\u2713";
    case "in_progress": return "\u25D0";
    case "error": return "\u2717";
    case "pending": return "\u25CB";
    default: return "?";
  }
}

function statusColor(status: Task["status"]): string {
  switch (status) {
    case "completed": return "green";
    case "in_progress": return "yellow";
    case "error": return "red";
    case "pending": return "gray";
    default: return "white";
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

// ── Stats Bar ──────────────────────────────────────────────

interface StatsBarProps {
  tasks: TasksData;
}

const StatsBar: React.FC<StatsBarProps> = ({ tasks }) => {
  const total = tasks.tasks.length;
  const completed = tasks.tasks.filter(t => t.status === "completed").length;
  const inProgress = tasks.tasks.filter(t => t.status === "in_progress").length;
  const errors = tasks.tasks.filter(t => t.status === "error").length;
  const pending = tasks.tasks.filter(t => t.status === "pending").length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Box flexDirection="row" gap={2}>
      <Text>
        <Text bold color="white">[{createProgressBar(pct, 20)}] {pct}%</Text>
      </Text>
      <Text color="green">{completed} done</Text>
      <Text color="yellow">{inProgress} active</Text>
      <Text color="gray">{pending} pending</Text>
      {errors > 0 && <Text color="red">{errors} failed</Text>}
      <Text color="gray">({total} total)</Text>
    </Box>
  );
};

// ── Workstream Panel ───────────────────────────────────────

interface WorkstreamPanelProps {
  tasks: TasksData;
}

const WorkstreamPanel: React.FC<WorkstreamPanelProps> = ({ tasks }) => {
  const workstreams = getWorkstreams(tasks);

  return (
    <Box flexDirection="column" width={24}>
      <Text bold color="cyan">Workstreams</Text>
      <Text color="gray">{"\u2500".repeat(22)}</Text>
      {workstreams.map(ws => {
        const wsTasks = tasks.tasks.filter(t => t.workstream === ws);
        const completed = wsTasks.filter(t => t.status === "completed").length;
        const total = wsTasks.length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        const hasActive = wsTasks.some(t => t.status === "in_progress");
        const hasError = wsTasks.some(t => t.status === "error");

        let color = pct === 100 ? "green" : hasError ? "red" : hasActive ? "yellow" : "cyan";

        return (
          <Box key={ws} flexDirection="column">
            <Text bold color={color}>  {ws} <Text color="gray">({completed}/{total})</Text></Text>
            <Text color={color}>
              {"  "}[{createProgressBar(pct, 12)}] {pct}%
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

// ── Task List ──────────────────────────────────────────────

interface TaskListProps {
  tasks: TasksData;
  showAll: boolean;
}

const TaskList: React.FC<TaskListProps> = ({ tasks, showAll }) => {
  const workstreams = getWorkstreams(tasks);

  return (
    <Box flexDirection="column" flexGrow={1} marginLeft={1}>
      <Text bold color="cyan">Tasks</Text>
      <Text color="gray">{"\u2500".repeat(58)}</Text>
      {workstreams.map(ws => {
        const wsTasks = tasks.tasks.filter(t => t.workstream === ws);
        const completed = wsTasks.filter(t => t.status === "completed").length;
        const total = wsTasks.length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

        const visibleTasks = showAll
          ? wsTasks
          : wsTasks.filter(t =>
              t.status === "in_progress" ||
              t.status === "error" ||
              (t.status === "pending" && depsMet(tasks, t.id))
            );

        return (
          <Box key={ws} flexDirection="column" marginBottom={1}>
            <Text bold color={pct === 100 ? "green" : "cyan"}>
              Workstream {ws} <Text color="gray">({completed}/{total})</Text>
            </Text>

            {showAll ? (
              wsTasks.map(task => (
                <TaskRow key={task.id} task={task} tasks={tasks} />
              ))
            ) : (
              <>
                {visibleTasks.length > 0 ? (
                  visibleTasks.map(task => (
                    <TaskRow key={task.id} task={task} tasks={tasks} />
                  ))
                ) : pct === 100 ? (
                  <Text color="green">  {statusIcon("completed")} All done!</Text>
                ) : (
                  <Text color="gray">  {"\u2192"} (waiting for dependencies)</Text>
                )}
                {completed > 0 && !showAll && (
                  <Text color="gray" dimColor>  {completed} completed task{completed !== 1 ? "s" : ""} hidden</Text>
                )}
              </>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

// ── Task Row ───────────────────────────────────────────────

interface TaskRowProps {
  task: Task;
  tasks: TasksData;
}

const TaskRow: React.FC<TaskRowProps> = ({ task, tasks }) => {
  const icon = statusIcon(task.status);
  const color = statusColor(task.status);
  const duration = task.started_at ? formatDuration(task.started_at, task.completed_at) : "";
  const blocked = task.status === "pending" && !depsMet(tasks, task.id);
  const deps = task.depends_on.length > 0 ? task.depends_on.join(",") : "";

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={color}>  {icon} </Text>
        <Text bold color={color}>{task.id}</Text>
        <Text color={blocked ? "gray" : "white"}> {task.title}</Text>
        {duration && <Text color="gray"> ({duration})</Text>}
        {blocked && deps && <Text color="gray" dimColor> [needs {deps}]</Text>}
      </Box>
      {task.status === "error" && task.error && (
        <Text color="red">       {task.error.substring(0, 70)}</Text>
      )}
    </Box>
  );
};

// ── Error Panel ────────────────────────────────────────────

interface ErrorPanelProps {
  tasks: TasksData;
}

const ErrorPanel: React.FC<ErrorPanelProps> = ({ tasks }) => {
  const errors = tasks.tasks.filter(t => t.status === "error");
  if (errors.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} marginTop={1}>
      <Text bold color="red">{"\u26A0"} Errors ({errors.length})</Text>
      {errors.map(e => (
        <Box key={e.id} flexDirection="column">
          <Text color="yellow"> {"\u2717"} {e.id}: {e.title}</Text>
          <Text color="red">    {e.error}</Text>
          {e.started_at && (
            <Text color="gray">    Started: {formatTime(e.started_at)}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
};

// ── Main Dashboard ─────────────────────────────────────────

interface DashboardProps {
  tasksPath: string;
}

const Dashboard: React.FC<DashboardProps> = ({ tasksPath }) => {
  const [, setTick] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useInput((input) => {
    if (input === "a") setShowAll(prev => !prev);
    if (input === "q") {
      console.log("\n\nDashboard stopped.");
      process.exit(0);
    }
  });

  const tasks = readTasks(tasksPath);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">{BART}</Text>
      <Box flexDirection="row" gap={1}>
        <Text color="gray">  Dashboard</Text>
        <Text color="gray">{"\u2022"}</Text>
        <Text color="gray">{new Date().toLocaleTimeString()}</Text>
        <Text color="gray">{"\u2022"}</Text>
        <Text color="gray">[a] toggle all</Text>
        <Text color="gray">{"\u2022"}</Text>
        <Text color="gray">[q] quit</Text>
      </Box>
      <Text>{" "}</Text>

      <StatsBar tasks={tasks} />
      <Text>{" "}</Text>

      <Box flexDirection="row">
        <WorkstreamPanel tasks={tasks} />
        <TaskList tasks={tasks} showAll={showAll} />
      </Box>

      <ErrorPanel tasks={tasks} />
    </Box>
  );
};

export async function runDashboard(tasksPath: string) {
  const { unmount } = render(<Dashboard tasksPath={tasksPath} />);

  process.on("SIGINT", () => {
    unmount();
    console.log("\n\nDashboard stopped.");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    unmount();
    process.exit(0);
  });
}
