import type { Pool } from "pg";
import { PostgresLedgerRepository } from "../../../modules/accounting/infrastructure/postgres/postgres-ledger-repository";
import { PostgresAuditLog } from "../../../modules/audit/infrastructure/postgres/postgres-audit-log";
import { PostgresPaymentRepository } from "../../../modules/collections/infrastructure/postgres/postgres-payment-repository";
import {
  PostgresReceiptRepository,
  PostgresReceiptSequence,
} from "../../../modules/collections/infrastructure/postgres/postgres-receipt-repository";
import { PostgresLoanRepository } from "../../../modules/lending/infrastructure/postgres/postgres-loan-repository";
import { PostgresLoanCodeSequence } from "../../../modules/lending/infrastructure/postgres/postgres-loan-support";
import type { UnitOfWork } from "../../application/ports";
import type { Repositories } from "../../application/repositories";
import type { Executor } from "./sql";

/** Códigos de error de Postgres que se resuelven reintentando la transacción completa. */
const SERIALIZATION_FAILURE = "40001";
const DEADLOCK_DETECTED = "40P01";
const MAX_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === DEADLOCK_DETECTED || code === SERIALIZATION_FAILURE;
}

/** Conecta los puertos de la aplicación con PostgreSQL. */
export class PostgresDatabase {
  constructor(readonly pool: Pool) {}

  /** Repositorios para leer fuera de una transacción. */
  repositories(): Repositories {
    return this.repositoriesFor(this.pool, false);
  }

  unitOfWork(): UnitOfWork<Repositories> {
    return new PostgresUnitOfWork(this);
  }

  repositoriesFor(executor: Executor, lockRows: boolean): Repositories {
    return {
      loans: new PostgresLoanRepository(executor, lockRows),
      loanCodes: new PostgresLoanCodeSequence(executor),
      payments: new PostgresPaymentRepository(executor),
      receipts: new PostgresReceiptRepository(executor),
      receiptSequence: new PostgresReceiptSequence(executor),
      ledger: new PostgresLedgerRepository(executor),
      audit: new PostgresAuditLog(executor),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Transacción de Postgres: o se guarda todo o no se guarda nada. Si Postgres detecta un
 * interbloqueo, la operación completa se deshace y se reintenta.
 */
class PostgresUnitOfWork implements UnitOfWork<Repositories> {
  constructor(private readonly database: PostgresDatabase) {}

  async run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const client = await this.database.pool.connect();
      try {
        await client.query("BEGIN");
        // Límites solo para esta transacción: una consulta lenta o una transacción abandonada se cortan
        // solas y nunca dejan filas bloqueadas. (SET LOCAL funciona también con el pooler de Supabase.)
        await client.query("SET LOCAL statement_timeout = 30000");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = 60000");
        const result = await work(this.database.repositoriesFor(client, true));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (isRetryable(error) && attempt < MAX_ATTEMPTS) {
          continue;
        }
        throw error;
      } finally {
        client.release();
      }
    }
  }
}
