import {
  ACCOUNT_CODES,
  DEFAULT_CHART_OF_ACCOUNTS,
  findAccount,
  type Account,
} from "./chart-of-accounts";
import { isValidIsoDate } from "./dates";
import { Money } from "./money";
import type { PaymentAllocation } from "./payment-allocation";

export interface JournalLine {
  accountCode: string;
  debit: Money;
  credit: Money;
  /** Préstamo al que pertenece la línea, para llevar el saldo de cada uno. */
  loanId?: string;
}

/** Asiento contable: siempre cuadrado (débitos = créditos). Inmutable una vez creado. */
export interface JournalEntry {
  date: string;
  description: string;
  lines: readonly JournalLine[];
}

export class InvalidJournalEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJournalEntryError";
  }
}

export type PaymentMethod = "CASH" | "TRANSFER" | "DEPOSIT";

export function debitLine(accountCode: string, amount: Money, loanId?: string): JournalLine {
  return { accountCode, debit: amount, credit: Money.zero(), ...(loanId ? { loanId } : {}) };
}

export function creditLine(accountCode: string, amount: Money, loanId?: string): JournalLine {
  return { accountCode, debit: Money.zero(), credit: amount, ...(loanId ? { loanId } : {}) };
}

function fail(message: string): never {
  throw new InvalidJournalEntryError(message);
}

function validateLine(line: JournalLine, chart: readonly Account[]): void {
  findAccount(chart, line.accountCode);
  if (line.debit.isNegative() || line.credit.isNegative()) {
    fail("Los débitos y créditos no pueden ser negativos");
  }
  if (line.debit.isZero() === line.credit.isZero()) {
    fail("Cada línea debe tener un monto en el débito o en el crédito, pero no en ambos");
  }
}

/** Crea un asiento validado: fecha real, descripción, cuentas existentes y débitos iguales a créditos. */
export function createJournalEntry(
  entry: JournalEntry,
  chart: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): JournalEntry {
  if (!isValidIsoDate(entry.date)) {
    fail("La fecha del asiento debe tener el formato AAAA-MM-DD");
  }
  if (entry.description.trim() === "") {
    fail("El asiento necesita una descripción");
  }
  if (entry.lines.length < 2) {
    fail("Un asiento necesita al menos dos líneas");
  }
  entry.lines.forEach((line) => validateLine(line, chart));

  const debits = entry.lines.reduce((sum, line) => sum.add(line.debit), Money.zero());
  const credits = entry.lines.reduce((sum, line) => sum.add(line.credit), Money.zero());
  if (!debits.equals(credits)) {
    fail("El asiento no cuadra: los débitos deben ser iguales a los créditos");
  }
  return { date: entry.date, description: entry.description.trim(), lines: [...entry.lines] };
}

function cashOrBankAccount(method: PaymentMethod): string {
  return method === "CASH" ? ACCOUNT_CODES.CASH : ACCOUNT_CODES.BANK;
}

export interface DisbursementInput {
  date: string;
  loanId: string;
  principal: Money;
  method: PaymentMethod;
}

/** Desembolso: sale dinero de caja o bancos y entra a la cartera de préstamos. */
export function disbursementEntry(input: DisbursementInput): JournalEntry {
  return createJournalEntry({
    date: input.date,
    description: `Desembolso del préstamo ${input.loanId}`,
    lines: [
      debitLine(ACCOUNT_CODES.LOAN_PORTFOLIO, input.principal, input.loanId),
      creditLine(cashOrBankAccount(input.method), input.principal, input.loanId),
    ],
  });
}

export interface PaymentEntryInput {
  date: string;
  loanId: string;
  method: PaymentMethod;
  principal: Money;
  interest: Money;
  lateFee: Money;
}

/**
 * Pago recibido: entra dinero a caja o bancos; el capital baja la cartera y el
 * interés y la mora son ingresos (base de efectivo). Omite los componentes en cero.
 */
export function paymentEntry(input: PaymentEntryInput): JournalEntry {
  const total = input.principal.add(input.interest).add(input.lateFee);
  const components: [string, Money][] = [
    [ACCOUNT_CODES.LOAN_PORTFOLIO, input.principal],
    [ACCOUNT_CODES.INTEREST_INCOME, input.interest],
    [ACCOUNT_CODES.LATE_FEE_INCOME, input.lateFee],
  ];
  return createJournalEntry({
    date: input.date,
    description: `Pago del préstamo ${input.loanId}`,
    lines: [
      debitLine(cashOrBankAccount(input.method), total, input.loanId),
      ...components
        .filter(([, amount]) => !amount.isZero())
        .map(([code, amount]) => creditLine(code, amount, input.loanId)),
    ],
  });
}

export interface AllocationsPaymentInput {
  date: string;
  loanId: string;
  method: PaymentMethod;
  allocations: readonly PaymentAllocation[];
}

/** Asiento de un pago ya repartido entre cuotas por `allocatePayment`. */
export function paymentEntryFromAllocations(input: AllocationsPaymentInput): JournalEntry {
  const sum = (pick: (allocation: PaymentAllocation) => Money) =>
    input.allocations.reduce((total, allocation) => total.add(pick(allocation)), Money.zero());
  return paymentEntry({
    date: input.date,
    loanId: input.loanId,
    method: input.method,
    principal: sum((allocation) => allocation.principal),
    interest: sum((allocation) => allocation.interest),
    lateFee: sum((allocation) => allocation.lateFee),
  });
}

export interface WriteOffInput {
  date: string;
  loanId: string;
  /** Capital que queda sin cobrar y se reconoce como pérdida. */
  principal: Money;
}

/** Castigo de un préstamo incobrable: el capital pendiente sale de la cartera y se registra como pérdida. */
export function writeOffEntry(input: WriteOffInput): JournalEntry {
  return createJournalEntry({
    date: input.date,
    description: `Castigo del préstamo ${input.loanId}`,
    lines: [
      debitLine(ACCOUNT_CODES.BAD_DEBT_EXPENSE, input.principal, input.loanId),
      creditLine(ACCOUNT_CODES.LOAN_PORTFOLIO, input.principal, input.loanId),
    ],
  });
}

export interface CapitalMovementInput {
  date: string;
  amount: Money;
  method: PaymentMethod;
}

/** Aporte de capital del propietario al negocio. */
export function capitalContributionEntry(input: CapitalMovementInput): JournalEntry {
  return createJournalEntry({
    date: input.date,
    description: "Aporte de capital del propietario",
    lines: [
      debitLine(cashOrBankAccount(input.method), input.amount),
      creditLine(ACCOUNT_CODES.OWNER_CAPITAL, input.amount),
    ],
  });
}

/** Retiro de dinero del negocio por parte del propietario. */
export function capitalWithdrawalEntry(input: CapitalMovementInput): JournalEntry {
  return createJournalEntry({
    date: input.date,
    description: "Retiro del propietario",
    lines: [
      debitLine(ACCOUNT_CODES.OWNER_WITHDRAWALS, input.amount),
      creditLine(cashOrBankAccount(input.method), input.amount),
    ],
  });
}

/**
 * Los asientos no se editan ni se borran: un error se corrige con un reverso
 * que invierte débitos y créditos y deja constancia del motivo.
 */
export function reverseEntry(entry: JournalEntry, date: string, reason: string): JournalEntry {
  if (reason.trim() === "") {
    fail("Un reverso necesita el motivo de la corrección");
  }
  return createJournalEntry({
    date,
    description: `Reverso: ${entry.description} (${reason.trim()})`,
    lines: entry.lines.map((line) => ({
      ...line,
      debit: line.credit,
      credit: line.debit,
    })),
  });
}
