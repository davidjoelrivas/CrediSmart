import { describe, expect, it } from "vitest";
import { ACCOUNT_CODES } from "./chart-of-accounts";
import {
  capitalContributionEntry,
  capitalWithdrawalEntry,
  createJournalEntry,
  creditLine,
  debitLine,
  disbursementEntry,
  InvalidJournalEntryError,
  paymentEntry,
  paymentEntryFromAllocations,
  reverseEntry,
  writeOffEntry,
  type JournalEntry,
} from "./journal-entry";
import { Money } from "./money";
import { createBalance } from "./installment-balance";
import { allocatePayment } from "./payment-allocation";
import { buildSchedule } from "./schedule";

const lempiras = (text: string) => Money.fromLempiras(text);

function totals(entry: JournalEntry) {
  return {
    debits: entry.lines.reduce((sum, line) => sum.add(line.debit), Money.zero()).toCents(),
    credits: entry.lines.reduce((sum, line) => sum.add(line.credit), Money.zero()).toCents(),
  };
}

const byAccount = (entry: JournalEntry, code: string) =>
  entry.lines.find((line) => line.accountCode === code);

describe("createJournalEntry: validaciones", () => {
  const valid = {
    date: "2026-12-01",
    description: "Prueba",
    lines: [debitLine(ACCOUNT_CODES.CASH, lempiras("100")), creditLine(ACCOUNT_CODES.OWNER_CAPITAL, lempiras("100"))],
  };

  it("acepta un asiento cuadrado", () => {
    expect(() => createJournalEntry(valid)).not.toThrow();
  });

  it("rechaza un asiento que no cuadra", () => {
    const entry = {
      ...valid,
      lines: [debitLine(ACCOUNT_CODES.CASH, lempiras("100")), creditLine(ACCOUNT_CODES.OWNER_CAPITAL, lempiras("99.99"))],
    };
    expect(() => createJournalEntry(entry)).toThrow(InvalidJournalEntryError);
  });

  it("rechaza fechas inválidas y descripciones vacías", () => {
    expect(() => createJournalEntry({ ...valid, date: "01/12/2026" })).toThrow(InvalidJournalEntryError);
    expect(() => createJournalEntry({ ...valid, description: "  " })).toThrow(InvalidJournalEntryError);
  });

  it("rechaza asientos con menos de dos líneas", () => {
    expect(() =>
      createJournalEntry({ ...valid, lines: [debitLine(ACCOUNT_CODES.CASH, lempiras("100"))] }),
    ).toThrow(InvalidJournalEntryError);
  });

  it("rechaza líneas con monto en ambos lados o sin monto", () => {
    const both = { accountCode: ACCOUNT_CODES.CASH, debit: lempiras("1"), credit: lempiras("1") };
    const none = { accountCode: ACCOUNT_CODES.CASH, debit: Money.zero(), credit: Money.zero() };
    expect(() => createJournalEntry({ ...valid, lines: [both, creditLine(ACCOUNT_CODES.OWNER_CAPITAL, Money.zero())] })).toThrow(
      InvalidJournalEntryError,
    );
    expect(() => createJournalEntry({ ...valid, lines: [none, none] })).toThrow(InvalidJournalEntryError);
  });

  it("rechaza montos negativos y cuentas que no existen", () => {
    const negative = {
      accountCode: ACCOUNT_CODES.CASH,
      debit: Money.fromCents(-100),
      credit: Money.zero(),
    };
    expect(() => createJournalEntry({ ...valid, lines: [negative, creditLine(ACCOUNT_CODES.OWNER_CAPITAL, lempiras("1"))] })).toThrow(
      InvalidJournalEntryError,
    );
    expect(() =>
      createJournalEntry({ ...valid, lines: [debitLine("9999", lempiras("100")), creditLine(ACCOUNT_CODES.CASH, lempiras("100"))] }),
    ).toThrow();
  });
});

