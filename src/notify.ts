import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const CONFIG_DIR = join(process.env.HOME || "", ".bart");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface BartConfig {
  agent?: string;
  auto_continue?: boolean;
  notify_url?: string;
}

function loadConfig(): BartConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

export type NotificationStatus = "completed" | "blocked";

export interface WorkstreamNotification {
  name: string;
  status: NotificationStatus;
  message: string;
}

export async function sendNotification(notification: WorkstreamNotification): Promise<void> {
  const config = loadConfig();
  const isMac = process.platform === "darwin";
  
  if (isMac) {
    const title = notification.status === "completed" 
      ? `Workstream ${notification.name} completed` 
      : `Workstream ${notification.name} blocked`;
    
    const message = notification.message;
    
    const script = `display notification "${message}" with title "${title}"`;
    
    return new Promise((resolve) => {
      const child = spawn("osascript", ["-e", script]);
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  }
  
  if (config.notify_url) {
    const input = `${notification.name}|${notification.status}|${notification.message}`;
    const encodedInput = encodeURIComponent(input);
    const url = `${config.notify_url}&input=${encodedInput}`;
    
    return new Promise((resolve) => {
      const child = spawn("open", [url]);
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  }
}

export function isNotificationConfigured(): boolean {
  const config = loadConfig();
  return !!config.notify_url || process.platform === "darwin";
}
