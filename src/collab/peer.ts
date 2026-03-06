import { EventEmitter } from "events";
import * as net from "net";
import type {
  CollabMessage,
  CollabState,
  LockMessage,
  Peer,
  PeerJoinMessage,
  ReleaseMessage,
  StateSyncMessage,
} from "./types.js";
import {
  type LockStore,
  applyLock,
  applyRelease,
  releaseAll,
  toOwnerMap,
} from "./ownership.js";

function makeFramer(onMessage: (msg: CollabMessage) => void) {
  let buf = "";
  return (chunk: string) => {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          onMessage(JSON.parse(trimmed) as CollabMessage);
        } catch {
          // ignore malformed messages
        }
      }
    }
  };
}

function sendMsg(socket: net.Socket, msg: CollabMessage): void {
  if (!socket.destroyed) {
    socket.write(JSON.stringify(msg) + "\n");
  }
}

function randomId(): string {
  return `peer-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A collab peer that can run as host (TCP server) or joiner (TCP client).
 * Handles workstream claiming, state sync, and peer-disconnect cleanup.
 *
 * REQ-04: state changes pushed immediately to all connected peers
 * REQ-05: workstream lock — first lock wins; tiebreak by timestamp then gitName
 * REQ-06: peer disconnect releases their claimed workstreams
 */
export class CollabPeer extends EventEmitter {
  readonly id: string;
  readonly gitName: string;

  private _state: CollabState;
  private _locks: LockStore = new Map();
  private _server: net.Server | null = null;
  private _socket: net.Socket | null = null;
  private _clients: Map<string, net.Socket> = new Map();
  private _port: number = 0;

  private constructor(id: string, gitName: string) {
    super();
    this.id = id;
    this.gitName = gitName;
    this._state = {
      localPeerId: id,
      peers: new Map([
        [id, { id, gitName, host: "127.0.0.1", port: 0, joinedAt: new Date().toISOString() }],
      ]),
      ownership: new Map(),
    };
  }

  /** Start a host peer — listens on port (use 0 for OS-assigned). */
  static async createHost(port: number, gitName: string): Promise<CollabPeer> {
    const id = randomId();
    const peer = new CollabPeer(id, gitName);

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((clientSocket) => {
        let clientPeerId: string | null = null;
        clientSocket.setEncoding("utf8");

        const framer = makeFramer((msg: CollabMessage) => {
          if (msg.type === "peer-join") {
            clientPeerId = msg.peer.id;
            peer._state.peers.set(msg.peer.id, msg.peer);
            peer._clients.set(msg.peer.id, clientSocket);

            // Send current state to the joining peer [REQ-04]
            const syncMsg: StateSyncMessage = {
              type: "state-sync",
              from: peer.id,
              timestamp: new Date().toISOString(),
              peers: Array.from(peer._state.peers.values()),
              ownership: Object.fromEntries(toOwnerMap(peer._locks)),
            };
            sendMsg(clientSocket, syncMsg);

            // Relay peer-join to other connected peers
            peer._broadcastToClients(msg, clientSocket);
            peer.emit("state-change", peer.getState());
          } else if (msg.type === "lock") {
            peer._applyLock(msg);
            peer._broadcastToClients(msg, clientSocket);
          } else if (msg.type === "release") {
            peer._applyRelease(msg);
            peer._broadcastToClients(msg, clientSocket);
          }
        });

        clientSocket.on("data", framer);

        const onDisconnect = () => {
          if (clientPeerId) {
            peer._clients.delete(clientPeerId);
            peer._handlePeerLeave(clientPeerId);
            clientPeerId = null;
          }
        };

        clientSocket.on("close", onDisconnect);
        clientSocket.on("error", onDisconnect);
      });

      server.listen(port, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        peer._port = addr.port;
        const selfPeer = peer._state.peers.get(id)!;
        selfPeer.port = peer._port;
        peer._server = server;
        resolve();
      });

      server.once("error", reject);
    });

    return peer;
  }

  /** Connect to an existing host peer. */
  static async join(host: string, port: number, gitName: string): Promise<CollabPeer> {
    const id = randomId();
    const peer = new CollabPeer(id, gitName);

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        peer._socket = socket;

        const selfPeer: Peer = {
          id,
          gitName,
          host,
          port,
          joinedAt: new Date().toISOString(),
        };

        const joinMsg: PeerJoinMessage = {
          type: "peer-join",
          from: id,
          timestamp: selfPeer.joinedAt,
          peer: selfPeer,
        };
        sendMsg(socket, joinMsg);
        resolve();
      });

      socket.setEncoding("utf8");

      const framer = makeFramer((msg: CollabMessage) => {
        switch (msg.type) {
          case "state-sync": {
            peer._state = {
              localPeerId: id,
              peers: new Map(msg.peers.map((p) => [p.id, p])),
              ownership: new Map(),
            };
            // Ensure self is in the peer registry
            if (!peer._state.peers.has(id)) {
              peer._state.peers.set(id, { id, gitName, host, port, joinedAt: new Date().toISOString() });
            }
            // Populate lock store from state-sync snapshot (no claim timestamp available; use sync timestamp)
            peer._locks.clear();
            for (const [ws, ownerId] of Object.entries(msg.ownership)) {
              const ownerPeer = peer._state.peers.get(ownerId ?? "");
              peer._locks.set(ws, ownerId
                ? { peerId: ownerId, timestamp: ownerPeer?.joinedAt ?? msg.timestamp, gitName: ownerPeer?.gitName ?? "" }
                : null);
            }
            peer.emit("state-change", peer.getState());
            break;
          }
          case "peer-join":
            peer._state.peers.set(msg.peer.id, msg.peer);
            peer.emit("state-change", peer.getState());
            break;
          case "lock":
            peer._applyLock(msg);
            break;
          case "release":
            peer._applyRelease(msg);
            break;
          case "peer-leave":
            peer._handlePeerLeave(msg.peerId);
            break;
        }
      });

      socket.on("data", framer);
      socket.once("error", reject);
    });

    return peer;
  }

  /** Claim a workstream. Sends a lock message to the network. [REQ-05] */
  claimWorkstream(workstream: string): void {
    const msg: LockMessage = {
      type: "lock",
      from: this.id,
      timestamp: new Date().toISOString(),
      workstream,
      gitName: this.gitName,
    };
    this._applyLock(msg);
    this._sendToNetwork(msg);
  }

  /** Get a snapshot of the current workstream ownership map. */
  getOwnership(): Map<string, string | null> {
    return toOwnerMap(this._locks);
  }

  /** Get a full snapshot of the current collab state. */
  getState(): CollabState {
    return {
      localPeerId: this._state.localPeerId,
      peers: new Map(this._state.peers),
      ownership: toOwnerMap(this._locks),
    };
  }

  /** The TCP port this peer is listening on (host mode only). */
  getPort(): number {
    return this._port;
  }

  /** Disconnect from the network and close any open TCP resources. */
  async disconnect(): Promise<void> {
    if (this._socket && !this._socket.destroyed) {
      this._socket.destroy();
      this._socket = null;
    }
    if (this._server) {
      await new Promise<void>((resolve) => {
        this._server!.close(() => resolve());
        for (const s of this._clients.values()) {
          s.destroy();
        }
      });
      this._server = null;
    }
  }

  private _sendToNetwork(msg: CollabMessage): void {
    if (this._socket && !this._socket.destroyed) {
      sendMsg(this._socket, msg);
    }
    this._broadcastToClients(msg);
  }

  private _broadcastToClients(msg: CollabMessage, exclude?: net.Socket): void {
    for (const s of this._clients.values()) {
      if (s !== exclude) {
        sendMsg(s, msg);
      }
    }
  }

  // REQ-05: first lock wins; tiebreak by timestamp then gitName (via ownership.ts)
  private _applyLock(msg: LockMessage): void {
    if (applyLock(this._locks, msg)) {
      this.emit("state-change", this.getState());
    }
  }

  private _applyRelease(msg: ReleaseMessage): void {
    if (applyRelease(this._locks, msg.workstream, msg.from)) {
      this.emit("state-change", this.getState());
    }
  }

  // REQ-06: release all workstreams owned by the departing peer
  private _handlePeerLeave(peerId: string): void {
    releaseAll(this._locks, peerId);
    this._state.peers.delete(peerId);
    this.emit("state-change", this.getState());

    // Broadcast peer-leave to remaining connected clients (host mode)
    this._broadcastToClients({
      type: "peer-leave",
      from: this.id,
      timestamp: new Date().toISOString(),
      peerId,
    });
  }
}
