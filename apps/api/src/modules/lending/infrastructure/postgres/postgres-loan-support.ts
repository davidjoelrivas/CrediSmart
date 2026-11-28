import type { LegalCapProvider, LoanCodeSequence } from "../../application/ports";
import { asNumber, selectRows, type Executor } from "../../../../shared/infrastructure/postgres/sql";

/**
 * Correlativo de préstamos por organización. Dentro de la transacción, la fila del contador
 * queda bloqueada hasta confirmar o deshacer: no se repiten códigos ni se saltan números.
 */
export class PostgresLoanCodeSequence implements LoanCodeSequence {
  constructor(private readonly db: Executor) {}

  async next(organizationId: string): Promise<string> {
    const [row] = await selectRows(
      this.db,
      `INSERT INTO loan_counters (organization_id, last_number) VALUES ($1, 1)
       ON CONFLICT (organization_id) DO UPDATE SET last_number = loan_counters.last_number + 1
       RETURNING last_number`,
      [organizationId],
    );
    return `PR-${String(asNumber(row!.last_number)).padStart(4, "0")}`;
  }
}

/** Tope legal de la tasa efectiva anual, configurado por organización. */
export class PostgresLegalCapProvider implements LegalCapProvider {
  constructor(private readonly db: Executor) {}

  async aprCapBp(organizationId: string): Promise<number | null> {
    const [row] = await selectRows(this.db, "SELECT legal_apr_cap_bp FROM organizations WHERE id = $1", [
      organizationId,
    ]);
    return row?.legal_apr_cap_bp === null || row?.legal_apr_cap_bp === undefined
      ? null
      : asNumber(row.legal_apr_cap_bp);
  }
}
