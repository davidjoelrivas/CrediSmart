import { Money, type JournalEntry } from "@app/domain";
import type { BorrowerRepository, BorrowerSearch } from "../../../modules/borrowers/application/ports";
import type { Borrower } from "../../../modules/borrowers/domain/borrower";
import type { OrganizationRepository, OrganizationSummary } from "../../../modules/organizations/application/ports";
import type { PrescreeningRepository, PublicOrganization, Submission } from "../../../modules/prescreening/application/ports";
import type { PrescreeningForm } from "@app/domain";
import type { LedgerRepository } from "../../../modules/accounting/application/ports";
import type { AuditLog, AuditRecord } from "../../../modules/audit/application/ports";
import type {
  PaymentRepository,
  ReceiptRepository,
  ReceiptSequence,
  VerificationCodeGenerator,
} from "../../../modules/collections/application/ports";
import type { Payment } from "../../../modules/collections/domain/payment";
import type { Receipt } from "../../../modules/collections/domain/receipt";
import type {
  LegalCapProvider,
  LoanCodeSequence,
  LoanRepository,
} from "../../../modules/lending/application/ports";
import type { Loan } from "../../../modules/lending/domain/loan";
import type { Clock, IdGenerator, UnitOfWork } from "../../application/ports";
import type { Repositories } from "../../application/repositories";

interface State {
  prescreeningForms: Map<string, PrescreeningForm>;
  submissions: Submission[];
  borrowers: Map<string, Borrower>;
  loans: Map<string, Loan>;
  ledger: { organizationId: string; entry: JournalEntry }[];
  audit: AuditRecord[];
  loanCounters: Map<string, number>;
  payments: Payment[];
  receipts: Receipt[];
  receiptCounters: Map<string, number>;
}

function emptyState(): State {
  return {
    prescreeningForms: new Map(),
    submissions: [],
    borrowers: new Map(),
    loans: new Map(),
    ledger: [],
    audit: [],
    loanCounters: new Map(),
    payments: [],
    receipts: [],
    receiptCounters: new Map(),
  };
}

function copyOf(state: State): State {
  return {
    prescreeningForms: new Map(state.prescreeningForms),
    submissions: [...state.submissions],
    borrowers: new Map(state.borrowers),
    loans: new Map(state.loans),
    ledger: [...state.ledger],
    audit: [...state.audit],
    loanCounters: new Map(state.loanCounters),
    payments: [...state.payments],
    receipts: [...state.receipts],
    receiptCounters: new Map(state.receiptCounters),
  };
}

/**
 * Base de datos en memoria para pruebas y desarrollo. Guarda solo valores
 * inmutables, así que una copia superficial alcanza para deshacer una transacción.
 */
export class InMemoryDatabase {
  state: State = emptyState();
  /** Enlaces públicos de las organizaciones (texto a id); no forman parte de las transacciones. */
  readonly slugs = new Map<string, string>();

  repositories(): Repositories {
    return {
      organizations: new InMemoryOrganizationRepository(),
      prescreening: new InMemoryPrescreeningRepository(this),
      borrowers: new InMemoryBorrowerRepository(this),
      loans: new InMemoryLoanRepository(this),
      loanCodes: new InMemoryLoanCodeSequence(this),
      payments: new InMemoryPaymentRepository(this),
      receipts: new InMemoryReceiptRepository(this),
      receiptSequence: new InMemoryReceiptSequence(this),
      ledger: new InMemoryLedgerRepository(this),
      audit: new InMemoryAuditLog(this),
    };
  }
}

export class InMemoryUnitOfWork implements UnitOfWork<Repositories> {
  constructor(private readonly database: InMemoryDatabase) {}

  async run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T> {
    const snapshot = copyOf(this.database.state);
    try {
      return await work(this.database.repositories());
    } catch (error) {
      this.database.state = snapshot;
      throw error;
    }
  }
}

class InMemoryOrganizationRepository implements OrganizationRepository {
  async findById(id: string): Promise<OrganizationSummary | null> {
    return { id, name: "Crédito de prueba" };
  }

  async listIds(): Promise<string[]> {
    return [];
  }
}

class InMemoryPrescreeningRepository implements PrescreeningRepository {
  constructor(private readonly database: InMemoryDatabase) {}

  async findOrganizationBySlug(slug: string): Promise<PublicOrganization | null> {
    const id = this.database.slugs.get(slug);
    return id ? { id, name: "Crédito de prueba" } : null;
  }

