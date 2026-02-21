import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Task } from "./constants.js";

const CONFIG_DIR = join(process.env.HOME || "", ".bart");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface BartConfig {
  agent?: string;
  auto_continue?: boolean;
  telegram_bot_token?: string;
  telegram_chat_id?: string;
}

function loadConfig(): BartConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

export function isTelegramConfigured(): boolean {
  const config = loadConfig();
  return !!config.telegram_bot_token && !!config.telegram_chat_id;
}

export async function sendTelegramTestMessage(botToken: string, chatId: string): Promise<boolean> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "🤖 *BART* connected successfully!\nYou'll receive task and workstream notifications here.",
        parse_mode: "Markdown",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendTelegram(message: string): Promise<void> {
  const config = loadConfig();
  const { telegram_bot_token, telegram_chat_id } = config;

  if (!telegram_bot_token || !telegram_chat_id) {
    return;
  }

  const url = `https://api.telegram.org/bot${telegram_bot_token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegram_chat_id,
        text: message,
        parse_mode: "Markdown",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Telegram notification failed (${res.status}): ${body}`);
    }
  } catch (err) {
    console.error(`Telegram notification error: ${err}`);
  }
}

// --- Message Formatters [REQ-04 through REQ-08] ---

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export function formatTaskCompleted(task: Task): string {
  const duration = task.started_at && task.completed_at
    ? formatDuration(new Date(task.completed_at).getTime() - new Date(task.started_at).getTime())
    : "unknown";
  const specialist = task.specialist ? ` (${task.specialist})` : "";
  return `✅ *Task ${task.id} completed*\n` +
    `${task.title}${specialist}\n` +
    `Duration: ${duration}`;
}

export function formatTaskError(task: Task, attempt: number): string {
  const error = task.error || "Unknown error";
  return `❌ *Task ${task.id} failed* (attempt ${attempt})\n` +
    `${task.title}\n` +
    `Error: ${error}`;
}

export function formatCriticalError(context: string): string {
  return `🚨 *CRITICAL ERROR*\n` +
    `*Immediate attention required*\n` +
    `${context}`;
}

export function formatWorkstreamCompleted(name: string, completed: number, total: number): string {
  return `🎉 *Workstream ${name}* — Completed\n` +
    `${completed}/${total} tasks done`;
}

export function formatWorkstreamBlocked(name: string, deps: string[]): string {
  return `⚠️ *Workstream ${name}* — Blocked\n` +
    `Waiting on: ${deps.join(", ")}`;
}

export function formatMilestone(percentage: number, completed: number, total: number, activeWorkstreams: string[]): string {
  const ws = activeWorkstreams.length > 0 ? `\nActive: ${activeWorkstreams.join(", ")}` : "";
  return `🏁 *Milestone: ${percentage}% complete*\n` +
    `${completed}/${total} tasks done${ws}`;
}

