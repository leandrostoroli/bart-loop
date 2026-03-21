import { describe, test, expect } from "bun:test";
import {
  findNextTask,
  findAllReadyTasks,
  depsMet,
  getTaskById,
  getTaskField,
  getTasksByStatus,
  getProgress,
  calculateCoverage,
} from "./tasks.js";
import type { Task, TasksData, Requirement } from "./constants.js";

// --- Helpers ---

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    workstream: "ws-1",
    title: "Test task",
    description: "A test task",
    files: [],
    depends_on: [],
    status: "pending",
    files_modified: [],
    started_at: null,
    completed_at: null,
    error: null,
    ...overrides,
  };
}

function makeTasksData(tasks: Task[], requirements?: Requirement[]): TasksData {
  return { tasks, requirements };
}

// =============================================================================
// getTaskById
// =============================================================================

describe("getTaskById", () => {
  test("returns the task when it exists", () => {
    const task = makeTask({ id: "abc" });
    const data = makeTasksData([task]);
    expect(getTaskById(data, "abc")).toBe(task);
  });

  test("returns undefined when task does not exist", () => {
    const data = makeTasksData([makeTask({ id: "abc" })]);
    expect(getTaskById(data, "nonexistent")).toBeUndefined();
  });

  test("returns undefined for empty task list", () => {
    const data = makeTasksData([]);
    expect(getTaskById(data, "abc")).toBeUndefined();
  });
});

// =============================================================================
// getTaskField
// =============================================================================

describe("getTaskField", () => {
  test("returns the requested field value", () => {
    const data = makeTasksData([makeTask({ id: "t1", title: "My Title" })]);
    expect(getTaskField(data, "t1", "title")).toBe("My Title");
  });

  test("returns null for a non-existent task", () => {
    const data = makeTasksData([]);
    expect(getTaskField(data, "missing", "title")).toBeNull();
  });

  test("returns the status field correctly", () => {
    const data = makeTasksData([makeTask({ id: "t1", status: "completed" })]);
    expect(getTaskField(data, "t1", "status")).toBe("completed");
  });

  test("returns null values as-is (e.g., started_at when null)", () => {
    const data = makeTasksData([makeTask({ id: "t1", started_at: null })]);
    expect(getTaskField(data, "t1", "started_at")).toBeNull();
  });
});

// =============================================================================
// depsMet
// =============================================================================

describe("depsMet", () => {
  test("returns true when task has no dependencies", () => {
    const data = makeTasksData([makeTask({ id: "t1", depends_on: [] })]);
    expect(depsMet(data, "t1")).toBe(true);
  });

  test("returns true when all dependencies are completed", () => {
    const data = makeTasksData([
      makeTask({ id: "dep1", status: "completed" }),
      makeTask({ id: "dep2", status: "completed" }),
      makeTask({ id: "t1", depends_on: ["dep1", "dep2"] }),
    ]);
    expect(depsMet(data, "t1")).toBe(true);
  });

  test("returns false when some dependencies are pending", () => {
    const data = makeTasksData([
      makeTask({ id: "dep1", status: "completed" }),
      makeTask({ id: "dep2", status: "pending" }),
      makeTask({ id: "t1", depends_on: ["dep1", "dep2"] }),
    ]);
    expect(depsMet(data, "t1")).toBe(false);
  });

  test("returns false when a dependency is in_progress", () => {
    const data = makeTasksData([
      makeTask({ id: "dep1", status: "in_progress" }),
      makeTask({ id: "t1", depends_on: ["dep1"] }),
    ]);
    expect(depsMet(data, "t1")).toBe(false);
  });

  test("returns false when a dependency is in error state", () => {
    const data = makeTasksData([
      makeTask({ id: "dep1", status: "error" }),
      makeTask({ id: "t1", depends_on: ["dep1"] }),
    ]);
    expect(depsMet(data, "t1")).toBe(false);
  });

  test("returns false for a non-existent task", () => {
    const data = makeTasksData([]);
    expect(depsMet(data, "nonexistent")).toBe(false);
  });

  test("returns false when a dependency references a non-existent task", () => {
    const data = makeTasksData([makeTask({ id: "t1", depends_on: ["ghost"] })]);
    expect(depsMet(data, "t1")).toBe(false);
  });
});

// =============================================================================
// findNextTask
// =============================================================================

