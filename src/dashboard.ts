import { BART_MINI, TasksData } from "./constants.js";
import { readTasks, depsMet } from "./tasks.js";

function getWorkstreams(tasks: TasksData): string[] {
  return [...new Set(tasks.tasks.map(t => t.workstream))].sort();
}

function createProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export async function runDashboard(tasksPath: string) {
  const { createCliRenderer, Box, Text } = await import("@opentui/core");
  
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
