import type { TasksData } from "./constants.js";
import { getProgress, calculateCoverage } from "./tasks.js";

export interface ApiServerOptions {
  port?: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createServer(data: TasksData, opts: ApiServerOptions = {}) {
  return Bun.serve({
    port: opts.port ?? 3000,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method !== "GET") {
        return json({ error: "Not found" }, 404);
      }

      // GET /tasks/:id
      const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const taskId = taskMatch[1];
        const task = data.tasks.find((t) => t.id === taskId);
        if (!task) {
          return json({ error: "Task not found" }, 404);
        }
        return json(task);
      }

      // GET /tasks
      if (path === "/tasks") {
        let tasks = data.tasks;

        const status = url.searchParams.get("status");
        if (status) {
          tasks = tasks.filter((t) => t.status === status);
        }

        const workstream = url.searchParams.get("workstream");
        if (workstream) {
          tasks = tasks.filter((t) => t.workstream === workstream);
        }

        return json(tasks);
      }

      // GET /progress
      if (path === "/progress") {
        return json(getProgress(data));
      }

      // GET /requirements
      if (path === "/requirements") {
        return json(calculateCoverage(data));
      }

      return json({ error: "Not found" }, 404);
    },
  });
}