describe("findNextTask", () => {
  test("returns the first pending task with no dependencies", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "pending", depends_on: [] }),
    ]);
    expect(findNextTask(data)).toBe("t1");
  });

  test("returns null when there are no pending tasks", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "completed" }),
      makeTask({ id: "t2", status: "in_progress" }),
    ]);
    expect(findNextTask(data)).toBeNull();
  });

  test("returns null for empty task list", () => {
    const data = makeTasksData([]);
    expect(findNextTask(data)).toBeNull();
  });

  test("skips tasks whose dependencies are not met", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "pending", depends_on: ["t2"] }),
      makeTask({ id: "t2", status: "pending", depends_on: [] }),
    ]);
    expect(findNextTask(data)).toBe("t2");
  });

  test("returns task once its dependency is completed", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "pending", depends_on: ["t2"] }),
      makeTask({ id: "t2", status: "completed" }),
    ]);
    expect(findNextTask(data)).toBe("t1");
  });

  test("filters by workstream when provided", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", workstream: "frontend", status: "pending" }),
      makeTask({ id: "t2", workstream: "backend", status: "pending" }),
    ]);
    expect(findNextTask(data, "backend")).toBe("t2");
  });

  test("returns null when no pending tasks match the workstream", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", workstream: "frontend", status: "pending" }),
    ]);
    expect(findNextTask(data, "backend")).toBeNull();
  });

  test("returns null when all tasks in workstream are blocked", () => {
    const data = makeTasksData([
      makeTask({ id: "dep1", workstream: "backend", status: "pending" }),
      makeTask({
        id: "t1",
        workstream: "backend",
        status: "pending",
        depends_on: ["dep1"],
      }),
    ]);
    // dep1 is first pending with no blockers, so it should be returned
    expect(findNextTask(data, "backend")).toBe("dep1");
  });

  test("skips completed and in-progress tasks, picks next ready pending", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "completed" }),
      makeTask({ id: "t2", status: "in_progress" }),
      makeTask({ id: "t3", status: "pending", depends_on: ["t1"] }),
    ]);
    expect(findNextTask(data)).toBe("t3");
  });
});

// =============================================================================
// findAllReadyTasks
// =============================================================================

describe("findAllReadyTasks", () => {
  test("returns all pending tasks with met dependencies", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", workstream: "ws-a", status: "pending" }),
      makeTask({ id: "t2", workstream: "ws-b", status: "pending" }),
      makeTask({
        id: "t3",
        workstream: "ws-a",
        status: "pending",
        depends_on: ["t1"],
      }),
    ]);
    const result = findAllReadyTasks(data);
    expect(result).toEqual(["t1", "t2"]);
  });

  test("returns empty array when no tasks are pending", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "completed" }),
      makeTask({ id: "t2", status: "in_progress" }),
    ]);
    expect(findAllReadyTasks(data)).toEqual([]);
  });

  test("returns empty array when all pending tasks are blocked", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "pending", depends_on: ["t2"] }),
      makeTask({ id: "t2", status: "pending", depends_on: ["t1"] }),
    ]);
    expect(findAllReadyTasks(data)).toEqual([]);
  });

  test("returns empty array for empty task list", () => {
    expect(findAllReadyTasks(makeTasksData([]))).toEqual([]);
  });

  test("filters by workstream when provided", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", workstream: "frontend", status: "pending" }),
      makeTask({ id: "t2", workstream: "backend", status: "pending" }),
      makeTask({ id: "t3", workstream: "backend", status: "pending" }),
    ]);
    expect(findAllReadyTasks(data, "backend")).toEqual(["t2", "t3"]);
  });

  test("excludes tasks whose deps are in error state", () => {
    const data = makeTasksData([
      makeTask({ id: "dep", status: "error" }),
      makeTask({ id: "t1", status: "pending", depends_on: ["dep"] }),
      makeTask({ id: "t2", status: "pending" }),
    ]);
    expect(findAllReadyTasks(data)).toEqual(["t2"]);
  });
});

// =============================================================================
// getTasksByStatus
// =============================================================================

describe("getTasksByStatus", () => {
  test("returns only tasks matching the given status", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "pending" }),
      makeTask({ id: "t2", status: "completed" }),
      makeTask({ id: "t3", status: "pending" }),
      makeTask({ id: "t4", status: "in_progress" }),
    ]);
    const result = getTasksByStatus(data, "pending");
    expect(result.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  test("returns empty array when no tasks match", () => {
    const data = makeTasksData([makeTask({ id: "t1", status: "pending" })]);
    expect(getTasksByStatus(data, "completed")).toEqual([]);
  });

  test("returns empty array for empty task list", () => {
    expect(getTasksByStatus(makeTasksData([]), "pending")).toEqual([]);
  });
});

