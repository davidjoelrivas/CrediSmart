/**
 * Lo que la API devuelve. Todo el dinero va en centavos enteros y las fechas como AAAA-MM-DD:
 * la pantalla decide cómo mostrarlos. La API y la web importan estos tipos del mismo lugar.
 */

export type LoanStatusName = "PENDING_SIGNATURE" | "ACTIVE" | "PAID_OFF" | "WRITTEN_OFF" | "CANCELLED";
export type InstallmentStatusName = "PENDING" | "PARTIAL" | "PAID";

export type LateFeeView =
  | { type: "NONE" }
  | { type: "PERCENT_OF_OVERDUE"; rateBp: number }
  | { type: "FIXED_PER_DAY"; amountCents: number }
  | { type: "PERCENT_PER_DAY"; rateBp: number };

// ---------- Clientes ----------

export interface BorrowerView {
  id: string;
  fullName: string;
  nationalIdMasked: string;
  phone: string | null;
  address: string | null;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  privacyConsentOn: string | null;
  createdOn: string;
}

// ---------- Préstamos ----------

export interface LoanSummaryView {
  id: string;
  code: string;
  borrowerId: string;
  borrowerName: string;
  status: LoanStatusName;
  principalCents: number;
  aprBp: number;
  installments: number;
  /** Lo que falta por pagar (capital, interés y mora devengada). */
  outstandingCents: number;
  nextDueDate: string | null;
  nextDueCents: number;
  daysOverdue: number;
  approvedOn: string;
  disbursedOn: string | null;
}

export interface InstallmentView {
  number: number;
  dueDate: string;
  status: InstallmentStatusName;
  principalDueCents: number;
  interestDueCents: number;
  lateFeeDueCents: number;
  paidCents: number;
  outstandingCents: number;
  isOverdue: boolean;
}

export interface PaymentView {
  id: string;
  amountCents: number;
  method: string;
  reference: string | null;
  receivedOn: string;
  isReversal: boolean;
  reversesPaymentId: string | null;
  reversalReason: string | null;
  reversed: boolean;
  receiptFolio: string | null;
  verificationCode: string | null;
}

export interface LoanDetailView extends LoanSummaryView {
  terms: {
    rateBp: number;
    ratePeriod: string;
    paymentFrequency: string;
    interestMethod: string;
    startDate: string;
  };
  lateFee: { config: LateFeeView; graceDays: number; description: string };
  aprCapOverrideReason: string | null;
  installmentsDetail: InstallmentView[];
  payments: PaymentView[];
}

export interface SimulationView {
  schedule: Array<{
    number: number;
    dueDate: string;
    principalCents: number;
    interestCents: number;
    totalCents: number;
  }>;
  totalInterestCents: number;
  totalToPayCents: number;
  aprBp: number;
  aprCapBp: number | null;
  exceedsAprCap: boolean;
}

// ---------- Tablero ----------

export interface OverdueLoanView {
  loanId: string;
  loanCode: string;
  borrowerId: string;
  borrowerName: string;
  daysOverdue: number;
  overdueCents: number;
}

export interface UpcomingInstallmentView {
  loanId: string;
  loanCode: string;
  borrowerName: string;
  installmentNumber: number;
  dueDate: string;
  amountCents: number;
}

export interface RecentPaymentView {
  paymentId: string;
  loanCode: string;
  borrowerName: string;
  amountCents: number;
  method: string;
  receivedOn: string;
  isReversal: boolean;
}

export interface DashboardView {
  asOf: string;
  capital: { cashCents: number; portfolioCents: number; totalCents: number };
  income: {
    interestCents: number;
    lateFeeCents: number;
    netIncomeCents: number;
    collectedThisMonthCents: number;
  };
  loans: { active: number; pendingSignature: number; paidOff: number; total: number };
  risk: {
    outstandingPrincipalCents: number;
    overdueLoans: number;
    overdueAmountCents: number;
    /** Cartera en riesgo (más de 7 / 30 días de atraso) en puntos base. */
    par7Bp: number;
    par30Bp: number;
  };
  topOverdue: OverdueLoanView[];
  upcoming: UpcomingInstallmentView[];
  recentPayments: RecentPaymentView[];
}

// ---------- Recibos ----------

export interface ReceiptView {
  folio: string;
  issuedOn: string;
  verificationCode: string;
  organizationName: string;
  borrowerName: string;
  loanCode: string;
  amountCents: number;
  method: string;
  reference: string | null;
  receivedOn: string;
  allocation: { lateFeeCents: number; interestCents: number; principalCents: number };
  loanBalanceCents: number;
  voided: boolean;
}

export interface ReceiptVerification {
  valid: boolean;
  voided: boolean;
  folio: string;
  issuedOn: string;
  receivedOn: string;
  amountCents: number;
  organizationName: string;
  borrowerHint: string;
}

// ---------- Otros ----------

export interface PaymentResult {
  paymentId: string;
  replayed: boolean;
  receipt: { folio: number; verificationCode: string };
  loanStatus: LoanStatusName;
}

export interface AuditRecordView {
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  on: string;
  details: Record<string, string | number | boolean | null>;
}

export interface AuditResponse {
  records: AuditRecordView[];
  chainValid: boolean;
  brokenAtSequence: number | null;
}

export interface AccrualResult {
  asOf: string;
  loansChecked: number;
  loansUpdated: number;
  installmentsUpdated: number;
}

// ---------- Precalificación ----------

export type PrescreeningOutcomeName = "APPLIES" | "REVIEW" | "NOT_APPLIES";
export type QuestionTypeName = "YES_NO" | "CHOICE" | "NUMBER" | "TEXT";

export interface QuestionView {
  key: string;
  text: string;
  type: QuestionTypeName;
  options?: string[];
}

/** Lo que ve quien llena la solicitud: solo las preguntas, nunca las reglas ni el puntaje. */
export interface PublicFormView {
  organizationName: string;
  version: number;
  questions: QuestionView[];
}

export interface SubmissionView {
  id: string;
  applicantName: string;
  phone: string;
  receivedOn: string;
  formVersion: number;
  outcome: PrescreeningOutcomeName;
  score: number;
  reasons: Array<{ questionKey: string; kind: "KNOCKOUT" | "SCORED"; reason: string; points: number }>;
  answers: Array<{ key: string; question: string; answer: string }>;
  status: "NEW" | "DECIDED";
  decision: "CONTINUE" | "DISCARD" | null;
  decisionNote: string | null;
  decidedOn: string | null;
  contradictsOutcome: boolean | null;
}

export interface PrescreeningFormView {
  /** Texto del enlace público, o null si la organización todavía no lo tiene. */
  slug: string | null;
  version: number;
  /** Verdadero mientras se usa la plantilla inicial y nadie la ha personalizado. */
  isDefault: boolean;
  definition: {
    questions: QuestionView[];
    rules: unknown[];
    thresholds: { appliesMin: number; reviewMin: number };
  };
}
