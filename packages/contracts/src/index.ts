import { z } from "zod";

// Los mensajes de validación por defecto salen en español.
z.config(z.locales.es());

/**
 * Contratos de la API: lo que la aplicación web puede enviar. La API valida TODO con estos
 * esquemas antes de tocar el negocio, y la web usa los mismos tipos: un solo lugar de verdad.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD");
const cents = z.number().int("El monto debe ser un entero en centavos").safe();
const positiveCents = cents.positive("El monto debe ser mayor que cero");
const basisPoints = z.number().int().min(0).max(1_000_000);
const text = (max: number) => z.string().trim().max(max);

export const FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const;
export const INTEREST_METHODS = ["FLAT", "DECLINING", "INTEREST_ONLY"] as const;
export const PAYMENT_METHODS = ["CASH", "TRANSFER", "DEPOSIT"] as const;
export const ROLES = ["OWNER", "COLLECTOR", "ACCOUNTANT", "CLIENT"] as const;
export const LOAN_STATUSES = ["PENDING_SIGNATURE", "ACTIVE", "PAID_OFF", "WRITTEN_OFF", "CANCELLED"] as const;

export type Frequency = (typeof FREQUENCIES)[number];
export type InterestMethod = (typeof INTEREST_METHODS)[number];
export type PaymentMethodName = (typeof PAYMENT_METHODS)[number];
export type RoleName = (typeof ROLES)[number];

// ---------- Sesión ----------

export const loginRequest = z.object({
  login: text(190).min(1, "Escribe tu correo o teléfono"),
  password: z.string().min(1, "Escribe tu contraseña").max(200),
});
export type LoginRequest = z.infer<typeof loginRequest>;

// ---------- Clientes ----------

export const createBorrowerRequest = z.object({
  fullName: text(200).min(3, "El nombre es muy corto"),
  nationalId: text(20).min(1, "Escribe el DNI"),
  phone: text(30).optional(),
  address: text(300).optional(),
  privacyConsent: z.boolean(),
});
export type CreateBorrowerRequest = z.infer<typeof createBorrowerRequest>;

export const updateBorrowerRequest = z
  .object({
    fullName: text(200).min(3),
    phone: text(30).nullable(),
    address: text(300).nullable(),
    status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]),
  })
  .partial();
export type UpdateBorrowerRequest = z.infer<typeof updateBorrowerRequest>;

export const borrowerSearchQuery = z.object({
  q: text(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------- Préstamos ----------

export const lateFeeConfig = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NONE") }),
  z.object({ type: z.literal("PERCENT_OF_OVERDUE"), rateBp: basisPoints }),
  z.object({ type: z.literal("FIXED_PER_DAY"), amountCents: positiveCents }),
  z.object({ type: z.literal("PERCENT_PER_DAY"), rateBp: basisPoints }),
]);
export type LateFeeConfigRequest = z.infer<typeof lateFeeConfig>;

export const loanTerms = z.object({
  principalCents: positiveCents,
  rateBp: basisPoints,
  ratePeriod: z.enum(FREQUENCIES),
  paymentFrequency: z.enum(FREQUENCIES),
  installments: z.number().int().min(1).max(360),
  interestMethod: z.enum(INTEREST_METHODS).default("FLAT"),
  startDate: isoDate,
});
export type LoanTermsRequest = z.infer<typeof loanTerms>;

export const simulateLoanRequest = z.object({ terms: loanTerms });
export type SimulateLoanRequest = z.infer<typeof simulateLoanRequest>;

export const approveLoanRequest = z.object({
  borrowerId: z.uuid(),
  terms: loanTerms,
  lateFee: lateFeeConfig.default({ type: "NONE" }),
  graceDays: z.number().int().min(0).max(60).default(0),
  /** Solo hace falta si la tasa efectiva anual supera el tope legal configurado. */
  aprCapOverride: z
    .object({ confirmed: z.boolean(), reason: text(500).min(5, "Explica el motivo (mínimo 5 caracteres)") })
    .optional(),
});
export type ApproveLoanRequest = z.infer<typeof approveLoanRequest>;

