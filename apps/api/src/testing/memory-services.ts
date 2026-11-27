import { ContractQueries } from "../modules/lending/application/contract-queries";
import {
  DecideSubmission,
  GetPublicForm,
  PrescreeningQueries,
  SaveFormTemplate,
  SubmitPrescreening,
} from "../modules/prescreening/application/prescreening-use-cases";
import { ReceiptQueries } from "../modules/collections/application/receipt-queries";
import { AuthenticateSession } from "../modules/identity/application/authenticate-session";
import { CreateUser } from "../modules/identity/application/create-user";
import { Login } from "../modules/identity/application/login";
import { Logout } from "../modules/identity/application/logout";
import {
  InMemorySessionRepository,
  InMemoryUserRepository,
  ManualInstantClock,
  PlainPasswordHasher,
} from "../modules/identity/infrastructure/memory/in-memory-identity";
import type { Services } from "../http/services";
import { UuidV7Generator } from "../shared/infrastructure/postgres/uuid";
import { createHarness } from "./harness";

/** El sistema completo en memoria: sirve para probar la API HTTP en milisegundos y sin base de datos. */
export function createMemoryServices(options: { today?: string; aprCapBp?: number | null } = {}) {
  const ids = new UuidV7Generator();
  const harness = createHarness({ ...options, ids });
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const instants = new ManualInstantClock();
  const hasher = new PlainPasswordHasher();

  const services: Services = {
    clock: instants,
    login: new Login({ users, sessions, hasher, clock: instants, ids }),
    logout: new Logout({ sessions, clock: instants }),
    authenticate: new AuthenticateSession({ users, sessions, clock: instants }),
    createUser: new CreateUser({ users, hasher, ids }),
    users,
    createBorrower: harness.createBorrower,
    updateBorrower: harness.updateBorrower,
    borrowerQueries: harness.borrowerQueries,
    simulateLoan: harness.simulateLoan,
    approveLoan: harness.approveLoan,
    disburseLoan: harness.disburseLoan,
    loanQueries: harness.loanQueries,
    contractQueries: new ContractQueries({ unitOfWork: harness.unitOfWork, clock: harness.clock }),
    registerPayment: harness.registerPayment,
    reversePayment: harness.reversePayment,
    receiptQueries: new ReceiptQueries({ repositories: harness.repositories }),
    accrueLateFees: harness.accrueLateFees,
    getDashboard: harness.getDashboard,
    auditReader: {
      recent: async (organizationId, limit) =>
        (await harness.repositories.audit.recordsOf(organizationId)).slice(-limit).reverse(),
      verify: async () => ({ valid: true }),
    },
    organizations: harness.repositories.organizations,
    getPublicForm: new GetPublicForm({ repositories: harness.repositories }),
    submitPrescreening: new SubmitPrescreening({ unitOfWork: harness.unitOfWork, clock: harness.clock, ids }),
    prescreeningQueries: new PrescreeningQueries({ repositories: harness.repositories }),
    decideSubmission: new DecideSubmission({ unitOfWork: harness.unitOfWork, clock: harness.clock }),
    saveFormTemplate: new SaveFormTemplate({ unitOfWork: harness.unitOfWork, clock: harness.clock }),
    checkHealth: async () => undefined,
  };
  return { services, harness, users, sessions, instants };
}
