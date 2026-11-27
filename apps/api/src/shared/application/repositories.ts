import type { LedgerRepository } from "../../modules/accounting/application/ports";
import type { AuditLog } from "../../modules/audit/application/ports";
import type {
  PaymentRepository,
  ReceiptRepository,
  ReceiptSequence,
} from "../../modules/collections/application/ports";
import type { LoanCodeSequence, LoanRepository } from "../../modules/lending/application/ports";

/** Repositorios que un caso de uso puede usar dentro de una misma transacción. */
export interface Repositories {
  loans: LoanRepository;
  loanCodes: LoanCodeSequence;
  payments: PaymentRepository;
  receipts: ReceiptRepository;
  receiptSequence: ReceiptSequence;
  ledger: LedgerRepository;
  audit: AuditLog;
}
