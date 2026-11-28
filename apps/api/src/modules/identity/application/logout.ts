import type { InstantClock } from "../../../shared/application/ports";
import { hashSessionToken } from "./session-token";
import type { SessionRepository } from "./ports";

/** Cierra la sesión: el token deja de servir aunque alguien lo hubiera copiado. */
export class Logout {
  constructor(private readonly deps: { sessions: SessionRepository; clock: InstantClock }) {}

  async execute(token: string | undefined): Promise<void> {
    if (!token) {
      return;
    }
    const session = await this.deps.sessions.findByTokenHash(hashSessionToken(token));
    if (session && !session.revokedAt) {
      await this.deps.sessions.revoke(session.id, this.deps.clock.now());
    }
  }
}
