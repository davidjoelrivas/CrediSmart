import type { JournalEntry } from "@app/domain";
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

  repositories(): Repositories {
    return {
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
