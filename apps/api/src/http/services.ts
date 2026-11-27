import type { AuditRecord } from "../modules/audit/application/ports";
import type { ChainVerification } from "../modules/audit/infrastructure/audit-chain";
import type {
  BorrowerQueries,
  CreateBorrower,
  UpdateBorrower,
} from "../modules/borrowers/application/borrower-use-cases";
import type { ReceiptQueries } from "../modules/collections/application/receipt-queries";
import type { RegisterPayment } from "../modules/collections/application/register-payment";
import type { ReversePayment } from "../modules/collections/application/reverse-payment";
import type { AuthenticateSession } from "../modules/identity/application/authenticate-session";
import type { CreateUser } from "../modules/identity/application/create-user";
import type { Login } from "../modules/identity/application/login";
import type { Logout } from "../modules/identity/application/logout";
import type { UserRepository } from "../modules/identity/application/ports";
import type { AccrueLateFees } from "../modules/lending/application/accrue-late-fees";
import type { ApproveLoan } from "../modules/lending/application/approve-loan";
import type { ContractQueries } from "../modules/lending/application/contract-queries";
import type { DisburseLoan } from "../modules/lending/application/disburse-loan";
import type { LoanQueries } from "../modules/lending/application/loan-queries";
import type { SimulateLoan } from "../modules/lending/application/simulate-loan";
import type {
  DecideSubmission,
  GetPublicForm,
  PrescreeningQueries,
  SaveFormTemplate,
  SubmitPrescreening,
} from "../modules/prescreening/application/prescreening-use-cases";
import type { OrganizationRepository } from "../modules/organizations/application/ports";
import type { GetDashboard } from "../modules/reporting/application/get-dashboard";
import type { InstantClock } from "../shared/application/ports";

/** Lectura de la bitácora y verificación de que nadie la alteró. */
export interface AuditReader {
  recent(organizationId: string, limit: number): Promise<AuditRecord[]>;
  verify(organizationId: string): Promise<ChainVerification>;
}

/**
 * Todo lo que la capa HTTP necesita del negocio. La API no sabe si detrás hay PostgreSQL o memoria:
 * en producción se arma con `composePostgresServices` y en las pruebas rápidas con memoria.
 */
export interface Services {
  clock: InstantClock;
  login: Login;
  logout: Logout;
  authenticate: AuthenticateSession;
  createUser: CreateUser;
  users: UserRepository;
  createBorrower: CreateBorrower;
  updateBorrower: UpdateBorrower;
  borrowerQueries: BorrowerQueries;
  simulateLoan: SimulateLoan;
  approveLoan: ApproveLoan;
  disburseLoan: DisburseLoan;
  loanQueries: LoanQueries;
  contractQueries: ContractQueries;
  registerPayment: RegisterPayment;
  reversePayment: ReversePayment;
  receiptQueries: ReceiptQueries;
  accrueLateFees: AccrueLateFees;
  getDashboard: GetDashboard;
  auditReader: AuditReader;
  organizations: OrganizationRepository;
  getPublicForm: GetPublicForm;
  submitPrescreening: SubmitPrescreening;
  prescreeningQueries: PrescreeningQueries;
  decideSubmission: DecideSubmission;
  saveFormTemplate: SaveFormTemplate;
  /** Lanza un error si la base de datos no responde. */
  checkHealth(): Promise<void>;
}
