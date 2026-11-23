import {
  ACCOUNT_CODES,
  DEFAULT_CHART_OF_ACCOUNTS,
  findAccount,
  isDebitNormal,
  type Account,
} from "./chart-of-accounts";
import type { JournalEntry } from "./journal-entry";
import { Money } from "./money";

export interface TrialBalanceRow {
  accountCode: string;
  debit: Money;
  credit: Money;
}

/** Balance de comprobación: total de débitos y créditos de cada cuenta, ordenado por código. */
export function trialBalance(entries: readonly JournalEntry[]): TrialBalanceRow[] {
  const rows = new Map<string, TrialBalanceRow>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const row = rows.get(line.accountCode) ?? {
        accountCode: line.accountCode,
        debit: Money.zero(),
        credit: Money.zero(),
      };
      rows.set(line.accountCode, {
        accountCode: line.accountCode,
        debit: row.debit.add(line.debit),
        credit: row.credit.add(line.credit),
      });
    }
  }
  return [...rows.values()].sort((first, second) =>
    first.accountCode.localeCompare(second.accountCode),
  );
}

/** Verdadero si, en todo el libro, los débitos son iguales a los créditos. */
export function isBalanced(entries: readonly JournalEntry[]): boolean {
  const rows = trialBalance(entries);
  const debits = rows.reduce((sum, row) => sum.add(row.debit), Money.zero());
  const credits = rows.reduce((sum, row) => sum.add(row.credit), Money.zero());
  return debits.equals(credits);
}

/** Saldo de una cuenta con su signo natural (débito para activos y gastos, crédito para el resto). */
export function balanceOf(
  entries: readonly JournalEntry[],
  accountCode: string,
  chart: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): Money {
  const account = findAccount(chart, accountCode);
  const row = trialBalance(entries).find((candidate) => candidate.accountCode === accountCode);
  if (!row) {
    return Money.zero();
  }
  return isDebitNormal(account.type) ? row.debit.subtract(row.credit) : row.credit.subtract(row.debit);
}

/** Capital que un préstamo todavía debe, según los asientos de su cartera. */
export function loanPrincipalBalance(entries: readonly JournalEntry[], loanId: string): Money {
  return entries
    .flatMap((entry) => entry.lines)
    .filter((line) => line.loanId === loanId && line.accountCode === ACCOUNT_CODES.LOAN_PORTFOLIO)
    .reduce((sum, line) => sum.add(line.debit).subtract(line.credit), Money.zero());
}

/** Cifras del tablero del prestamista. */
export interface LedgerSummary {
  /** Caja + bancos. */
  cash: Money;
  /** Capital colocado en préstamos. */
  portfolio: Money;
  /** Caja disponible + capital colocado. */
  totalCapital: Money;
  interestIncome: Money;
  lateFeeIncome: Money;
  badDebtExpense: Money;
  operatingExpense: Money;
  /** Intereses y mora cobrados menos pérdidas y gastos. */
  netIncome: Money;
}

export function summarize(
  entries: readonly JournalEntry[],
  chart: readonly Account[] = DEFAULT_CHART_OF_ACCOUNTS,
): LedgerSummary {
  const balance = (code: string) => balanceOf(entries, code, chart);

  const cash = balance(ACCOUNT_CODES.CASH).add(balance(ACCOUNT_CODES.BANK));
  const portfolio = balance(ACCOUNT_CODES.LOAN_PORTFOLIO);
  const interestIncome = balance(ACCOUNT_CODES.INTEREST_INCOME);
  const lateFeeIncome = balance(ACCOUNT_CODES.LATE_FEE_INCOME);
  const badDebtExpense = balance(ACCOUNT_CODES.BAD_DEBT_EXPENSE);
  const operatingExpense = balance(ACCOUNT_CODES.OPERATING_EXPENSE);

  return {
    cash,
    portfolio,
    totalCapital: cash.add(portfolio),
    interestIncome,
    lateFeeIncome,
    badDebtExpense,
    operatingExpense,
    netIncome: interestIncome.add(lateFeeIncome).subtract(badDebtExpense).subtract(operatingExpense),
  };
}
