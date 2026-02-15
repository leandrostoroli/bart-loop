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
  files_modified: string[];
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface TasksData {
  tasks: Task[];
}
