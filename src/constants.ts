export const BART = `
██████╗  █████╗ ██████╗ ████████╗
 ██╔══██╗██╔══██╗██╔══██╗╚══██╔══╝
 ██████╔╝███████║██████╔╝   ██║   
 ██╔══██╗██╔══██║██╔══██╗   ██║   
 ██████╔╝██║  ██║██║  ██║   ██║   
 ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝  
`;

export const BART_DIR = ".bart";
export const PLANS_DIR = ".bart/plans";
export const PROMPT_TEMPLATE = ".bart/bart-prompt-template.md";

export interface Task {
  id: string;
  workstream: string;
  title: string;
  description: string;
  files: string[];
  depends_on: string[];
  status: "pending" | "in_progress" | "completed" | "error" | "needs_escalation";
  requirements?: string[];  // REQ-IDs this task covers (explicit or auto-generated)
  specialist?: string;       // Matched specialist name (e.g., "code-architect")
  files_modified: string[];
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface Requirement {
  id: string;           // "REQ-01" (explicit) or "REQ-SETUP" (auto-generated from heading)
  description: string;  // The requirement text or section heading
  covered_by: string[]; // Task IDs
  status: "none" | "partial" | "complete";
}

export interface Specialist {
  name: string;
  description: string;
  type: "command" | "agent" | "skill" | "profile";
  path: string;           // Absolute path to the .md file
  tools?: string[];
  role?: string;          // Profile role (e.g., "backend engineer", "QA lead")
  skills?: string[];      // Referenced skill names (profile-specific)
  standards?: string[];   // Referenced standards (profile-specific)
  agents?: string[];      // Referenced agent names (profile-specific)
  premises?: string;      // Content from profile body (guidelines, rules, standards)
  learnings?: string[];   // Parsed learning entries appended over time
  test_expectations?: string[];  // Custom test coverage expectations (e.g., "unit tests for all public functions")
}

export interface TestingMetadata {
  test_command?: string;
  framework?: string;
  conventions?: string;
}

export interface TasksData {
  project?: string;
  plan_file?: string;
  project_root?: string;
  requirements?: Requirement[];
  specialists?: Specialist[];
  testing?: TestingMetadata;
  tasks: Task[];
}

/** Default quality standards applied when a task has no specialist assigned. */
export const DEFAULT_QUALITY_GATE = [
  "Follow existing code style, naming conventions, and patterns in the files you modify",
  "Do not introduce new dependencies or abstractions unless the task requires it",
  "Keep changes minimal and focused — avoid unrelated refactors or cleanups",
  "Write tests before production code — follow the RED-GREEN-REFACTOR cycle",
  "Show actual test command output as evidence before claiming task completion",
  "Tests must verify real behavior, not mock behavior",
];

export const HISTORY_FILE = "history.jsonl";

export interface HistoryEntry {
  timestamp: string;          // ISO 8601
  event: "completed" | "error" | "reset" | "review_pass" | "review_fail";
  task_id: string;
  plan_slug: string;          // directory name from .bart/plans/<slug>/ or "_legacy"
  specialist: string | null;
  status: "completed" | "error" | "reset" | "review_pass" | "review_fail";
  duration_ms: number | null; // null for resets
  resets: number;             // count of prior resets for this task+plan
  files: string[];
  workstream: string;
  title: string;
  review_issues?: string[];   // issues reported by workstream reviewer (review_fail events)
  tasks_reset?: string[];     // task IDs reset due to review failure
}
