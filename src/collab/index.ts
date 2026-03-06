import { join } from "path";
import { execSync } from "child_process";
import { hostname } from "os";
import { CollabSession } from "./session.js";
import type { Peer } from "./types.js";

export * from "./state.js";
export { CollabSession } from "./session.js";

export function collabStatePath(bartDir: string): string {
  return join(bartDir, "collab.json");
}

export function collabEventsPath(bartDir: string): string {
  return join(bartDir, "collab-events.jsonl");
}

/** Generate a short random join code (6 uppercase alphanumeric chars, no ambiguous chars). */
export function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Resolve engineer identity from git config user.name, falling back to OS hostname. */
export function getGitName(): string {
  try {
    return execSync("git config user.name", { encoding: "utf-8" }).trim();
  } catch {
    return hostname();
  }
}

export interface HostSession {
  code: string;
  port: number;
  session: CollabSession;
  stop(): void;
}

export interface JoinSession {
  peers: Peer[];
  session: CollabSession;
  stop(): void;
}

/**
 * Start a collab session as host (REQ-02).
 * Starts a TCP server, advertises via mDNS, and returns the join code.
 */
export async function startCollab(options?: { port?: number }): Promise<HostSession> {
  const session = new CollabSession();
  const code = await session.host({ port: options?.port });
  return {
    code,
    port: session.localPeer.port,
    session,
    stop() {
      session.close();
    },
  };
}

/**
 * Join an existing collab session by code (REQ-03).
 * Discovers the host via mDNS, connects via TCP, and receives the initial state snapshot.
 */
export async function joinCollab(
  code: string,
  options?: { timeoutMs?: number }
): Promise<JoinSession> {
  const session = new CollabSession();
  await session.join(code, { discoverTimeoutMs: options?.timeoutMs });
  return {
    peers: Array.from(session.state.peers.values()),
    session,
    stop() {
      session.close();
    },
  };
}
