// REQ-08: Engineer identity derived from git user.name
export interface Peer {
  id: string;        // Unique peer ID (UUID generated at session start)
  gitName: string;   // git user.name
  host: string;      // IP address or hostname
  port: number;      // TCP port
  joinedAt: string;  // ISO 8601
}

// REQ-01: Registry of all known peers in the collab session
export type PeerRegistry = Map<string, Peer>;

// REQ-04: Maps workstream ID to the ID of the owning peer, or null if unclaimed
export type WorkstreamOwnershipMap = Map<string, string | null>;

// ── Message Protocol ──────────────────────────────────────────────────────────

export type CollabMessageType =
  | "lock"
  | "release"
  | "state-sync"
  | "peer-join"
  | "peer-leave";

interface BaseMessage {
  type: CollabMessageType;
  from: string;      // sender peer ID
  timestamp: string; // ISO 8601 — used for tiebreaking (REQ-05)
}

// REQ-05: Claim a workstream; first peer to send wins (ties broken by timestamp + gitName)
export interface LockMessage extends BaseMessage {
  type: "lock";
  workstream: string;
  gitName: string; // included for tiebreaking without a registry lookup
}

// Release a claimed workstream (explicit release or on disconnect cleanup)
export interface ReleaseMessage extends BaseMessage {
  type: "release";
  workstream: string;
}

// REQ-04: Full state snapshot sent to a newly joined peer or after reconnect
export interface StateSyncMessage extends BaseMessage {
  type: "state-sync";
  peers: Peer[];
  ownership: Record<string, string | null>; // workstream ID -> peer ID | null
}

// REQ-01: Broadcast when a new peer joins the session
export interface PeerJoinMessage extends BaseMessage {
  type: "peer-join";
  peer: Peer;
}

// REQ-06: Broadcast when a peer disconnects; recipients release their workstreams
export interface PeerLeaveMessage extends BaseMessage {
  type: "peer-leave";
  peerId: string;
}

export type CollabMessage =
  | LockMessage
  | ReleaseMessage
  | StateSyncMessage
  | PeerJoinMessage
  | PeerLeaveMessage;

// ── Local State ───────────────────────────────────────────────────────────────

export interface CollabState {
  localPeerId: string;
  peers: PeerRegistry;
  ownership: WorkstreamOwnershipMap;
}
