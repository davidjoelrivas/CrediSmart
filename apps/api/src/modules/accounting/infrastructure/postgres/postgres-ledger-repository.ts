import { Money, type JournalEntry, type JournalLine } from "@app/domain";
import type { LedgerRepository } from "../../application/ports";
import {
  asNumber,
  asString,
  runStatement,
  selectRows,
  type Executor,
} from "../../../../shared/infrastructure/postgres/sql";

/**
 * Libro diario: solo se agregan asientos (los triggers impiden editarlos o borrarlos) y la
 * base de datos rechaza al confirmar cualquier asiento cuyos débitos no igualen a sus créditos.
 */
export class PostgresLedgerRepository implements LedgerRepository {
  constructor(private readonly db: Executor) {}

  async append(organizationId: string, entry: JournalEntry): Promise<void> {
    const [header] = await selectRows(
      this.db,
      `INSERT INTO journal_entries (organization_id, entry_date, description)
       VALUES ($1, $2, $3) RETURNING id`,
      [organizationId, entry.date, entry.description],
    );
    for (const [index, line] of entry.lines.entries()) {
      await runStatement(
        this.db,
        `INSERT INTO journal_lines (entry_id, line_number, account_code, debit, credit, loan_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          header!.id,
          index + 1,
          line.accountCode,
          line.debit.toCents(),
          line.credit.toCents(),
          line.loanId ?? null,
        ],
      );
    }
  }

  async entriesOf(organizationId: string): Promise<JournalEntry[]> {
    const rows = await selectRows(
      this.db,
      `SELECT e.id, e.entry_date, e.description, l.account_code, l.debit, l.credit, l.loan_id
       FROM journal_entries e
       JOIN journal_lines l ON l.entry_id = e.id
       WHERE e.organization_id = $1
       ORDER BY e.id, l.line_number`,
      [organizationId],
    );

    const entries = new Map<number, { date: string; description: string; lines: JournalLine[] }>();
    for (const row of rows) {
      const id = asNumber(row.id);
      const entry = entries.get(id) ?? {
        date: asString(row.entry_date),
        description: asString(row.description),
        lines: [],
      };
      entry.lines.push({
        accountCode: asString(row.account_code),
        debit: Money.fromCents(asNumber(row.debit)),
        credit: Money.fromCents(asNumber(row.credit)),
        ...(row.loan_id ? { loanId: asString(row.loan_id) } : {}),
      });
      entries.set(id, entry);
    }
    return [...entries.values()];
  }
}
