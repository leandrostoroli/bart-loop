/**
 * Integration test: two in-process collab peers connected via localhost TCP.
 *
 * Covers:
 *   REQ-04 — state changes pushed immediately to all connected peers
 *   REQ-05 — workstream claiming with explicit lock message; first lock wins
 *   REQ-06 — peer disconnect releases claimed workstreams back to the pool
 *
 * Also covers pure utility functions from index.ts:
 *   generateJoinCode, getGitName, collabStatePath, collabEventsPath
 */
import { describe, test, expect, afterEach } from "bun:test";
import { CollabPeer } from "./peer.js";
import { generateJoinCode, getGitName, collabStatePath, collabEventsPath } from "./index.js";
import { join } from "path";

/** Poll until condition is true or timeout is reached. */
function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error("waitFor: condition not met within timeout"));
      } else {
        setTimeout(poll, 10);
      }
    };
    poll();
  });
}

describe("collab integration", () => {
  let peerA: CollabPeer | null = null;
  let peerB: CollabPeer | null = null;

  afterEach(async () => {
    if (peerB) {
      await peerB.disconnect();
      peerB = null;
    }
    if (peerA) {
      await peerA.disconnect();
      peerA = null;
    }
  });

  test("[REQ-04][REQ-05] peer B claims workstream; peer A sees the lock immediately", async () => {
    // Spin up host (peer A) on an OS-assigned port
    peerA = await CollabPeer.createHost(0, "alice");
    // Connect peer B to peer A
    peerB = await CollabPeer.join("127.0.0.1", peerA.getPort(), "bob");

    // Wait for the initial state-sync so peerB's local state is up-to-date
    // before claiming — avoids a late-arriving state-sync wiping a local claim.
    await waitFor(() => peerB!.getState().peers.has(peerA!.id));

    // Peer B claims the 'frontend' workstream
    peerB.claimWorkstream("frontend");

    // REQ-04: peer A must see the lock without any manual sync step
    await waitFor(() => peerA!.getOwnership().get("frontend") !== undefined && peerA!.getOwnership().get("frontend") !== null);

    expect(peerA.getOwnership().get("frontend")).toBe(peerB.id);
    // Peer B also reflects the lock in its own state
    expect(peerB.getOwnership().get("frontend")).toBe(peerB.id);
  });

  test("[REQ-06] peer B disconnect releases workstream on peer A's state", async () => {
    peerA = await CollabPeer.createHost(0, "alice");
    peerB = await CollabPeer.join("127.0.0.1", peerA.getPort(), "bob");

    peerB.claimWorkstream("backend");

    // Wait for peer A to see the initial claim
    await waitFor(() => peerA!.getOwnership().get("backend") !== undefined && peerA!.getOwnership().get("backend") !== null);
    expect(peerA.getOwnership().get("backend")).toBe(peerB.id);

    // Disconnect peer B
    await peerB.disconnect();
    peerB = null;

    // REQ-06: peer A must release the workstream back to the pool
    await waitFor(() => {
      const owner = peerA!.getOwnership().get("backend");
      return owner === null || owner === undefined;
    });

    const ownerAfterDisconnect = peerA.getOwnership().get("backend");
    expect(ownerAfterDisconnect === null || ownerAfterDisconnect === undefined).toBe(true);
  });

  test("[REQ-04] initial state syncs to joining peer", async () => {
    peerA = await CollabPeer.createHost(0, "alice");
    peerB = await CollabPeer.join("127.0.0.1", peerA.getPort(), "bob");

    // Wait for state-sync to arrive at peer B
    await waitFor(() => peerB!.getState().peers.has(peerA!.id));

    const stateB = peerB.getState();
    expect(stateB.peers.get(peerA.id)?.gitName).toBe("alice");
    expect(stateB.peers.get(peerB.id)?.gitName).toBe("bob");
  });

  test("[REQ-05] first lock wins when both peers try to claim the same workstream", async () => {
    peerA = await CollabPeer.createHost(0, "alice");
    peerB = await CollabPeer.join("127.0.0.1", peerA.getPort(), "bob");

    // Peer A claims 'shared' first
    peerA.claimWorkstream("shared");

    // Wait for peer B to receive the lock
    await waitFor(() => peerB!.getOwnership().get("shared") !== undefined && peerB!.getOwnership().get("shared") !== null);

    // Peer B attempts to claim the same workstream (should be rejected — A got there first)
    peerB.claimWorkstream("shared");

    // Allow any in-flight messages to settle
    await new Promise((r) => setTimeout(r, 50));

    // Peer A's claim must still hold on both sides
    expect(peerA.getOwnership().get("shared")).toBe(peerA.id);
    expect(peerB.getOwnership().get("shared")).toBe(peerA.id);
  });
});

// =============================================================================
// generateJoinCode
// =============================================================================

describe("generateJoinCode", () => {
  test("returns a 6-character string", () => {
    expect(generateJoinCode()).toHaveLength(6);
  });

  test("contains only characters from the unambiguous alphabet", () => {
    const validChars = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
    for (let i = 0; i < 50; i++) {
      expect(generateJoinCode()).toMatch(validChars);
    }
  });

  test("generates distinct codes across many calls", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateJoinCode()));
    expect(codes.size).toBeGreaterThan(190);
  });

  test("is uppercase", () => {
    const code = generateJoinCode();
    expect(code).toBe(code.toUpperCase());
  });
});

// =============================================================================
// getGitName
// =============================================================================

describe("getGitName", () => {
  test("returns a non-empty string", () => {
    const name = getGitName();
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// collabStatePath / collabEventsPath
// =============================================================================

describe("collabStatePath", () => {
  test("returns collab.json inside bartDir", () => {
    expect(collabStatePath("/project/.bart")).toBe(
      join("/project/.bart", "collab.json")
    );
  });
});

describe("collabEventsPath", () => {
  test("returns collab-events.jsonl inside bartDir", () => {
    expect(collabEventsPath("/project/.bart")).toBe(
      join("/project/.bart", "collab-events.jsonl")
    );
  });
});
