import {
  asNullableString,
  asNumber,
  asString,
  runStatement,
  selectRows,
  type Executor,
  type Row,
} from "../../../../shared/infrastructure/postgres/sql";
import {
  DuplicateUserError,
  type LockoutPolicy,
  type SessionRepository,
  type UserRepository,
} from "../../application/ports";
import type { LoginIdentifier, Role, Session, User, UserRecord, UserStatus } from "../../domain/user";

const USER_COLUMNS = `id, organization_id, role, full_name, email, phone, password_hash, borrower_id,
  status, failed_logins, locked_until`;

function userOf(row: Row): UserRecord {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    role: asString(row.role) as Role,
    fullName: asString(row.full_name),
    email: asNullableString(row.email),
    phone: asNullableString(row.phone),
    borrowerId: asNullableString(row.borrower_id),
    status: asString(row.status) as UserStatus,
    passwordHash: asString(row.password_hash),
    failedLogins: asNumber(row.failed_logins),
    lockedUntil: row.locked_until ? new Date(row.locked_until as string | Date) : null,
  };
}

/** Código de Postgres para "ya existe" (violación de una restricción UNIQUE). */
const UNIQUE_VIOLATION = "23505";

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: Executor) {}

  async create(record: UserRecord): Promise<void> {
    try {
      await runStatement(
        this.db,
        `INSERT INTO users (id, organization_id, role, full_name, email, phone, password_hash, borrower_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.id,
          record.organizationId,
          record.role,
          record.fullName,
          record.email,
          record.phone,
          record.passwordHash,
          record.borrowerId,
          record.status,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        const constraint = (error as { constraint?: string }).constraint ?? "";
        throw new DuplicateUserError(
          constraint.includes("phone")
            ? "Ya existe una cuenta con ese teléfono"
            : "Ya existe una cuenta con ese correo",
        );
      }
      throw error;
    }
  }

  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await selectRows(this.db, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return row ? userOf(row) : null;
  }

  async findByLogin(login: LoginIdentifier): Promise<UserRecord | null> {
    const [row] =
      "email" in login
        ? await selectRows(this.db, `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = $1`, [login.email])
        : await selectRows(this.db, `SELECT ${USER_COLUMNS} FROM users WHERE phone = $1`, [login.phone]);
    return row ? userOf(row) : null;
  }

  async listByOrganization(organizationId: string): Promise<User[]> {
    const rows = await selectRows(
      this.db,
      `SELECT ${USER_COLUMNS} FROM users WHERE organization_id = $1 ORDER BY created_at`,
      [organizationId],
    );
    return rows.map((row) => {
      const { passwordHash: _hash, failedLogins: _failed, lockedUntil: _locked, ...user } = userOf(row);
      return user;
    });
  }

  async registerFailedLogin(userId: string, policy: LockoutPolicy, now: Date): Promise<Date | null> {
    // Todo en una sola sentencia: dos intentos simultáneos no se pisan el contador.
    const lockUntil = new Date(now.getTime() + policy.lockMinutes * 60_000);
    const [row] = await selectRows(
      this.db,
      `UPDATE users
         SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
             locked_until  = CASE WHEN failed_logins + 1 >= $2 THEN $3::timestamptz ELSE locked_until END
       WHERE id = $1
       RETURNING failed_logins, locked_until`,
      [userId, policy.maxAttempts, lockUntil.toISOString()],
    );
    // Si el contador volvió a 0 es porque se acaba de bloquear la cuenta.
    return row && asNumber(row.failed_logins) === 0 ? new Date(row.locked_until as string | Date) : null;
  }

  async registerSuccessfulLogin(userId: string, now: Date): Promise<void> {
    await runStatement(
      this.db,
      "UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = $2 WHERE id = $1",
      [userId, now.toISOString()],
    );
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await runStatement(
      this.db,
      "UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1",
      [userId, passwordHash],
    );
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    await runStatement(this.db, "UPDATE users SET status = $2 WHERE id = $1", [userId, status]);
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: Executor) {}

  async create(
    session: Session,
    meta: { userAgent: string | null; ip: string | null },
  ): Promise<void> {
    await runStatement(
      this.db,
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.id, session.userId, session.tokenHash, session.expiresAt.toISOString(), meta.userAgent, meta.ip],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const [row] = await selectRows(
      this.db,
      "SELECT id, user_id, token_hash, expires_at, revoked_at FROM sessions WHERE token_hash = $1",
      [tokenHash],
    );
    if (!row) {
      return null;
    }
    return {
      id: asString(row.id),
      userId: asString(row.user_id),
      tokenHash: asString(row.token_hash),
      expiresAt: new Date(row.expires_at as string | Date),
      revokedAt: row.revoked_at ? new Date(row.revoked_at as string | Date) : null,
    };
  }

  async revoke(sessionId: string, now: Date): Promise<void> {
    await runStatement(
      this.db,
      "UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
      [sessionId, now.toISOString()],
    );
  }

  async revokeAllOfUser(userId: string, now: Date): Promise<void> {
    await runStatement(
      this.db,
      "UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
      [userId, now.toISOString()],
    );
  }
}
