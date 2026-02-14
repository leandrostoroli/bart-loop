import { TasksData } from "./constants.js";
import { depsMet } from "./tasks.js";

export function printStatus(tasks: TasksData) {
  const workstreams = [...new Set(tasks.tasks.map(t => t.workstream))].sort();
  
  console.log("\n📊 Bart Loop Status\n");
  
  for (const ws of workstreams) {
    const wsTasks = tasks.tasks.filter(t => t.workstream === ws);
    const completed = wsTasks.filter(t => t.status === "completed").length;
    const total = wsTasks.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    const barLen = 20;
    const filled = Math.round((pct / 100) * barLen);
    const bar = "█".repeat(filled) + "░".repeat(barLen - filled);
    
    console.log(`Workstream ${ws}: [${bar}] ${pct}% (${completed}/${total})`);
    
    const next = wsTasks.find(t => t.status === "pending" && depsMet(tasks, t.id));
    if (next) {
      console.log(`  → Next: ${next.id}: ${next.title}`);
    } else if (completed === total) {
      console.log(`  ✓ All done!`);
    }
  }
  
  const errors = tasks.tasks.filter(t => t.status === "error");
  if (errors.length > 0) {
    console.log(`\n⚠️  Errors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.id}: ${e.title}`);
      console.log(`    ${e.error?.substring(0, 60)}`);
    }
  }
  console.log("");
}
