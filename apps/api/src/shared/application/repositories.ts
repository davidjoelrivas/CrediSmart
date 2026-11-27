import type { LedgerRepository } from "../../modules/accounting/application/ports";
import type { AuditLog } from "../../modules/audit/application/ports";
import type { LoanCodeSequence, LoanRepository } from "../../modules/lending/application/ports";

/** Repositorios que un caso de uso puede usar dentro de una misma transacción. */
export interface Repositories {
  loans: LoanRepository;
  loanCodes: LoanCodeSequence;
  ledger: LedgerRepository;
  audit: AuditLog;
}
