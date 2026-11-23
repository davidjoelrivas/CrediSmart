export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export interface Account {
  code: string;
  name: string;
  type: AccountType;
}

export const ACCOUNT_CODES = {
  CASH: "1101",
  BANK: "1102",
  LOAN_PORTFOLIO: "1201",
  OWNER_CAPITAL: "3101",
  OWNER_WITHDRAWALS: "3102",
  INTEREST_INCOME: "4101",
  LATE_FEE_INCOME: "4102",
  BAD_DEBT_EXPENSE: "5101",
  OPERATING_EXPENSE: "5201",
} as const;

/** Plan de cuentas mínimo para un prestamista; cada organización puede ampliarlo. */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly Account[] = [
  { code: ACCOUNT_CODES.CASH, name: "Caja", type: "ASSET" },
  { code: ACCOUNT_CODES.BANK, name: "Bancos", type: "ASSET" },
  { code: ACCOUNT_CODES.LOAN_PORTFOLIO, name: "Cartera de préstamos (capital)", type: "ASSET" },
  { code: ACCOUNT_CODES.OWNER_CAPITAL, name: "Capital del propietario", type: "EQUITY" },
  { code: ACCOUNT_CODES.OWNER_WITHDRAWALS, name: "Retiros del propietario", type: "EQUITY" },
  { code: ACCOUNT_CODES.INTEREST_INCOME, name: "Ingresos por intereses", type: "INCOME" },
  { code: ACCOUNT_CODES.LATE_FEE_INCOME, name: "Ingresos por mora", type: "INCOME" },
  { code: ACCOUNT_CODES.BAD_DEBT_EXPENSE, name: "Pérdida por incobrables", type: "EXPENSE" },
  { code: ACCOUNT_CODES.OPERATING_EXPENSE, name: "Gastos operativos", type: "EXPENSE" },
];

export class UnknownAccountError extends Error {
  constructor(code: string) {
    super(`La cuenta "${code}" no existe en el plan de cuentas`);
    this.name = "UnknownAccountError";
  }
}

export function findAccount(chart: readonly Account[], code: string): Account {
  const account = chart.find((candidate) => candidate.code === code);
  if (!account) {
    throw new UnknownAccountError(code);
  }
  return account;
}

/** Las cuentas de activo y de gasto aumentan con débitos; las demás, con créditos. */
export function isDebitNormal(type: AccountType): boolean {
  return type === "ASSET" || type === "EXPENSE";
}
