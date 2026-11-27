import { UnauthorizedError } from "../../../shared/application/errors";
import type { InstantClock } from "../../../shared/application/ports";
import type { Role } from "../domain/user";
import { hashSessionToken } from "../infrastructure/session-token";
import type { SessionRepository, UserRepository } from "./ports";

/** La persona que hace una solicitud, ya verificada. */
export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  role: Role;
  fullName: string;
  borrowerId: string | null;
  sessionId: string;
}

/** Convierte el token de la cookie en la persona autenticada; falla si la sesión venció, se cerró o el usuario se desactivó. */
export class AuthenticateSession {
  constructor(
    private readonly deps: { users: UserRepository; sessions: SessionRepository; clock: InstantClock },
  ) {}

  async execute(token: string | undefined): Promise<AuthenticatedUser> {
    if (!token) {
      throw new UnauthorizedError();
    }
    const session = await this.deps.sessions.findByTokenHash(hashSessionToken(token));
    const now = this.deps.clock.now();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedError("Tu sesión venció. Inicia sesión de nuevo.");
    }
    const user = await this.deps.users.findById(session.userId);
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedError();
    }
    return {
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      fullName: user.fullName,
      borrowerId: user.borrowerId,
      sessionId: session.id,
    };
  }
}
