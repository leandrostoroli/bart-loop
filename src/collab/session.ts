import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { hostname } from "os";
import { CollabTransport, PeerConnection } from "./transport.js";
import {
  createAdvertiser,
  createBrowser,
  type DiscoveryAdvertiser,
  type DiscoveredHost,
} from "./discovery.js";
import type {
  Peer,
  CollabState,
  CollabMessage,
  StateSyncMessage,
  PeerJoinMessage,
  PeerLeaveMessage,
  LockMessage,
  ReleaseMessage,
} from "./types.js";

function getGitName(): string {
  try {
    return execSync("git config user.name", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function now(): string {
  return new Date().toISOString();
}

function makeJoinCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export interface HostOptions {
  port?: number;
}

export interface JoinOptions {
  discoverTimeoutMs?: number;
}

/**
 * High-level session manager for a bart-collab session.
 *
 * Host mode  — call `host()`, receive the join code, then listen for events.
 * Client mode — call `join(code)`, wait for the state-sync handshake, then interact.
 *
 * Events emitted:
 *   "peer-join"  (peer: Peer)           — a peer joined the session
 *   "peer-leave" (peerId: string)        — a peer disconnected (after reconnect exhausted)
 *   "lock"       (msg: LockMessage)      — a peer claimed a workstream
 *   "release"    (msg: ReleaseMessage)   — a peer released a workstream
 *   "state-sync" (msg: StateSyncMessage) — full state snapshot received (join mode)
 *   "error"      (err: Error)            — unrecoverable error
 */
export class CollabSession extends EventEmitter {
  readonly localPeer: Peer;
  readonly state: CollabState;

  private transport = new CollabTransport();
  private advertiser: DiscoveryAdvertiser | null = null;

  // Host mode: peer connections keyed by real peerId (after handshake)
  private connections = new Map<string, PeerConnection>();
  // Host mode: pending connections before peer-join handshake, keyed by socket addr
  private pending = new Map<string, PeerConnection>();

  // Join mode: single connection to the host
  private hostConn: PeerConnection | null = null;

  private _closed = false;

  constructor(options?: { gitName?: string }) {
    super();
    const gitName = options?.gitName ?? getGitName();
    const id = randomUUID();
    this.localPeer = {
      id,
      gitName,
      host: hostname(),
      port: 0, // filled in after listen()
      joinedAt: now(),
    };
    this.state = {
      localPeerId: id,
      peers: new Map([[id, this.localPeer]]),
      ownership: new Map(),
    };
  }

  // ── Host mode ────────────────────────────────────────────────────────────────

  /**
   * Start listening for peers and advertise on the LAN (REQ-02).
   * Resolves with the join code that peers should pass to join().
   */
  async host(options: HostOptions = {}): Promise<string> {
    const port = await this.transport.listen(options.port ?? 0);
    this.localPeer.port = port;

    this.transport.on("peer", (conn: PeerConnection) => {
      this.handleIncomingPeer(conn);
    });

    this.transport.on("error", (err: Error) => {
      this.emit("error", err);
    });

    const code = makeJoinCode();
    this.advertiser = createAdvertiser(this.localPeer, code, port);
    return code;
  }

  private handleIncomingPeer(conn: PeerConnection): void {
    this.pending.set(conn.peerId, conn);

    conn.on("message", (msg: CollabMessage) => {
      if (msg.type === "peer-join") {
        this.pending.delete(conn.peerId);
        const peer = msg.peer;
        this.state.peers.set(peer.id, peer);
        this.connections.set(peer.id, conn);

        // Send full state snapshot to the new peer (REQ-04)
        const syncMsg: StateSyncMessage = {
          type: "state-sync",
          from: this.localPeer.id,
          timestamp: now(),
          peers: Array.from(this.state.peers.values()),
          ownership: Object.fromEntries(this.state.ownership),
        };
        conn.send(syncMsg);

        // Broadcast peer-join to all existing peers
        const joinBroadcast: PeerJoinMessage = {
          type: "peer-join",
          from: this.localPeer.id,
          timestamp: now(),
          peer,
        };
        for (const [id, c] of this.connections) {
          if (id !== peer.id) c.send(joinBroadcast);
        }

        this.emit("peer-join", peer);
      } else {
        this.routeMessage(msg);
      }
    });

    conn.on("close", () => {
      // Check pending first (disconnect before handshake — nothing to clean up)
      if (this.pending.delete(conn.peerId)) return;

      // Find real peerId
      let leavingPeerId: string | null = null;
      for (const [id, c] of this.connections) {
        if (c === conn) {
          leavingPeerId = id;
          break;
        }
      }
      if (leavingPeerId) this.handlePeerLeave(leavingPeerId);
    });

    conn.on("error", () => {
      // Errors are followed by a close event; handled there
    });
  }

  private handlePeerLeave(peerId: string): void {
    this.connections.delete(peerId);
    this.state.peers.delete(peerId);

    // Release any workstreams owned by the departed peer
    for (const [workstream, owner] of this.state.ownership) {
      if (owner === peerId) this.state.ownership.set(workstream, null);
    }

    // Broadcast peer-leave to remaining peers
    const leaveMsg: PeerLeaveMessage = {
      type: "peer-leave",
      from: this.localPeer.id,
      timestamp: now(),
      peerId,
    };
    for (const conn of this.connections.values()) {
      conn.send(leaveMsg);
    }

    this.emit("peer-leave", peerId);
  }

  // ── Join mode ────────────────────────────────────────────────────────────────

  /**
   * Discover the host via mDNS and connect via TCP (REQ-03).
   * Resolves once the state-sync handshake is complete.
   */
  async join(code: string, options: JoinOptions = {}): Promise<void> {
    const browser = createBrowser();
    let discovered: DiscoveredHost;
    try {
      discovered = await browser.find(code, options.discoverTimeoutMs);
    } finally {
      browser.stop();
    }

    const conn = await this.transport.connect(discovered.host, discovered.port);
    this.hostConn = conn;

    // Announce ourselves to the host
    const joinMsg: PeerJoinMessage = {
      type: "peer-join",
      from: this.localPeer.id,
      timestamp: now(),
      peer: this.localPeer,
    };
    conn.send(joinMsg);

    // Wait for the state-sync response before resolving
    await new Promise<void>((resolve, reject) => {
      const onMessage = (msg: CollabMessage) => {
        if (msg.type === "state-sync") {
          conn.off("message", onMessage);
          conn.off("close", onClose);
          this.applyStateSync(msg);
          resolve();
        } else {
          this.routeMessage(msg);
        }
      };
      const onClose = () => {
        conn.off("message", onMessage);
        reject(new Error("Connection closed before state-sync received"));
      };
      conn.on("message", onMessage);
      conn.once("close", onClose);
    });

    // Continue routing messages after handshake
    conn.on("message", (msg: CollabMessage) => {
      this.routeMessage(msg);
    });

    conn.on("close", () => {
      // Connection exhausted its reconnect budget — host is gone
      this.emit("peer-leave", discovered.txt.peer);
    });
  }

  // ── Shared message routing ───────────────────────────────────────────────────

  private routeMessage(msg: CollabMessage): void {
    switch (msg.type) {
      case "lock": {
        // First writer wins; host forwards to other peers
        if (!this.state.ownership.get(msg.workstream)) {
          this.state.ownership.set(msg.workstream, msg.from);
        }
        this.emit("lock", msg);
        this.forwardToOthers(msg);
        break;
      }
      case "release": {
        if (this.state.ownership.get(msg.workstream) === msg.from) {
          this.state.ownership.set(msg.workstream, null);
        }
        this.emit("release", msg);
        this.forwardToOthers(msg);
        break;
      }
      case "peer-join": {
        this.state.peers.set(msg.peer.id, msg.peer);
        this.emit("peer-join", msg.peer);
        break;
      }
      case "peer-leave": {
        this.state.peers.delete(msg.peerId);
        for (const [ws, owner] of this.state.ownership) {
          if (owner === msg.peerId) this.state.ownership.set(ws, null);
        }
        this.emit("peer-leave", msg.peerId);
        break;
      }
      case "state-sync": {
        this.applyStateSync(msg);
        this.emit("state-sync", msg);
        break;
      }
    }
  }

  private applyStateSync(msg: StateSyncMessage): void {
    this.state.peers.clear();
    for (const peer of msg.peers) {
      this.state.peers.set(peer.id, peer);
    }
    // Always keep local peer in registry
    this.state.peers.set(this.localPeer.id, this.localPeer);

    this.state.ownership.clear();
    for (const [ws, owner] of Object.entries(msg.ownership)) {
      this.state.ownership.set(ws, owner);
    }
  }

  /**
   * In host mode, forward a message to all peers except the originating sender.
   * In join mode, this is a no-op (host handles forwarding).
   */
  private forwardToOthers(msg: CollabMessage): void {
    if (this.hostConn) return; // join mode — host forwards
    for (const [id, conn] of this.connections) {
      if (id !== msg.from) conn.send(msg);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Claim a workstream. First-write wins; ties broken by timestamp + gitName (REQ-05).
   */
  lock(workstream: string): void {
    const msg: LockMessage = {
      type: "lock",
      from: this.localPeer.id,
      timestamp: now(),
      workstream,
      gitName: this.localPeer.gitName,
    };
    this.sendToNetwork(msg);
    this.routeMessage(msg);
  }

  /**
   * Release a previously claimed workstream.
   */
  release(workstream: string): void {
    const msg: ReleaseMessage = {
      type: "release",
      from: this.localPeer.id,
      timestamp: now(),
      workstream,
    };
    this.sendToNetwork(msg);
    this.routeMessage(msg);
  }

  private sendToNetwork(msg: CollabMessage): void {
    if (this.hostConn) {
      // Join mode: send to host only; host forwards to other peers
      this.hostConn.send(msg);
    } else {
      // Host mode: broadcast directly to all peers
      for (const conn of this.connections.values()) {
        conn.send(msg);
      }
    }
  }

  /**
   * Shut down the session and release all resources.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.advertiser?.stop();
    this.hostConn?.close();
    for (const conn of this.connections.values()) conn.close();
    for (const conn of this.pending.values()) conn.close();
    this.transport.close();
  }
}
