import { EventEmitter } from "events";
import * as net from "net";
import type { CollabMessage } from "./types.js";

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1_000;

// ── PeerConnection ─────────────────────────────────────────────────────────────

/**
 * Wraps a single TCP socket with newline-delimited JSON framing.
 *
 * Events:
 *   "message"  (msg: CollabMessage)  — a complete JSON message was received
 *   "close"    ()                    — socket closed (after reconnect budget is exhausted if client)
 *   "error"    (err: Error)          — unrecoverable socket error
 */
export class PeerConnection extends EventEmitter {
  readonly peerId: string;
  private socket: net.Socket;
  private buffer = "";
  private _closed = false;

  // Client-mode reconnect state (null for server-accepted connections)
  private reconnectOpts: { host: string; port: number } | null = null;
  private reconnectAttempts = 0;

  constructor(socket: net.Socket, peerId: string) {
    super();
    this.peerId = peerId;
    this.socket = socket;
    this.attachSocketHandlers(socket);
  }

  get closed(): boolean {
    return this._closed;
  }

  /**
   * Send a message to this peer. Serialised as newline-delimited JSON.
   */
  send(msg: CollabMessage): void {
    if (this._closed) return;
    try {
      this.socket.write(JSON.stringify(msg) + "\n");
    } catch {
      // Socket may have already closed; ignore write errors
    }
  }

  /**
   * Close the connection permanently (no reconnect).
   */
  close(): void {
    this._closed = true;
    this.reconnectOpts = null;
    try {
      this.socket.destroy();
    } catch {}
  }

  /**
   * Configure client-mode reconnect. Called by CollabTransport after connect().
   */
  _enableReconnect(host: string, port: number): void {
    this.reconnectOpts = { host, port };
  }

  private attachSocketHandlers(socket: net.Socket): void {
    socket.setEncoding("utf8");
    socket.setKeepAlive(true, 5_000);

    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split("\n");
      // Last element is a partial line (or empty string after a complete line)
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as CollabMessage;
          this.emit("message", msg);
        } catch {
          // Malformed JSON — skip silently
        }
      }
    });

    socket.on("error", (err: Error) => {
      // Error is always followed by a "close" event; let close handle reconnect
      this.emit("error", err);
    });

    socket.on("close", () => {
      if (this._closed) {
        this.emit("close");
        return;
      }
      this.attemptReconnect();
    });
  }

  private attemptReconnect(): void {
    if (!this.reconnectOpts || this._closed) {
      this._closed = true;
      this.emit("close");
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this._closed = true;
      this.emit("close");
      return;
    }

    this.reconnectAttempts++;
    const { host, port } = this.reconnectOpts;
    const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;

    setTimeout(() => {
      if (this._closed) return;
      const newSocket = net.createConnection({ host, port }, () => {
        // Successfully reconnected — reset attempt counter
        this.reconnectAttempts = 0;
        this.buffer = "";
        this.socket = newSocket;
        this.attachSocketHandlers(newSocket);
        this.emit("reconnect");
      });

      newSocket.once("error", () => {
        // The error handler on the new socket will trigger its "close" event,
        // which calls attemptReconnect again.
        this.socket = newSocket;
        this.attachSocketHandlers(newSocket);
      });
    }, delay).unref();
  }
}

// ── CollabTransport ────────────────────────────────────────────────────────────

/**
 * Manages the TCP layer for a collab session.
 *
 * Host mode  — call `listen()`, then receive `"peer"` events for each joiner.
 * Client mode — call `connect()` to obtain a PeerConnection to the host.
 *
 * Events (host):
 *   "peer"   (conn: PeerConnection) — a new peer has connected
 *   "error"  (err: Error)           — server error
 *
 * Events (shared):
 *   "error"  (err: Error)
 */
export class CollabTransport extends EventEmitter {
  private server: net.Server | null = null;

  /**
   * Start a TCP server and listen for incoming peer connections (REQ-02).
   * Resolves with the actual port once listening.
   * Pass port=0 to let the OS assign an ephemeral port.
   */
  listen(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        const peerId = socket.remoteAddress + ":" + socket.remotePort;
        const conn = new PeerConnection(socket, peerId);
        this.emit("peer", conn);
      });

      server.on("error", (err) => {
        this.emit("error", err);
        reject(err);
      });

      server.listen(port, () => {
        const addr = server.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : port;
        this.server = server;
        resolve(actualPort);
      });
    });
  }

  /**
   * Connect to a host as a joining peer (REQ-03).
   * Retries up to MAX_RECONNECT_ATTEMPTS times on failure.
   * Resolves with a PeerConnection once the TCP handshake succeeds.
   */
  connect(host: string, port: number): Promise<PeerConnection> {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const tryConnect = () => {
        attempts++;
        const socket = net.createConnection({ host, port });

        socket.once("connect", () => {
          const conn = new PeerConnection(socket, `${host}:${port}`);
          conn._enableReconnect(host, port);
          resolve(conn);
        });

        socket.once("error", (err) => {
          socket.destroy();
          if (attempts >= MAX_RECONNECT_ATTEMPTS) {
            reject(
              new Error(
                `Failed to connect to ${host}:${port} after ${attempts} attempt(s): ${err.message}`
              )
            );
          } else {
            setTimeout(tryConnect, RECONNECT_DELAY_MS * attempts).unref();
          }
        });
      };

      tryConnect();
    });
  }

  /**
   * Broadcast a message to all currently tracked peer connections.
   * Callers that manage a peer list can use this helper directly.
   */
  static broadcast(peers: PeerConnection[], msg: CollabMessage): void {
    for (const peer of peers) {
      peer.send(msg);
    }
  }

  /**
   * Stop the server (if running) and release resources.
   */
  close(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
