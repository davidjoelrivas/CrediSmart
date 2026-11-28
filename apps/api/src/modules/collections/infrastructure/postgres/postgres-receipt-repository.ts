import type { ReceiptRepository, ReceiptSequence } from "../../application/ports";
import type { Receipt } from "../../domain/receipt";
import {
  asNumber,
  asString,
  runStatement,
  selectRows,
  type Executor,
  type Row,
} from "../../../../shared/infrastructure/postgres/sql";

const RECEIPT_COLUMNS = "id, organization_id, payment_id, folio, verification_code, issued_on";

function receiptOf(row: Row): Receipt {
  return {
    id: asString(row.id),
    organizationId: asString(row.organization_id),
    paymentId: asString(row.payment_id),
    folio: asNumber(row.folio),
    verificationCode: asString(row.verification_code),
    issuedOn: asString(row.issued_on),
  };
}

export class PostgresReceiptRepository implements ReceiptRepository {
  constructor(private readonly db: Executor) {}

  async save(receipt: Receipt): Promise<void> {
    await runStatement(
      this.db,
      `INSERT INTO receipts (${RECEIPT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        receipt.id,
        receipt.organizationId,
        receipt.paymentId,
        receipt.folio,
        receipt.verificationCode,
        receipt.issuedOn,
      ],
    );
  }

  async findByPaymentId(organizationId: string, paymentId: string): Promise<Receipt | null> {
    const [row] = await selectRows(
      this.db,
      `SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE organization_id = $1 AND payment_id = $2`,
      [organizationId, paymentId],
    );
    return row ? receiptOf(row) : null;
  }

  async findByVerificationCode(code: string): Promise<Receipt | null> {
    const [row] = await selectRows(
      this.db,
      `SELECT ${RECEIPT_COLUMNS} FROM receipts WHERE verification_code = $1`,
      [code],
    );
    return row ? receiptOf(row) : null;
  }
}

/** Correlativo de recibos por organización: sin repetidos ni saltos, aun con pagos simultáneos. */
export class PostgresReceiptSequence implements ReceiptSequence {
  constructor(private readonly db: Executor) {}

  async next(organizationId: string): Promise<number> {
    const [row] = await selectRows(
      this.db,
      `INSERT INTO receipt_counters (organization_id, last_number) VALUES ($1, 1)
       ON CONFLICT (organization_id) DO UPDATE SET last_number = receipt_counters.last_number + 1
       RETURNING last_number`,
      [organizationId],
    );
    return asNumber(row!.last_number);
  }
}
