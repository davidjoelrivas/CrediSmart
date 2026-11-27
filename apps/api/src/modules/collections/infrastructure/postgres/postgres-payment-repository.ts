import { Money, type PaymentAllocation, type PaymentMethod } from "@app/domain";
import type { PaymentRepository } from "../../application/ports";
import type { Payment } from "../../domain/payment";
import {
  asNullableString,
  asNumber,
  asString,
  runStatement,
  selectRows,
  type Executor,
  type Row,
} from "../../../../shared/infrastructure/postgres/sql";

const PAYMENT_COLUMNS = `id, organization_id, loan_id, amount, method, reference, received_on, received_by,
  idempotency_key, reverses_payment_id, reversal_reason`;

function paymentOf(row: Row, allocations: PaymentAllocation[]): Payment {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    loanId: asString(row.loan_id),
    amount: Money.fromCents(asNumber(row.amount)),
    method: asString(row.method) as PaymentMethod,
    reference: asNullableString(row.reference),
    receivedOn: asString(row.received_on),
    receivedBy: asString(row.received_by),
    idempotencyKey: asString(row.idempotency_key),
    allocations,
    reversesPaymentId: asNullableString(row.reverses_payment_id),
    reversalReason: asNullableString(row.reversal_reason),
  };
}

/** Pagos en Postgres. Son inmutables: la base de datos rechaza cualquier UPDATE o DELETE. */
export class PostgresPaymentRepository implements PaymentRepository {
  constructor(private readonly db: Executor) {}

  async save(payment: Payment): Promise<void> {
    await runStatement(
      this.db,
      `INSERT INTO payments (${PAYMENT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        payment.id,
        payment.organizationId,
        payment.loanId,
        payment.amount.toCents(),
        payment.method,
        payment.reference,
        payment.receivedOn,
        payment.receivedBy,
        payment.idempotencyKey,
        payment.reversesPaymentId,
        payment.reversalReason,
      ],
    );
    for (const allocation of payment.allocations) {
      await runStatement(
        this.db,
        `INSERT INTO payment_allocations (payment_id, installment_number, late_fee, interest, principal)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          payment.id,
          allocation.installmentNumber,
          allocation.lateFee.toCents(),
          allocation.interest.toCents(),
          allocation.principal.toCents(),
        ],
      );
    }
  }

  async findById(organizationId: string, id: string): Promise<Payment | null> {
    return this.findOne("organization_id = $1 AND id = $2", [organizationId, id]);
  }

  async findByIdempotencyKey(organizationId: string, key: string): Promise<Payment | null> {
    return this.findOne("organization_id = $1 AND idempotency_key = $2", [organizationId, key]);
  }

  async findReversalOf(organizationId: string, paymentId: string): Promise<Payment | null> {
    return this.findOne("organization_id = $1 AND reverses_payment_id = $2", [organizationId, paymentId]);
  }

  async listByLoan(organizationId: string, loanId: string): Promise<Payment[]> {
    const rows = await selectRows(
      this.db,
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE organization_id = $1 AND loan_id = $2
       ORDER BY created_at, id`,
      [organizationId, loanId],
    );
    return Promise.all(rows.map(async (row) => paymentOf(row, await this.allocationsOf(asString(row.id)))));
  }

  private async findOne(condition: string, params: unknown[]): Promise<Payment | null> {
    const [row] = await selectRows(this.db, `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE ${condition}`, params);
    return row ? paymentOf(row, await this.allocationsOf(asString(row.id))) : null;
  }

  private async allocationsOf(paymentId: string): Promise<PaymentAllocation[]> {
    const rows = await selectRows(
      this.db,
      `SELECT installment_number, late_fee, interest, principal FROM payment_allocations
       WHERE payment_id = $1 ORDER BY installment_number`,
      [paymentId],
    );
    return rows.map((row) => ({
      installmentNumber: asNumber(row.installment_number),
      lateFee: Money.fromCents(asNumber(row.late_fee)),
      interest: Money.fromCents(asNumber(row.interest)),
      principal: Money.fromCents(asNumber(row.principal)),
    }));
  }
}
