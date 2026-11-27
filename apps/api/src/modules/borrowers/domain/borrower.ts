import type { BorrowerView } from "@app/contracts";
import { ValidationError } from "../../../shared/application/errors";

export type { BorrowerView };
export type BorrowerStatus = "ACTIVE" | "INACTIVE" | "BLOCKED";

/** Cliente (persona que recibe préstamos). El DNI viaja completo dentro del sistema y cifrado en la base de datos. */
export interface Borrower {
  id: string;
  organizationId: string;
  fullName: string;
  /** DNI sin guiones (13 dígitos). */
  nationalId: string;
  phone: string | null;
  address: string | null;
  status: BorrowerStatus;
  /** Fecha en que aceptó el aviso de privacidad (AAAA-MM-DD). */
  privacyConsentOn: string | null;
  createdOn: string;
}

/** DNI hondureño: 13 dígitos (se acepta con guiones o espacios: 0801-1990-12345). */
export function normalizeNationalId(value: string): string {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(digits)) {
    throw new ValidationError("El DNI debe tener 13 dígitos (por ejemplo 0801-1990-12345)");
  }
  return digits;
}

/** 0801-1990-12345 → ****-****-12345: solo se ven los últimos 5 dígitos, suficientes para reconocerlo. */
export function maskNationalId(nationalId: string): string {
  return `****-****-${nationalId.slice(-5)}`;
}

export function viewOf(borrower: Borrower): BorrowerView {
  return {
    id: borrower.id,
    fullName: borrower.fullName,
    nationalIdMasked: maskNationalId(borrower.nationalId),
    phone: borrower.phone,
    address: borrower.address,
    status: borrower.status,
    privacyConsentOn: borrower.privacyConsentOn,
    createdOn: borrower.createdOn,
  };
}