export const disburseLoanRequest = z.object({ method: z.enum(PAYMENT_METHODS) });
export type DisburseLoanRequest = z.infer<typeof disburseLoanRequest>;

export const loanListQuery = z.object({
  status: z.enum(LOAN_STATUSES).optional(),
  borrowerId: z.uuid().optional(),
  overdue: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

// ---------- Pagos ----------

export const registerPaymentRequest = z.object({
  loanId: z.uuid(),
  amountCents: positiveCents,
  method: z.enum(PAYMENT_METHODS),
  reference: text(120).optional(),
  receivedOn: isoDate.optional(),
  /** La web genera uno por cada intento de cobro: si la solicitud se repite, el pago no se duplica. */
  idempotencyKey: text(100).min(8, "Falta la clave de idempotencia"),
});
export type RegisterPaymentRequest = z.infer<typeof registerPaymentRequest>;

export const reversePaymentRequest = z.object({
  reason: text(300).min(5, "Explica por qué se revierte (mínimo 5 caracteres)"),
});
export type ReversePaymentRequest = z.infer<typeof reversePaymentRequest>;

// ---------- Usuarios ----------

export const createUserRequest = z.object({
  role: z.enum(["OWNER", "COLLECTOR", "ACCOUNTANT"]),
  fullName: text(160).min(2),
  email: text(190).optional(),
  phone: text(30).optional(),
  password: z.string().min(10, "La contraseña debe tener al menos 10 caracteres").max(200),
});
export type CreateUserRequest = z.infer<typeof createUserRequest>;

// ---------- Precalificación ----------

const answerValue = z.union([z.boolean(), z.number().finite(), text(300)]);

/** Lo que envía una persona desde el enlace público. */
export const publicApplyRequest = z.object({
  applicantName: text(160).min(3, "Escribe tu nombre completo"),
  phone: text(30).min(8, "Escribe tu teléfono"),
  answers: z.record(z.string().max(60), answerValue),
  privacyConsent: z.boolean(),
});
export type PublicApplyRequest = z.infer<typeof publicApplyRequest>;

export const decideSubmissionRequest = z.object({
  decision: z.enum(["CONTINUE", "DISCARD"]),
  note: text(500).optional(),
});
export type DecideSubmissionRequest = z.infer<typeof decideSubmissionRequest>;

const condition = z.discriminatedUnion("op", [
  z.object({ op: z.literal("EQUALS"), value: answerValue }),
  z.object({ op: z.literal("NOT_EQUALS"), value: answerValue }),
  z.object({ op: z.literal("IN"), values: z.array(answerValue).min(1) }),
  z.object({ op: z.literal("AT_LEAST"), value: z.number().finite() }),
  z.object({ op: z.literal("AT_MOST"), value: z.number().finite() }),
]);

const questionKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/, "La clave solo lleva letras, números y guion bajo");

export const prescreeningFormRequest = z.object({
  questions: z
    .array(
      z.object({
        key: questionKey,
        text: text(200).min(3),
        type: z.enum(["YES_NO", "CHOICE", "NUMBER", "TEXT"]),
        options: z.array(text(80).min(1)).max(20).optional(),
      }),
    )
    .min(1)
    .max(20),
  rules: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("KNOCKOUT"), questionKey, when: condition, reason: text(200).min(3) }),
        z.object({ kind: z.literal("SCORED"), questionKey, when: condition, points: z.number().int(), reason: text(200).min(3) }),
      ]),
    )
    .max(60),
  thresholds: z.object({ appliesMin: z.number().int(), reviewMin: z.number().int() }),
});
export type PrescreeningFormRequest = z.infer<typeof prescreeningFormRequest>;

// ---------- Respuestas que la web consume ----------

export interface SessionUser {
  id: string;
  fullName: string;
  role: RoleName;
  email: string | null;
  phone: string | null;
  permissions: string[];
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

/** Formatea centavos como "L 1,250.50" (misma salida que el sistema usa en recibos y reportes). */
export function formatCents(totalCents: number): string {
  const sign = totalCents < 0 ? "-" : "";
  const absolute = Math.abs(totalCents);
  const whole = Math.floor(absolute / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}L ${whole}.${String(absolute % 100).padStart(2, "0")}`;
}

export * from "./views";
