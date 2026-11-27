import {
  Money,
  type Frequency,
  type InstallmentBalance,
  type InterestMethod,
} from "@app/domain";
import type { LoanRepository } from "../../application/ports";
import type { Loan, LoanStatus } from "../../domain/loan";
import {
  asNullableString,
  asNumber,
  asString,
  runStatement,
  selectRows,
  type Executor,
  type Row,
} from "../../../../shared/infrastructure/postgres/sql";

const LOAN_COLUMNS = `id, organization_id, borrower_id, code, principal, rate_bp, rate_period, payment_frequency,
  installments_count, interest_method, start_date, apr_bp, apr_cap_override_reason, status,
  approved_on, disbursed_on, closed_on`;

function balanceOf(row: Row): InstallmentBalance {
  return {
    number: asNumber(row.number),
    dueDate: asString(row.due_date),
    principalDue: Money.fromCents(asNumber(row.principal_due)),
    interestDue: Money.fromCents(asNumber(row.interest_due)),
    lateFeeDue: Money.fromCents(asNumber(row.late_fee_due)),
    principalPaid: Money.fromCents(asNumber(row.principal_paid)),
    interestPaid: Money.fromCents(asNumber(row.interest_paid)),
    lateFeePaid: Money.fromCents(asNumber(row.late_fee_paid)),
  };
}

function loanOf(row: Row, balances: InstallmentBalance[]): Loan {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    borrowerId: asString(row.borrower_id),
    code: asString(row.code),
    terms: {
      principal: Money.fromCents(asNumber(row.principal)),
      rateBp: asNumber(row.rate_bp),
      ratePeriod: asString(row.rate_period) as Frequency,
      paymentFrequency: asString(row.payment_frequency) as Frequency,
      installments: asNumber(row.installments_count),
      interestMethod: asString(row.interest_method) as InterestMethod,
      startDate: asString(row.start_date),
    },
    aprBp: asNumber(row.apr_bp),
    aprCapOverrideReason: asNullableString(row.apr_cap_override_reason),
    status: asString(row.status) as LoanStatus,
    balances,
    approvedOn: asString(row.approved_on),
    disbursedOn: asNullableString(row.disbursed_on),
    closedOn: asNullableString(row.closed_on),
  };
}

/**
 * Préstamos en Postgres. Cuando se usa dentro de una transacción (`lockRows`), leer un préstamo
 * bloquea su fila (`FOR UPDATE`): dos pagos simultáneos sobre el mismo préstamo se atienden uno tras otro.
 */
export class PostgresLoanRepository implements LoanRepository {
  constructor(
    private readonly db: Executor,
    private readonly lockRows: boolean,
  ) {}

  async save(loan: Loan): Promise<void> {
    const terms = loan.terms;
    // Las condiciones pactadas no cambian: al volver a guardar solo se actualiza el estado.
    await runStatement(
      this.db,
      `INSERT INTO loans (${LOAN_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, disbursed_on = EXCLUDED.disbursed_on,
         closed_on = EXCLUDED.closed_on`,
      [
        loan.id,
        loan.organizationId,
        loan.borrowerId,
        loan.code,
        terms.principal.toCents(),
        terms.rateBp,
        terms.ratePeriod,
        terms.paymentFrequency,
        terms.installments,
        terms.interestMethod ?? "FLAT",
        terms.startDate,
        loan.aprBp,
        loan.aprCapOverrideReason,
        loan.status,
        loan.approvedOn,
        loan.disbursedOn,
        loan.closedOn,
      ],
    );

    for (const balance of loan.balances) {
      await runStatement(
        this.db,
        `INSERT INTO installments
           (loan_id, number, organization_id, due_date, principal_due, interest_due, late_fee_due,
            principal_paid, interest_paid, late_fee_paid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (loan_id, number) DO UPDATE SET late_fee_due = EXCLUDED.late_fee_due,
           principal_paid = EXCLUDED.principal_paid, interest_paid = EXCLUDED.interest_paid,
           late_fee_paid = EXCLUDED.late_fee_paid`,
        [
          loan.id,
          balance.number,
          loan.organizationId,
          balance.dueDate,
          balance.principalDue.toCents(),
          balance.interestDue.toCents(),
          balance.lateFeeDue.toCents(),
          balance.principalPaid.toCents(),
          balance.interestPaid.toCents(),
          balance.lateFeePaid.toCents(),
        ],
      );
    }
  }

  async findById(organizationId: string, id: string): Promise<Loan | null> {
    const lock = this.lockRows ? " FOR UPDATE" : "";
    const [row] = await selectRows(
      this.db,
      `SELECT ${LOAN_COLUMNS} FROM loans WHERE organization_id = $1 AND id = $2${lock}`,
      [organizationId, id],
    );
    if (!row) {
      return null;
    }
    const installments = await selectRows(
      this.db,
      `SELECT number, due_date, principal_due, interest_due, late_fee_due, principal_paid,
              interest_paid, late_fee_paid
       FROM installments WHERE loan_id = $1 ORDER BY number`,
      [id],
    );
    return loanOf(row, installments.map(balanceOf));
  }

  async listByOrganization(organizationId: string): Promise<Loan[]> {
    const loans = await selectRows(
      this.db,
      `SELECT ${LOAN_COLUMNS} FROM loans WHERE organization_id = $1 ORDER BY created_at, code`,
      [organizationId],
    );
    const installments = await selectRows(
      this.db,
      `SELECT loan_id, number, due_date, principal_due, interest_due, late_fee_due, principal_paid,
              interest_paid, late_fee_paid
       FROM installments WHERE organization_id = $1 ORDER BY loan_id, number`,
      [organizationId],
    );

    const byLoan = new Map<string, InstallmentBalance[]>();
    for (const row of installments) {
      const loanId = asString(row.loan_id);
      byLoan.set(loanId, [...(byLoan.get(loanId) ?? []), balanceOf(row)]);
    }
    return loans.map((row) => loanOf(row, byLoan.get(asString(row.id)) ?? []));
  }
}
