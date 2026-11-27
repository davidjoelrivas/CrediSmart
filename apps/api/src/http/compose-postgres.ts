import type { Pool } from "pg";
import {
  BorrowerQueries,
  CreateBorrower,
  UpdateBorrower,
} from "../modules/borrowers/application/borrower-use-cases";
import { PostgresAuditLog } from "../modules/audit/infrastructure/postgres/postgres-audit-log";
import { ReceiptQueries } from "../modules/collections/application/receipt-queries";
import { RegisterPayment } from "../modules/collections/application/register-payment";
import { ReversePayment } from "../modules/collections/application/reverse-payment";
import { AuthenticateSession } from "../modules/identity/application/authenticate-session";
import { CreateUser } from "../modules/identity/application/create-user";
import { Login } from "../modules/identity/application/login";
import { Logout } from "../modules/identity/application/logout";
import type { PasswordHasher } from "../modules/identity/application/ports";
import {
  PostgresSessionRepository,
  PostgresUserRepository,
} from "../modules/identity/infrastructure/postgres/postgres-identity-repositories";
import { ScryptPasswordHasher } from "../modules/identity/infrastructure/scrypt-password-hasher";
import { AccrueLateFees } from "../modules/lending/application/accrue-late-fees";
import { ApproveLoan } from "../modules/lending/application/approve-loan";
import { ContractQueries } from "../modules/lending/application/contract-queries";
import { DisburseLoan } from "../modules/lending/application/disburse-loan";
import { LoanQueries } from "../modules/lending/application/loan-queries";
import { SimulateLoan } from "../modules/lending/application/simulate-loan";
import { PostgresLegalCapProvider } from "../modules/lending/infrastructure/postgres/postgres-loan-support";
import {
  DecideSubmission,
  GetPublicForm,
  PrescreeningQueries,
  SaveFormTemplate,
  SubmitPrescreening,
} from "../modules/prescreening/application/prescreening-use-cases";
import { GetDashboard } from "../modules/reporting/application/get-dashboard";
import type { InstantClock } from "../shared/application/ports";
import type { FieldCipher } from "../shared/infrastructure/crypto/field-cipher";
import { RandomVerificationCodes } from "../shared/infrastructure/crypto/random-verification-codes";
import { PostgresDatabase } from "../shared/infrastructure/postgres/postgres-database";
import { UuidV7Generator } from "../shared/infrastructure/postgres/uuid";
import { SystemClock } from "../shared/infrastructure/system-clock";
import type { Services } from "./services";

export class SystemInstantClock implements InstantClock {
  now(): Date {
    return new Date();
  }
}

/** Arma el sistema real: todo contra PostgreSQL, con la hora y las llaves reales. */
export function composePostgresServices(
  pool: Pool,
  cipher: FieldCipher,
  options: { hasher?: PasswordHasher } = {},
): Services {
  const database = new PostgresDatabase(pool, cipher);
  const unitOfWork = database.unitOfWork();
  const repositories = database.repositories();
  const clock = new SystemClock();
  const instants = new SystemInstantClock();
  const ids = new UuidV7Generator();
  const legalCap = new PostgresLegalCapProvider(pool);
  const users = new PostgresUserRepository(pool);
  const sessions = new PostgresSessionRepository(pool);
  const hasher = options.hasher ?? new ScryptPasswordHasher();
  const audit = new PostgresAuditLog(pool);

  return {
    clock: instants,
    login: new Login({ users, sessions, hasher, clock: instants, ids }),
    logout: new Logout({ sessions, clock: instants }),
    authenticate: new AuthenticateSession({ users, sessions, clock: instants }),
    createUser: new CreateUser({ users, hasher, ids }),
    users,
    createBorrower: new CreateBorrower({ unitOfWork, clock, ids }),
    updateBorrower: new UpdateBorrower({ unitOfWork, clock }),
    borrowerQueries: new BorrowerQueries({ repositories }),
    simulateLoan: new SimulateLoan({ legalCap }),
    approveLoan: new ApproveLoan({ unitOfWork, clock, ids, legalCap }),
    disburseLoan: new DisburseLoan({ unitOfWork, clock }),
    loanQueries: new LoanQueries({ repositories, clock }),
    contractQueries: new ContractQueries({ unitOfWork, clock }),
    registerPayment: new RegisterPayment({
      unitOfWork,
      clock,
      ids,
      verificationCodes: new RandomVerificationCodes(),
    }),
    reversePayment: new ReversePayment({ unitOfWork, clock, ids }),
    receiptQueries: new ReceiptQueries({ repositories }),
    accrueLateFees: new AccrueLateFees({ unitOfWork, clock }),
    getDashboard: new GetDashboard({ repositories, clock }),
    auditReader: {
      async recent(organizationId, limit) {
        return (await audit.recordsOf(organizationId)).slice(-limit).reverse();
      },
      verify: (organizationId) => audit.verifyChain(organizationId),
    },
    organizations: repositories.organizations,
    getPublicForm: new GetPublicForm({ repositories }),
    submitPrescreening: new SubmitPrescreening({ unitOfWork, clock, ids }),
    prescreeningQueries: new PrescreeningQueries({ repositories }),
    decideSubmission: new DecideSubmission({ unitOfWork, clock }),
    saveFormTemplate: new SaveFormTemplate({ unitOfWork, clock }),
    async checkHealth() {
      await pool.query("SELECT 1");
    },
  };
}
