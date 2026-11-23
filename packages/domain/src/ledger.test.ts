import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ACCOUNT_CODES } from "./chart-of-accounts";
import {
  capitalContributionEntry,
  capitalWithdrawalEntry,
  disbursementEntry,
  paymentEntry,
  reverseEntry,
  writeOffEntry,
  type JournalEntry,
} from "./journal-entry";
import { balanceOf, isBalanced, loanPrincipalBalance, summarize, trialBalance } from "./ledger";
import { Money } from "./money";

const lempiras = (text: string) => Money.fromLempiras(text);
const cents = (money: Money) => money.toCents();

/** Escenario: L 100,000 de capital, un préstamo de L 10,000 y un pago de L 2,750 (2,500 + 250). */
function exampleBook(): JournalEntry[] {
  return [
    capitalContributionEntry({ date: "2026-12-01", amount: lempiras("100000"), method: "CASH" }),
    disbursementEntry({ date: "2026-12-01", loanId: "PR-0001", principal: lempiras("10000"), method: "CASH" }),
    paymentEntry({
      date: "2026-12-15",
      loanId: "PR-0001",
      method: "CASH",
      principal: lempiras("2500"),
      interest: lempiras("250"),
      lateFee: Money.zero(),
    }),
  ];
}

describe("summarize: el tablero", () => {
  it("calcula caja, capital colocado e intereses ganados", () => {
    const summary = summarize(exampleBook());

    expect(cents(summary.cash)).toBe(9_275_000);
    expect(cents(summary.portfolio)).toBe(750_000);
    expect(cents(summary.totalCapital)).toBe(10_025_000);
    expect(cents(summary.interestIncome)).toBe(25_000);
    expect(cents(summary.netIncome)).toBe(25_000);
  });

  it("separa lo cobrado por bancos de lo cobrado en caja pero los suma como efectivo disponible", () => {
    const book = [
      capitalContributionEntry({ date: "2026-12-01", amount: lempiras("1000"), method: "TRANSFER" }),
      capitalContributionEntry({ date: "2026-12-01", amount: lempiras("500"), method: "CASH" }),
    ];
    expect(cents(balanceOf(book, ACCOUNT_CODES.BANK))).toBe(100_000);
    expect(cents(balanceOf(book, ACCOUNT_CODES.CASH))).toBe(50_000);
    expect(cents(summarize(book).cash)).toBe(150_000);
  });

  it("un castigo baja la cartera, no entra a caja y reduce la utilidad", () => {
    const book = [...exampleBook(), writeOffEntry({ date: "2027-03-01", loanId: "PR-0001", principal: lempiras("7500") })];
    const summary = summarize(book);

    expect(cents(summary.portfolio)).toBe(0);
    expect(cents(summary.cash)).toBe(9_275_000);
    expect(cents(summary.badDebtExpense)).toBe(750_000);
    expect(cents(summary.netIncome)).toBe(25_000 - 750_000);
  });

  it("el retiro del propietario baja la caja y el capital total", () => {
    const book = [...exampleBook(), capitalWithdrawalEntry({ date: "2026-12-20", amount: lempiras("5000"), method: "CASH" })];
    expect(cents(summarize(book).totalCapital)).toBe(10_025_000 - 500_000);
  });

  it("un libro vacío da todo en cero", () => {
    expect(cents(summarize([]).totalCapital)).toBe(0);
    expect(isBalanced([])).toBe(true);
  });
});

describe("trialBalance y cuadre", () => {
  it("el libro siempre cuadra y el balance de comprobación lista las cuentas usadas", () => {
    const book = exampleBook();
    expect(isBalanced(book)).toBe(true);
    expect(trialBalance(book).map((row) => row.accountCode)).toEqual(["1101", "1201", "3101", "4101"]);
  });

  it("un reverso deja la cuenta como si el asiento original no existiera", () => {
    const book = exampleBook();
    const reversed = [...book, reverseEntry(book[2]!, "2026-12-16", "Error de digitación")];

    expect(isBalanced(reversed)).toBe(true);
    expect(cents(summarize(reversed).interestIncome)).toBe(0);
    expect(cents(summarize(reversed).portfolio)).toBe(1_000_000);
  });
});

describe("loanPrincipalBalance", () => {
  it("lleva el capital pendiente de cada préstamo por separado", () => {
    const book = [
      ...exampleBook(),
      disbursementEntry({ date: "2026-12-02", loanId: "PR-0002", principal: lempiras("3000"), method: "TRANSFER" }),
    ];

    expect(cents(loanPrincipalBalance(book, "PR-0001"))).toBe(750_000);
    expect(cents(loanPrincipalBalance(book, "PR-0002"))).toBe(300_000);
    expect(cents(loanPrincipalBalance(book, "PR-0003"))).toBe(0);
  });
});

describe("propiedades del libro", () => {
  it("el capital total siempre es aportes − retiros + utilidad, y el libro siempre cuadra", () => {
    const operation = fc.oneof(
      fc.record({ type: fc.constant("contribution" as const), amount: fc.integer({ min: 1, max: 1_000_000 }) }),
      fc.record({ type: fc.constant("withdrawal" as const), amount: fc.integer({ min: 1, max: 1_000_000 }) }),
      fc.record({ type: fc.constant("disbursement" as const), amount: fc.integer({ min: 1, max: 1_000_000 }) }),
      fc.record({
        type: fc.constant("payment" as const),
        principal: fc.integer({ min: 0, max: 100_000 }),
        interest: fc.integer({ min: 0, max: 100_000 }),
        lateFee: fc.integer({ min: 1, max: 100_000 }),
      }),
    );

    fc.assert(
      fc.property(fc.array(operation, { minLength: 1, maxLength: 40 }), (operations) => {
        const book: JournalEntry[] = [];
        let contributed = 0;
        let withdrawn = 0;

        for (const op of operations) {
          const date = "2026-12-01";
          if (op.type === "contribution") {
            contributed += op.amount;
            book.push(capitalContributionEntry({ date, amount: Money.fromCents(op.amount), method: "CASH" }));
          } else if (op.type === "withdrawal") {
            withdrawn += op.amount;
            book.push(capitalWithdrawalEntry({ date, amount: Money.fromCents(op.amount), method: "CASH" }));
          } else if (op.type === "disbursement") {
            book.push(disbursementEntry({ date, loanId: "PR-0001", principal: Money.fromCents(op.amount), method: "CASH" }));
          } else {
            book.push(
              paymentEntry({
                date,
                loanId: "PR-0001",
                method: "CASH",
                principal: Money.fromCents(op.principal),
                interest: Money.fromCents(op.interest),
                lateFee: Money.fromCents(op.lateFee),
              }),
            );
          }
        }

        const summary = summarize(book);
        expect(isBalanced(book)).toBe(true);
        expect(cents(summary.totalCapital)).toBe(contributed - withdrawn + cents(summary.netIncome));
      }),
    );
  });
});