  async slugOf(organizationId: string): Promise<string | null> {
    for (const [slug, id] of this.database.slugs) {
      if (id === organizationId) return slug;
    }
    return null;
  }

  async getForm(organizationId: string): Promise<PrescreeningForm | null> {
    return this.database.state.prescreeningForms.get(organizationId) ?? null;
  }

  async saveForm(organizationId: string, form: PrescreeningForm): Promise<void> {
    this.database.state.prescreeningForms.set(organizationId, form);
  }

  async saveSubmission(submission: Submission): Promise<void> {
    this.database.state.submissions.push(submission);
  }

  async findSubmission(organizationId: string, id: string): Promise<Submission | null> {
    return this.database.state.submissions.find((item) => item.organizationId === organizationId && item.id === id) ?? null;
  }

  async listSubmissions(organizationId: string, filter: { status?: "NEW" | "DECIDED" }): Promise<Submission[]> {
    return this.database.state.submissions
      .filter((item) => item.organizationId === organizationId && (!filter.status || item.status === filter.status))
      .slice()
      .reverse();
  }

  async recordDecision(
    organizationId: string,
    id: string,
    decision: { decision: "CONTINUE" | "DISCARD"; note: string | null; decidedBy: string; decidedOn: string; contradictsOutcome: boolean },
  ): Promise<void> {
    this.database.state.submissions = this.database.state.submissions.map((item) =>
      item.organizationId === organizationId && item.id === id
        ? {
            ...item,
            status: "DECIDED",
            decision: decision.decision,
            decisionNote: decision.note,
            decidedBy: decision.decidedBy,
            decidedOn: decision.decidedOn,
            contradictsOutcome: decision.contradictsOutcome,
          }
        : item,
    );
  }
}

class InMemoryBorrowerRepository implements BorrowerRepository {
  constructor(private readonly database: InMemoryDatabase) {}

  async save(borrower: Borrower): Promise<void> {
    this.database.state.borrowers.set(`${borrower.organizationId}:${borrower.id}`, borrower);
  }

  private ofOrganization(organizationId: string): Borrower[] {
    return [...this.database.state.borrowers.values()].filter(
      (borrower) => borrower.organizationId === organizationId,
    );
  }

  async findById(organizationId: string, id: string): Promise<Borrower | null> {
    return this.database.state.borrowers.get(`${organizationId}:${id}`) ?? null;
  }

  async findByNationalId(organizationId: string, nationalId: string): Promise<Borrower | null> {
    return this.ofOrganization(organizationId).find((borrower) => borrower.nationalId === nationalId) ?? null;
  }

  async namesByIds(organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
    return new Map(
      this.ofOrganization(organizationId)
        .filter((borrower) => ids.includes(borrower.id))
        .map((borrower) => [borrower.id, borrower.fullName]),
    );
  }

  async search(organizationId: string, search: BorrowerSearch): Promise<Borrower[]> {
    const text = search.text?.toLowerCase();
    return this.ofOrganization(organizationId)
      .filter(
        (borrower) =>
          !text || borrower.fullName.toLowerCase().includes(text) || (borrower.phone ?? "").includes(text),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(search.offset, search.offset + search.limit);
  }
}

const loanKey = (organizationId: string, id: string) => `${organizationId}:${id}`;

class InMemoryLoanRepository implements LoanRepository {
  constructor(private readonly database: InMemoryDatabase) {}

  async save(loan: Loan): Promise<void> {
    this.database.state.loans.set(loanKey(loan.organizationId, loan.id), loan);
  }

  async findById(organizationId: string, id: string): Promise<Loan | null> {
    return this.database.state.loans.get(loanKey(organizationId, id)) ?? null;
  }

  async listByOrganization(organizationId: string): Promise<Loan[]> {
    return [...this.database.state.loans.values()].filter(
      (loan) => loan.organizationId === organizationId,
    );
  }
}

class InMemoryLoanCodeSequence implements LoanCodeSequence {
  constructor(private readonly database: InMemoryDatabase) {}

  async next(organizationId: string): Promise<string> {
    const next = (this.database.state.loanCounters.get(organizationId) ?? 0) + 1;
    this.database.state.loanCounters.set(organizationId, next);
    return `PR-${String(next).padStart(4, "0")}`;
  }
}

class InMemoryPaymentRepository implements PaymentRepository {
  constructor(private readonly database: InMemoryDatabase) {}

