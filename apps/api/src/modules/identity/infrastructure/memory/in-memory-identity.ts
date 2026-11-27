import type { InstantClock } from "../../../../shared/application/ports";
import {
  DuplicateUserError,
  type LockoutPolicy,
  type PasswordHasher,
  type SessionRepository,
  type UserRepository,
} from "../../application/ports";
import type { LoginIdentifier, Session, User, UserRecord } from "../../domain/user";

/** Usuarios en memoria, para pruebas. */
export class InMemoryUserRepository implements UserRepository {
  readonly records = new Map<string, UserRecord>();

  async create(record: UserRecord): Promise<void> {
    for (const other of this.records.values()) {
      if (record.email && other.email === record.email) {
        throw new DuplicateUserError("Ya existe una cuenta con ese correo");
      }
      if (record.phone && other.phone === record.phone) {
        throw new DuplicateUserError("Ya existe una cuenta con ese teléfono");
      }
    }
    this.records.set(record.id, record);
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.records.get(id) ?? null;
  }

  async findByLogin(login: LoginIdentifier): Promise<UserRecord | null> {
    for (const record of this.records.values()) {
      if ("email" in login ? record.email === login.email : record.phone === login.phone) {
        return record;
      }
    }
    return null;
  }

  async listByOrganization(organizationId: string): Promise<User[]> {
    return [...this.records.values()].filter((record) => record.organizationId === organizationId);
  }

  async registerFailedLogin(userId: string, policy: LockoutPolicy, now: Date): Promise<Date | null> {
    const record = this.records.get(userId)!;
    const failed = record.failedLogins + 1;
    if (failed >= policy.maxAttempts) {
      const lockedUntil = new Date(now.getTime() + policy.lockMinutes * 60_000);
      this.records.set(userId, { ...record, failedLogins: 0, lockedUntil });
      return lockedUntil;
    }
    this.records.set(userId, { ...record, failedLogins: failed });
    return null;
  }

  async registerSuccessfulLogin(userId: string): Promise<void> {
    const record = this.records.get(userId)!;
    this.records.set(userId, { ...record, failedLogins: 0, lockedUntil: null });
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const record = this.records.get(userId)!;
    this.records.set(userId, { ...record, passwordHash, failedLogins: 0, lockedUntil: null });
  }

  async setStatus(userId: string, status: User["status"]): Promise<void> {
    const record = this.records.get(userId)!;
    this.records.set(userId, { ...record, status });
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, Session>();

  async create(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    return [...this.sessions.values()].find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async revoke(sessionId: string, now: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && !session.revokedAt) {
      this.sessions.set(sessionId, { ...session, revokedAt: now });
    }
  }

  async revokeAllOfUser(userId: string, now: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        this.sessions.set(session.id, { ...session, revokedAt: now });
      }
    }
  }
}

/** Reloj de instantes que se puede adelantar a mano en las pruebas. */
export class ManualInstantClock implements InstantClock {
  constructor(private current = new Date("2026-12-01T15:00:00Z")) {}

  now(): Date {
    return this.current;
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }
}

/** Hash falso y rápido para pruebas que no están probando el hash en sí. */
export class PlainPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `plain:${password}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    return stored === `plain:${password}`;
  }

  async burn(): Promise<void> {
    // Sin trabajo extra: solo se usa en pruebas.
  }
}
