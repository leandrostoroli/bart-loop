import { randomBytes } from "crypto";

/**
 * Generate a cryptographically random bearer token.
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Check whether a token exists in the list of valid tokens.
 */
export function verifyToken(token: string, validTokens: string[]): boolean {
  if (!token || validTokens.length === 0) return false;
  return validTokens.includes(token);
}

/**
 * Authenticate an incoming request using Bearer token.
 *
 * Returns `null` if the request is authorized (or auth is disabled),
 * otherwise returns a 401 Response.
 *
 * Auth is disabled when `validTokens` is empty.
 */
export function authenticate(
  req: Request,
  validTokens: string[],
): Response | null {
  // Auth disabled when no tokens are configured
  if (validTokens.length === 0) return null;

  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const token = header.slice("Bearer ".length);
  if (!verifyToken(token, validTokens)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return null;
}
