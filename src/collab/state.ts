import { readFileSync, writeFileSync, existsSync } from "fs";
import { hostname } from "os";

export const LOCAL_HOST = hostname();

export interface WorkstreamCollab {
  engineer: string | null;  // null = available
  isRemote: boolean;        // true = claimed from another host
  claimedAt: string | null; // ISO timestamp
  host: string | null;      // hostname that claimed it
}

export interface CollabState {
  workstreams: Record<string, WorkstreamCollab>;
}

export interface CollabPushMessage {
  type: "claim" | "release" | "heartbeat" | "peer-leave";
  workstream?: string; // unused for peer-leave
  engineer: string;
  host: string;
  timestamp: string;
}

export function emptyCollabState(): CollabState {
  return { workstreams: {} };
}

export function readCollabState(collabPath: string): CollabState {
  try {
    if (existsSync(collabPath)) {
      return JSON.parse(readFileSync(collabPath, "utf-8"));
    }
  } catch {}
  return emptyCollabState();
}

export function writeCollabState(collabPath: string, state: CollabState): void {
  writeFileSync(collabPath, JSON.stringify(state, null, 2));
}

export function applyPushMessage(
  state: CollabState,
  msg: CollabPushMessage
): CollabState {
  const next: CollabState = { workstreams: { ...state.workstreams } };
  const isRemote = msg.host !== LOCAL_HOST;

  if (msg.type === "claim" || msg.type === "heartbeat") {
    next.workstreams[msg.workstream!] = {
      engineer: msg.engineer,
      isRemote,
      claimedAt: msg.timestamp,
      host: msg.host,
    };
  } else if (msg.type === "release") {
    const { [msg.workstream!]: _removed, ...rest } = next.workstreams;
    next.workstreams = rest;
  } else if (msg.type === "peer-leave") {
    // Release all workstreams owned by the departing host (REQ-06)
    next.workstreams = Object.fromEntries(
      Object.entries(next.workstreams).filter(([, ci]) => ci.host !== msg.host)
    );
  }

  return next;
}

export function getWorkstreamCollab(
  state: CollabState,
  workstream: string
): WorkstreamCollab {
  return (
    state.workstreams[workstream] ?? {
      engineer: null,
      isRemote: false,
      claimedAt: null,
      host: null,
    }
  );
}
