export type Role = "OWNER" | "COLLECTOR" | "ACCOUNTANT" | "CLIENT";
export type UserStatus = "ACTIVE" | "DISABLED";

export const ROLES: readonly Role[] = ["OWNER", "COLLECTOR", "ACCOUNTANT", "CLIENT"];

/** Persona que usa el sistema, sin datos secretos. */
export interface User {
  id: string;
  organizationId: string;
  role: Role;
  fullName: string;
  email: string | null;
  phone: string | null;
  /** Solo para el rol CLIENT: el cliente al que pertenece su acceso al portal. */
  borrowerId: string | null;
  status: UserStatus;
}

/** Usuario tal como se guarda: incluye lo necesario para validar la contraseña y el bloqueo. */
export interface UserRecord extends User {
  passwordHash: string;
  failedLogins: number;
  lockedUntil: Date | null;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export class InvalidUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUserError";
  }
}

/** Lo que una persona escribe para entrar: un correo o un teléfono. */
export type LoginIdentifier = { email: string } | { phone: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 190) {
    throw new InvalidUserError("El correo no es válido");
  }
  return email;
}

/** Teléfonos hondureños: 8 dígitos; se aceptan espacios, guiones y el prefijo +504. */
export function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("504")) {
    digits = digits.slice(3);
  }
  if (digits.length !== 8) {
    throw new InvalidUserError("El teléfono debe tener 8 dígitos");
  }
  return digits;
}

export function parseLoginIdentifier(value: string): LoginIdentifier {
  return value.includes("@") ? { email: normalizeEmail(value) } : { phone: normalizePhone(value) };
}

const MIN_PASSWORD_LENGTH = 10;
const COMMON_PASSWORDS = new Set([
  "1234567890",
  "contrasena1",
  "password123",
  "qwertyuiop",
  "0123456789",
]);

/** Reglas mínimas de contraseña: largo suficiente, no trivial y no igual al correo. */
export function validatePassword(password: string, email: string | null = null): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new InvalidUserError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  if (password.length > 200) {
    throw new InvalidUserError("La contraseña es demasiado larga");
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) {
    throw new InvalidUserError("La contraseña es demasiado común: elige otra");
  }
  if (email && password.toLowerCase() === email.toLowerCase()) {
    throw new InvalidUserError("La contraseña no puede ser igual al correo");
  }
}

export type Permission =
  | "borrowers:read"
  | "borrowers:write"
  | "loans:read"
  | "loans:simulate"
  | "loans:approve"
  | "loans:disburse"
  | "payments:register"
  | "payments:reverse"
  | "late-fees:run"
  | "reports:read"
  | "users:manage"
  | "audit:read"
  | "prescreening:read"
  | "prescreening:decide"
  | "portal:read";

const PERMISSIONS_BY_ROLE: Record<Role, ReadonlySet<Permission>> = {
  // El dueño decide quién recibe dinero, cuánto y cuándo: aprobar, desembolsar y revertir son solo suyos.
  OWNER: new Set<Permission>([
    "borrowers:read",
    "borrowers:write",
    "loans:read",
    "loans:simulate",
    "loans:approve",
    "loans:disburse",
    "payments:register",
    "payments:reverse",
    "late-fees:run",
    "reports:read",
    "users:manage",
    "audit:read",
    "prescreening:read",
    "prescreening:decide",
  ]),
  // El cobrador atiende clientes y cobra, pero no mueve el capital ni corrige pagos.
  COLLECTOR: new Set<Permission>([
    "borrowers:read",
    "borrowers:write",
    "loans:read",
    "loans:simulate",
    "payments:register",
    "reports:read",
    "prescreening:read",
  ]),
  // El contador solo mira: ve cartera, clientes y reportes.
  ACCOUNTANT: new Set<Permission>(["borrowers:read", "loans:read", "reports:read", "audit:read"]),
  CLIENT: new Set<Permission>(["portal:read"]),
};

export function permissionsOf(role: Role): Permission[] {
  return [...PERMISSIONS_BY_ROLE[role]];
}

export function can(role: Role, permission: Permission): boolean {
  return PERMISSIONS_BY_ROLE[role].has(permission);
}
