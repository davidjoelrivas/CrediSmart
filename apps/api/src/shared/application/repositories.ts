import type { LedgerRepository } from "../../modules/accounting/application/ports";
import type { BorrowerRepository } from "../../modules/borrowers/application/ports";
import type { OrganizationRepository } from "../../modules/organizations/application/ports";
import type { PrescreeningRepository } from "../../modules/prescreening/application/ports";
import type { AuditLog } from "../../modules/audit/application/ports";
import type {
  PaymentRepository,
  ReceiptRepository,
  ReceiptSequence,
} from "../../modules/collections/application/ports";
import type { LoanCodeSequence, LoanRepository } from "../../modules/lending/application/ports";

/** Repositorios que un caso de uso puede usar dentro de una misma transacción. */
export interface Repositories {
  organizations: OrganizationRepository;
  prescreening: PrescreeningRepository;
  borrowers: BorrowerRepository;
  loans: LoanRepository;
  loanCodes: LoanCodeSequence;
  payments: PaymentRepository;
  receipts: ReceiptRepository;
  receiptSequence: ReceiptSequence;
  ledger: LedgerRepository;
  audit: AuditLog;
}
