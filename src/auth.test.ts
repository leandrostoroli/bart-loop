import { describe, test, expect } from "bun:test";
import { authenticate, generateToken, verifyToken } from "./auth.js";

// =============================================================================
// generateToken
// =============================================================================

describe("generateToken", () => {
  test("returns a non-empty string", () => {
    const token = generateToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  test("generates unique tokens on each call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});

// =============================================================================
// verifyToken
// =============================================================================

describe("verifyToken", () => {
  test("returns true for a valid token", () => {
    const token = generateToken();
    expect(verifyToken(token, [token])).toBe(true);
  });

  test("returns false for an invalid token", () => {
    expect(verifyToken("bad-token", ["good-token"])).toBe(false);
  });

  test("returns false for an empty token", () => {
    expect(verifyToken("", ["good-token"])).toBe(false);
  });

  test("returns false when valid tokens list is empty", () => {
    expect(verifyToken("any-token", [])).toBe(false);
  });

  test("matches against multiple valid tokens", () => {
    const tokens = ["token-a", "token-b", "token-c"];
    expect(verifyToken("token-b", tokens)).toBe(true);
    expect(verifyToken("token-d", tokens)).toBe(false);
  });
});

// =============================================================================
// authenticate (middleware)
// =============================================================================

describe("authenticate", () => {
  const validTokens = ["test-token-123"];

  test("returns null for a valid Bearer token", () => {
    const req = new Request("http://localhost/tasks", {
      headers: { Authorization: "Bearer test-token-123" },
    });
    const result = authenticate(req, validTokens);
    expect(result).toBeNull();
  });

  test("returns 401 response when no Authorization header", () => {
    const req = new Request("http://localhost/tasks");
    const result = authenticate(req, validTokens);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  test("returns 401 response for invalid token", () => {
    const req = new Request("http://localhost/tasks", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    const result = authenticate(req, validTokens);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  test("returns 401 for non-Bearer auth scheme", () => {
    const req = new Request("http://localhost/tasks", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    const result = authenticate(req, validTokens);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  test("401 response body contains error message", async () => {
    const req = new Request("http://localhost/tasks");
    const result = authenticate(req, validTokens);
    const body = await result!.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("returns null when no valid tokens configured (auth disabled)", () => {
    const req = new Request("http://localhost/tasks");
    const result = authenticate(req, []);
    expect(result).toBeNull();
  });
});
