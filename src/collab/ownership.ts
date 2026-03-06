import type { LockMessage } from "./types.js";

// REQ-05: Full lock metadata stored locally for tiebreak comparisons
export interface WorkstreamLock {
  peerId: string;
  timestamp: string; // ISO 8601 — when the peer sent the lock message
  gitName: string;
}

/** Maps workstream ID to its current lock, or null if unclaimed. */
export type LockStore = Map<string, WorkstreamLock | null>;

/**
 * Returns true if `incoming` beats `current`.
 * Earlier timestamp wins; gitName (lexical ascending) is the tiebreak.
 */
export function lockWins(
  incoming: { timestamp: string; gitName: string },
  current: { timestamp: string; gitName: string }
): boolean {
  if (incoming.timestamp < current.timestamp) return true;
  if (incoming.timestamp > current.timestamp) return false;
  return incoming.gitName < current.gitName;
}

/**
 * Apply a lock message to the store (REQ-05).
 * Returns true if ownership changed.
 */
export function applyLock(store: LockStore, msg: LockMessage): boolean {
  const current = store.get(msg.workstream);
  if (current === undefined || current === null) {
    store.set(msg.workstream, {
      peerId: msg.from,
      timestamp: msg.timestamp,
      gitName: msg.gitName,
    });
    return true;
  }
  if (current.peerId === msg.from) return false;
  if (lockWins(msg, current)) {
    store.set(msg.workstream, {
      peerId: msg.from,
      timestamp: msg.timestamp,
      gitName: msg.gitName,
    });
    return true;
  }
  return false;
}

/**
 * Release a workstream lock if owned by the given peer.
 * Returns true if ownership changed.
 */
export function applyRelease(
  store: LockStore,
  workstream: string,
  peerId: string
): boolean {
  if (store.get(workstream)?.peerId === peerId) {
    store.set(workstream, null);
    return true;
  }
  return false;
}

/**
 * Release all workstreams owned by a departing peer (REQ-06).
 * Returns the list of workstream IDs that were released.
 */
export function releaseAll(store: LockStore, peerId: string): string[] {
  const released: string[] = [];
  for (const [ws, lock] of store) {
    if (lock?.peerId === peerId) {
      store.set(ws, null);
      released.push(ws);
    }
  }
  return released;
}

/**
 * Convert the lock store to the simple peerId map used by CollabState.ownership
 * and state-sync messages.
 */
export function toOwnerMap(store: LockStore): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const [ws, lock] of store) {
    map.set(ws, lock?.peerId ?? null);
  }
  return map;
}
