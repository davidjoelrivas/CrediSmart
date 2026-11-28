import { UnauthorizedError } from "../../../shared/application/errors";
import type { IdGenerator, InstantClock } from "../../../shared/application/ports";
import { InvalidUserError, parseLoginIdentifier, type LoginIdentifier, type User } from "../domain/user";
import { newSessionToken } from "./session-token";
import type { LockoutPolicy, PasswordHasher, SessionRepository, UserRepository } from "./ports";

export const DEFAULT_LOCKOUT: LockoutPolicy = { maxAttempts: 5, lockMinutes: 15 };
export const SESSION_HOURS = 12;

/** Mismo mensaje para "no existe" y "contraseña incorrecta": así no se averigua qué cuentas existen. */
const INVALID_CREDENTIALS = "Credenciales incorrectas";

export class AccountLockedError extends Error {
  constructor(readonly lockedUntil: Date) {
    super("Demasiados intentos fallidos. Intenta de nuevo más tarde.");
    this.name = "AccountLockedError";
  }
}

export interface LoginInput {
  /** Correo o teléfono. */
  login: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
}

export interface LoginResult {
  /** Token que se entrega en la cookie; no se guarda en ningún otro lado. */
  token: string;
  expiresAt: Date;
  user: User;
}

/**
 * Inicio de sesión: verifica la contraseña, bloquea la cuenta tras varios intentos fallidos y
 * crea la sesión. Tarda parecido exista o no el usuario, para no delatar qué cuentas existen.
 */
export class Login {
  constructor(
    private readonly deps: {
      users: UserRepository;
      sessions: SessionRepository;
      hasher: PasswordHasher;
      clock: InstantClock;
      ids: IdGenerator;
      lockout?: LockoutPolicy;
      sessionHours?: number;
    },
  ) {}

  async execute(input: LoginInput): Promise<LoginResult> {
    const lockout = this.deps.lockout ?? DEFAULT_LOCKOUT;
    const now = this.deps.clock.now();

    let identifier: LoginIdentifier;
    try {
      identifier = parseLoginIdentifier(input.login);
    } catch (error) {
      if (error instanceof InvalidUserError) {
        await this.deps.hasher.burn(input.password);
        throw new UnauthorizedError(INVALID_CREDENTIALS);
      }
      throw error;
    }

    const record = await this.deps.users.findByLogin(identifier);
    if (!record || record.status !== "ACTIVE") {
      await this.deps.hasher.burn(input.password);
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }
    if (record.lockedUntil && record.lockedUntil > now) {
      throw new AccountLockedError(record.lockedUntil);
    }

    const valid = await this.deps.hasher.verify(input.password, record.passwordHash);
    if (!valid) {
      const lockedUntil = await this.deps.users.registerFailedLogin(record.id, lockout, now);
      if (lockedUntil) {
        throw new AccountLockedError(lockedUntil);
      }
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    await this.deps.users.registerSuccessfulLogin(record.id, now);
    const { token, tokenHash } = newSessionToken();
    const expiresAt = new Date(now.getTime() + (this.deps.sessionHours ?? SESSION_HOURS) * 3_600_000);
    await this.deps.sessions.create(
      { id: this.deps.ids.newId(), userId: record.id, tokenHash, expiresAt, revokedAt: null },
      { userAgent: input.userAgent?.slice(0, 200) ?? null, ip: input.ip ?? null },
    );
    return {
      token,
      expiresAt,
      user: {
        id: record.id,
        organizationId: record.organizationId,
        role: record.role,
        fullName: record.fullName,
        email: record.email,
        phone: record.phone,
        borrowerId: record.borrowerId,
        status: record.status,
      },
    };
  }
}
