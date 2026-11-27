import { formatCents } from "@app/contracts";

export { formatCents };

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** 2026-12-01 → "1 dic 2026". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

/** Puntos base → porcentaje legible: 1250 → "12.5 %". */
export function formatBp(basisPoints: number): string {
  const percent = basisPoints / 100;
  const text = Number.isInteger(percent) ? percent.toString() : percent.toFixed(2).replace(/0$/, "");
  return `${text} %`;
}

export const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Semanal",
  BIWEEKLY: "Quincenal",
  MONTHLY: "Mensual",
};

/** Para frases como "tasa mensual" o "pagos quincenales". */
export const FREQUENCY_ADJECTIVES: Record<string, string> = {
  WEEKLY: "semanal",
  BIWEEKLY: "quincenal",
  MONTHLY: "mensual",
};

export const INTEREST_METHOD_LABELS: Record<string, string> = {
  FLAT: "Interés fijo (sobre el capital original)",
  DECLINING: "Sobre saldo (cuota nivelada)",
  INTEREST_ONLY: "Solo interés (capital al final)",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  DEPOSIT: "Depósito",
};

export const LOAN_STATUS_LABELS: Record<string, string> = {
  PENDING_SIGNATURE: "Pendiente de firma",
  ACTIVE: "Activo",
  PAID_OFF: "Pagado",
  WRITTEN_OFF: "Castigado",
  CANCELLED: "Cancelado",
};

export const INSTALLMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  PARTIAL: "Parcial",
  PAID: "Pagada",
};

export const ROLE_LABELS: Record<string, string> = {
  OWNER: "Dueño",
  COLLECTOR: "Cobrador",
  ACCOUNTANT: "Contador",
  CLIENT: "Cliente",
};

export const BORROWER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  BLOCKED: "Bloqueado",
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOAN_APPROVED: "Préstamo aprobado",
  LOAN_DISBURSED: "Préstamo desembolsado",
  PAYMENT_REGISTERED: "Pago registrado",
  PAYMENT_REVERSED: "Pago revertido",
  LATE_FEES_ACCRUED: "Mora calculada",
  BORROWER_CREATED: "Cliente registrado",
  BORROWER_UPDATED: "Cliente actualizado",
  CAPITAL_CONTRIBUTED: "Aporte de capital",
  CONTRACT_GENERATED: "Contrato generado",
  PRESCREENING_RECEIVED: "Solicitud recibida",
  PRESCREENING_DECIDED: "Solicitud decidida",
  PRESCREENING_FORM_UPDATED: "Preguntas actualizadas",
};

export function labelOf(labels: Record<string, string>, key: string): string {
  return labels[key] ?? key;
}

/** "1 día", "5 días". */
export function formatDays(days: number): string {
  return `${days} ${days === 1 ? "día" : "días"}`;
}

/** Enlace de WhatsApp con el mensaje ya escrito, para recordar un pago sin copiar y pegar. */
export function whatsappLink(phone: string | null, message: string): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, "");
  const number = digits.length === 8 ? `504${digits}` : digits;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
