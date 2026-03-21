import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "./api.js";
import type { TasksData } from "./constants.js";
import type { Server } from "bun";

// --- Helpers ---

function makeTasksData(overrides: Partial<TasksData> = {}): TasksData {
  return {
    tasks: [
      {
        id: "A1",
        workstream: "A",
        title: "Setup project",
        description: "Initialize the project",
        files: ["src/index.ts"],
        depends_on: [],
        status: "completed",
        files_modified: ["src/index.ts"],
        started_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-01-01T01:00:00Z",
        error: null,
      },
      {
        id: "A2",
        workstream: "A",
        title: "Add tests",
        description: "Write test suite",
        files: ["src/index.test.ts"],
        depends_on: ["A1"],
        status: "pending",
        files_modified: [],
        started_at: null,
        completed_at: null,
        error: null,
      },
      {
        id: "B1",
        workstream: "B",
        title: "Build API",
        description: "Create REST endpoints",
        files: ["src/api.ts"],
        depends_on: [],
        status: "in_progress",
        files_modified: [],
        started_at: "2026-01-02T00:00:00Z",
        completed_at: null,
        error: null,
      },
    ],
    requirements: [
      {
        id: "REQ-01",
        description: "Project setup",
        covered_by: ["A1"],
        status: "complete",
      },
      {
        id: "REQ-02",
        description: "API endpoints",
        covered_by: ["B1"],
        status: "partial",
      },
    ],
    ...overrides,
  };
}

// =============================================================================
// createServer
// =============================================================================

describe("createServer", () => {
  test("returns a Server object with a port", () => {
    const data = makeTasksData();
    const server = createServer(data, { port: 0 });
    expect(server).toBeDefined();
    expect(server.port).toBeGreaterThan(0);
    server.stop(true);
  });

  test("accepts a custom port", () => {
    const data = makeTasksData();
    const server = createServer(data, { port: 0 });
    expect(typeof server.port).toBe("number");
    server.stop(true);
  });
});

// =============================================================================
// GET /tasks
// =============================================================================

describe("GET /tasks", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    server = createServer(makeTasksData(), { port: 0 });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("returns 200 with all tasks", async () => {
    const res = await fetch(`${baseUrl}/tasks`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");

    const body = await res.json();
    expect(body).toHaveLength(3);
    expect(body[0].id).toBe("A1");
    expect(body[1].id).toBe("A2");
    expect(body[2].id).toBe("B1");
  });

  test("filters by status query param", async () => {
    const res = await fetch(`${baseUrl}/tasks?status=pending`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("A2");
  });

  test("filters by workstream query param", async () => {
    const res = await fetch(`${baseUrl}/tasks?workstream=B`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("B1");
  });

  test("combines status and workstream filters", async () => {
    const res = await fetch(`${baseUrl}/tasks?status=completed&workstream=A`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("A1");
  });

  test("returns empty array when no tasks match filters", async () => {
    const res = await fetch(`${baseUrl}/tasks?status=error`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual([]);
  });
});

// =============================================================================
// GET /tasks/:id
// =============================================================================

describe("GET /tasks/:id", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    server = createServer(makeTasksData(), { port: 0 });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("returns 200 with a single task", async () => {
    const res = await fetch(`${baseUrl}/tasks/A1`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("A1");
    expect(body.title).toBe("Setup project");
    expect(body.status).toBe("completed");
  });

  test("returns 404 for non-existent task", async () => {
    const res = await fetch(`${baseUrl}/tasks/Z99`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Task not found");
  });
});

// =============================================================================
// GET /progress
// =============================================================================

describe("GET /progress", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    server = createServer(makeTasksData(), { port: 0 });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("returns progress summary", async () => {
    const res = await fetch(`${baseUrl}/progress`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.completed).toBe(1);
    expect(body.in_progress).toBe(1);
    expect(body.pending).toBe(1);
    expect(body.error).toBe(0);
  });
});

// =============================================================================
// GET /requirements
// =============================================================================

describe("GET /requirements", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    server = createServer(makeTasksData(), { port: 0 });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("returns requirements with coverage status", async () => {
    const res = await fetch(`${baseUrl}/requirements`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe("REQ-01");
    expect(body[0].status).toBe("complete");
    expect(body[1].id).toBe("REQ-02");
  });

  test("returns empty array when no requirements exist", async () => {
    const data = makeTasksData({ requirements: undefined });
    const s = createServer(data, { port: 0 });
    const res = await fetch(`http://localhost:${s.port}/requirements`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual([]);
    s.stop(true);
  });
});

// =============================================================================
// Unknown routes
// =============================================================================

describe("unknown routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(() => {
    server = createServer(makeTasksData(), { port: 0 });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("returns 404 for unknown paths", async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("returns 404 for POST requests", async () => {
    const res = await fetch(`${baseUrl}/tasks`, { method: "POST" });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Not found");
  });
});