describe("asientos de operaciones", () => {
  it("desembolso: sube la cartera y baja la caja", () => {
    const entry = disbursementEntry({ date: "2026-12-01", loanId: "PR-0001", principal: lempiras("10000"), method: "CASH" });

    expect(byAccount(entry, ACCOUNT_CODES.LOAN_PORTFOLIO)?.debit.toCents()).toBe(1_000_000);
    expect(byAccount(entry, ACCOUNT_CODES.CASH)?.credit.toCents()).toBe(1_000_000);
    expect(totals(entry).debits).toBe(totals(entry).credits);
  });

  it("desembolso por transferencia usa la cuenta de bancos", () => {
    const entry = disbursementEntry({ date: "2026-12-01", loanId: "PR-0001", principal: lempiras("500"), method: "TRANSFER" });
    expect(byAccount(entry, ACCOUNT_CODES.BANK)?.credit.toCents()).toBe(50_000);
    expect(byAccount(entry, ACCOUNT_CODES.CASH)).toBeUndefined();
  });

  it("pago: entra a caja y se reparte entre capital, interés y mora", () => {
    const entry = paymentEntry({
      date: "2026-12-15",
      loanId: "PR-0001",
      method: "CASH",
      principal: lempiras("2500"),
      interest: lempiras("250"),
      lateFee: lempiras("137.50"),
    });

    expect(byAccount(entry, ACCOUNT_CODES.CASH)?.debit.toCents()).toBe(288_750);
    expect(byAccount(entry, ACCOUNT_CODES.LOAN_PORTFOLIO)?.credit.toCents()).toBe(250_000);
    expect(byAccount(entry, ACCOUNT_CODES.INTEREST_INCOME)?.credit.toCents()).toBe(25_000);
    expect(byAccount(entry, ACCOUNT_CODES.LATE_FEE_INCOME)?.credit.toCents()).toBe(13_750);
    expect(totals(entry).debits).toBe(totals(entry).credits);
  });

  it("pago: omite los componentes en cero", () => {
    const entry = paymentEntry({
      date: "2026-12-15",
      loanId: "PR-0001",
      method: "TRANSFER",
      principal: lempiras("100"),
      interest: Money.zero(),
      lateFee: Money.zero(),
    });
    expect(entry.lines).toHaveLength(2);
    expect(byAccount(entry, ACCOUNT_CODES.INTEREST_INCOME)).toBeUndefined();
  });

  it("pago: rechaza un pago sin ningún monto", () => {
    expect(() =>
      paymentEntry({
        date: "2026-12-15",
        loanId: "PR-0001",
        method: "CASH",
        principal: Money.zero(),
        interest: Money.zero(),
        lateFee: Money.zero(),
      }),
    ).toThrow(InvalidJournalEntryError);
  });

  it("castigo: el capital pendiente pasa de la cartera a pérdida", () => {
    const entry = writeOffEntry({ date: "2027-03-01", loanId: "PR-0001", principal: lempiras("2500") });
    expect(byAccount(entry, ACCOUNT_CODES.BAD_DEBT_EXPENSE)?.debit.toCents()).toBe(250_000);
    expect(byAccount(entry, ACCOUNT_CODES.LOAN_PORTFOLIO)?.credit.toCents()).toBe(250_000);
  });

  it("aporte y retiro del propietario cuadran", () => {
    const contribution = capitalContributionEntry({ date: "2026-12-01", amount: lempiras("100000"), method: "TRANSFER" });
    const withdrawal = capitalWithdrawalEntry({ date: "2026-12-20", amount: lempiras("5000"), method: "CASH" });

    expect(byAccount(contribution, ACCOUNT_CODES.OWNER_CAPITAL)?.credit.toCents()).toBe(10_000_000);
    expect(byAccount(withdrawal, ACCOUNT_CODES.OWNER_WITHDRAWALS)?.debit.toCents()).toBe(500_000);
    expect(totals(contribution).debits).toBe(totals(contribution).credits);
    expect(totals(withdrawal).debits).toBe(totals(withdrawal).credits);
  });
});

describe("paymentEntryFromAllocations", () => {
  it("convierte un pago repartido por allocatePayment en un asiento cuadrado", () => {
    const balances = buildSchedule({
      principal: lempiras("10000"),
      rateBp: 500,
      ratePeriod: "MONTHLY",
      paymentFrequency: "BIWEEKLY",
      installments: 4,
      startDate: "2026-12-01",
    }).map(createBalance);

    const { allocations } = allocatePayment(balances, lempiras("4000"));
    const entry = paymentEntryFromAllocations({ date: "2026-12-15", loanId: "PR-0001", method: "CASH", allocations });

    // 4,000 = cuota 1 completa (2,500 + 250) + cuota 2 parcial (interés 250 + capital 1,000)
    expect(byAccount(entry, ACCOUNT_CODES.CASH)?.debit.toCents()).toBe(400_000);
    expect(byAccount(entry, ACCOUNT_CODES.INTEREST_INCOME)?.credit.toCents()).toBe(50_000);
    expect(byAccount(entry, ACCOUNT_CODES.LOAN_PORTFOLIO)?.credit.toCents()).toBe(350_000);
    expect(totals(entry).debits).toBe(totals(entry).credits);
  });
});

describe("reverseEntry", () => {
  const original = paymentEntry({
    date: "2026-12-15",
    loanId: "PR-0001",
    method: "CASH",
    principal: lempiras("2500"),
    interest: lempiras("250"),
    lateFee: Money.zero(),
  });

  it("invierte débitos y créditos y queda cuadrado", () => {
    const reversal = reverseEntry(original, "2026-12-16", "Pago registrado al cliente equivocado");

    expect(byAccount(reversal, ACCOUNT_CODES.CASH)?.credit.toCents()).toBe(275_000);
    expect(byAccount(reversal, ACCOUNT_CODES.LOAN_PORTFOLIO)?.debit.toCents()).toBe(250_000);
    expect(totals(reversal).debits).toBe(totals(reversal).credits);
    expect(reversal.description).toContain("Pago registrado al cliente equivocado");
  });

  it("exige el motivo y no modifica el asiento original", () => {
    expect(() => reverseEntry(original, "2026-12-16", "  ")).toThrow(InvalidJournalEntryError);
    reverseEntry(original, "2026-12-16", "Error");
    expect(byAccount(original, ACCOUNT_CODES.CASH)?.debit.toCents()).toBe(275_000);
  });
});
