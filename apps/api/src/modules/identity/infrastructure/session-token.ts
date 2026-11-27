import { createHash, randomBytes } from "node:crypto";

/** Token de sesión: 32 bytes aleatorios. Solo se guarda su hash; el token viaja únicamente en la cookie. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
