import type { LoginIdentifier, Session, User, UserRecord } from "../domain/user";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  /** Hace el mismo trabajo que una verificación real; se usa cuando el usuario no existe, para no delatarlo por el tiempo de respuesta. */
  burn(password: string): Promise<void>;
}

export interface LockoutPolicy {
  maxAttempts: number;
  lockMinutes: number;
}

export class DuplicateUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateUserError";
  }
}

export interface UserRepository {
  create(record: UserRecord): Promise<void>;
  findById(id: string): Promise<UserRecord | null>;
  findByLogin(login: LoginIdentifier): Promise<UserRecord | null>;
  listByOrganization(organizationId: string): Promise<User[]>;
  /** Suma un intento fallido; al llegar al máximo bloquea la cuenta y devuelve hasta cuándo (null si no se bloqueó). */
  registerFailedLogin(userId: string, policy: LockoutPolicy, now: Date): Promise<Date | null>;
  registerSuccessfulLogin(userId: string, now: Date): Promise<void>;
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;
  setStatus(userId: string, status: User["status"]): Promise<void>;
}

export interface SessionRepository {
  create(session: Session, meta: { userAgent: string | null; ip: string | null }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  revoke(sessionId: string, now: Date): Promise<void>;
  revokeAllOfUser(userId: string, now: Date): Promise<void>;
}
