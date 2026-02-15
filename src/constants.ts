export const BART = `
██████╗  █████╗ ██████╗ ████████╗
 ██╔══██╗██╔══██╗██╔══██╗╚══██╔══╝
 ██████╔╝███████║██████╔╝   ██║   
 ██╔══██╗██╔══██║██╔══██╗   ██║   
 ██████╔╝██║  ██║██║  ██║   ██║   
 ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝  
`;

export const TASKS_FILE = ".bart/tasks.json";
export const PROMPT_TEMPLATE = ".bart/bart-prompt-template.md";

export interface Task {
  id: string;
  workstream: string;
  title: string;
  description: string;
  files: string[];
  depends_on: string[];
  status: "pending" | "in_progress" | "completed" | "error";
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
  type: "command" | "agent" | "skill";
  path: string;           // Absolute path to the .md file
  tools?: string[];
}

export interface TasksData {
  project?: string;
  plan_file?: string;
  project_root?: string;
  requirements?: Requirement[];
  specialists?: Specialist[];
  tasks: Task[];
}