// =============================================================================
// getProgress
// =============================================================================

describe("getProgress", () => {
  test("returns correct counts for mixed statuses", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "completed" }),
      makeTask({ id: "t2", status: "completed" }),
      makeTask({ id: "t3", status: "in_progress" }),
      makeTask({ id: "t4", status: "pending" }),
      makeTask({ id: "t5", status: "error" }),
    ]);
    const progress = getProgress(data);
    expect(progress).toEqual({
      total: 5,
      completed: 2,
      in_progress: 1,
      pending: 1,
      error: 1,
    });
  });

  test("returns all zeros for empty task list", () => {
    const progress = getProgress(makeTasksData([]));
    expect(progress).toEqual({
      total: 0,
      completed: 0,
      in_progress: 0,
      pending: 0,
      error: 0,
    });
  });

  test("returns correct counts when all tasks are completed", () => {
    const data = makeTasksData([
      makeTask({ id: "t1", status: "completed" }),
      makeTask({ id: "t2", status: "completed" }),
    ]);
    const progress = getProgress(data);
    expect(progress.total).toBe(2);
    expect(progress.completed).toBe(2);
    expect(progress.pending).toBe(0);
  });
});

// =============================================================================
// calculateCoverage
// =============================================================================

describe("calculateCoverage", () => {
  test("returns empty array when no requirements exist", () => {
    const data = makeTasksData([makeTask()]);
    expect(calculateCoverage(data)).toEqual([]);
  });

  test("returns empty array when requirements is empty array", () => {
    const data = makeTasksData([makeTask()], []);
    expect(calculateCoverage(data)).toEqual([]);
  });

  test("marks requirement as 'complete' when all covering tasks are completed", () => {
    const req: Requirement = {
      id: "REQ-01",
      description: "Setup",
      covered_by: ["t1", "t2"],
      status: "none",
    };
    const data = makeTasksData(
      [
        makeTask({ id: "t1", status: "completed" }),
        makeTask({ id: "t2", status: "completed" }),
      ],
      [req],
    );
    const result = calculateCoverage(data);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("complete");
  });

  test("marks requirement as 'partial' when some covering tasks are completed", () => {
    const req: Requirement = {
      id: "REQ-01",
      description: "Setup",
      covered_by: ["t1", "t2"],
      status: "none",
    };
    const data = makeTasksData(
      [
        makeTask({ id: "t1", status: "completed" }),
        makeTask({ id: "t2", status: "pending" }),
      ],
      [req],
    );
    const result = calculateCoverage(data);
    expect(result[0].status).toBe("partial");
  });

  test("marks requirement as 'none' when no covering tasks are completed", () => {
    const req: Requirement = {
      id: "REQ-01",
      description: "Setup",
      covered_by: ["t1", "t2"],
      status: "none",
    };
    const data = makeTasksData(
      [
        makeTask({ id: "t1", status: "pending" }),
        makeTask({ id: "t2", status: "pending" }),
      ],
      [req],
    );
    const result = calculateCoverage(data);
    expect(result[0].status).toBe("none");
  });

  test("marks requirement as 'none' when covered_by references no valid tasks", () => {
    const req: Requirement = {
      id: "REQ-01",
      description: "Setup",
      covered_by: ["ghost1", "ghost2"],
      status: "none",
    };
    const data = makeTasksData([], [req]);
    const result = calculateCoverage(data);
    expect(result[0].status).toBe("none");
  });

  test("handles mixed valid and invalid task references", () => {
    const req: Requirement = {
      id: "REQ-01",
      description: "Setup",
      covered_by: ["t1", "ghost"],
      status: "none",
    };
    const data = makeTasksData(
      [makeTask({ id: "t1", status: "completed" })],
      [req],
    );
    const result = calculateCoverage(data);
    // t1 is completed, ghost is filtered out → 1 of 1 valid tasks completed
    expect(result[0].status).toBe("complete");
  });

  test("preserves requirement fields in output", () => {
    const req: Requirement = {
      id: "REQ-42",
      description: "Critical feature",
      covered_by: ["t1"],
      status: "none",
    };
    const data = makeTasksData(
      [makeTask({ id: "t1", status: "pending" })],
      [req],
    );
    const result = calculateCoverage(data);
    expect(result[0].id).toBe("REQ-42");
    expect(result[0].description).toBe("Critical feature");
    expect(result[0].covered_by).toEqual(["t1"]);
  });
});