  async save(payment: Payment): Promise<void> {
    this.database.state.payments.push(payment);
  }

  async findById(organizationId: string, id: string): Promise<Payment | null> {
    return (
      this.database.state.payments.find(
        (payment) => payment.organizationId === organizationId && payment.id === id,
      ) ?? null
    );
  }

  async findByIdempotencyKey(organizationId: string, key: string): Promise<Payment | null> {
    return (
      this.database.state.payments.find(
        (payment) => payment.organizationId === organizationId && payment.idempotencyKey === key,
      ) ?? null
    );
  }

  async findReversalOf(organizationId: string, paymentId: string): Promise<Payment | null> {
    return (
      this.database.state.payments.find(
        (payment) =>
          payment.organizationId === organizationId && payment.reversesPaymentId === paymentId,
      ) ?? null
    );
  }

  async listRecent(organizationId: string, limit: number): Promise<Payment[]> {
    return this.database.state.payments
      .filter((payment) => payment.organizationId === organizationId)
      .slice()
      .reverse()
      .slice(0, limit);
  }

  async netReceivedBetween(organizationId: string, from: string, to: string): Promise<Money> {
    return this.database.state.payments
      .filter(
        (payment) =>
          payment.organizationId === organizationId && payment.receivedOn >= from && payment.receivedOn <= to,
      )
      .reduce((sum, payment) => sum.add(payment.amount), Money.zero());
  }

  async listByLoan(organizationId: string, loanId: string): Promise<Payment[]> {
    return this.database.state.payments.filter(
      (payment) => payment.organizationId === organizationId && payment.loanId === loanId,
    );
  }
}

class InMemoryReceiptRepository implements ReceiptRepository {
  constructor(private readonly database: InMemoryDatabase) {}

  async save(receipt: Receipt): Promise<void> {
    this.database.state.receipts.push(receipt);
  }

  async findByPaymentId(organizationId: string, paymentId: string): Promise<Receipt | null> {
    return (
      this.database.state.receipts.find(
        (receipt) => receipt.organizationId === organizationId && receipt.paymentId === paymentId,
      ) ?? null
    );
  }

  async findByVerificationCode(code: string): Promise<Receipt | null> {
    return this.database.state.receipts.find((receipt) => receipt.verificationCode === code) ?? null;
  }
}

class InMemoryReceiptSequence implements ReceiptSequence {
  constructor(private readonly database: InMemoryDatabase) {}

  async next(organizationId: string): Promise<number> {
    const next = (this.database.state.receiptCounters.get(organizationId) ?? 0) + 1;
    this.database.state.receiptCounters.set(organizationId, next);
    return next;
  }
}

class InMemoryLedgerRepository implements LedgerRepository {
  constructor(private readonly database: InMemoryDatabase) {}

  async append(organizationId: string, entry: JournalEntry): Promise<void> {
    this.database.state.ledger.push({ organizationId, entry });
  }

  async entriesOf(organizationId: string): Promise<JournalEntry[]> {
    return this.database.state.ledger
      .filter((item) => item.organizationId === organizationId)
      .map((item) => item.entry);
  }
}

class InMemoryAuditLog implements AuditLog {
  constructor(private readonly database: InMemoryDatabase) {}

  async record(entry: AuditRecord): Promise<void> {
    this.database.state.audit.push(entry);
  }

  async recordsOf(organizationId: string): Promise<AuditRecord[]> {
    return this.database.state.audit.filter((item) => item.organizationId === organizationId);
  }
}

/** Reloj fijo: devuelve siempre la fecha indicada (se puede cambiar entre pasos de una prueba). */
export class FixedClock implements Clock {
  constructor(public date: string) {}

  today(): string {
    return this.date;
  }
}

export class SequentialIds implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = "id") {}

  newId(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}

export class StaticLegalCap implements LegalCapProvider {
  constructor(private readonly capBp: number | null = null) {}

  async aprCapBp(): Promise<number | null> {
    return this.capBp;
  }
}

/** Códigos de verificación predecibles para las pruebas: VERIF-000001, VERIF-000002… */
export class SequentialVerificationCodes implements VerificationCodeGenerator {
  private counter = 0;

  newCode(): string {
    this.counter += 1;
    return `VERIF-${String(this.counter).padStart(6, "0")}`;
  }
}
