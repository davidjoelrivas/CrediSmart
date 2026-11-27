import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AccountLockedError } from "../modules/identity/application/login";

interface Mapped {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Errores del negocio que la persona puede corregir: se devuelven con su mensaje (siempre en español). */
const BY_NAME: Record<string, { status: number; code: string }> = {
  ValidationError: { status: 422, code: "VALIDATION" },
  InvalidMoneyError: { status: 422, code: "INVALID_MONEY" },
  InvalidLoanTermsError: { status: 422, code: "INVALID_LOAN_TERMS" },
  InvalidLateFeeInputError: { status: 422, code: "INVALID_LATE_FEE" },
  InvalidPaymentError: { status: 422, code: "INVALID_PAYMENT" },
  InvalidBalanceError: { status: 422, code: "INVALID_BALANCE" },
  InvalidAprInputError: { status: 422, code: "INVALID_APR" },
  InvalidUserError: { status: 422, code: "INVALID_USER" },
  AprCapExceededError: { status: 422, code: "APR_CAP_EXCEEDED" },
  NotFoundError: { status: 404, code: "NOT_FOUND" },
  ConflictError: { status: 409, code: "CONFLICT" },
  DuplicateUserError: { status: 409, code: "DUPLICATE" },
  InvalidLoanTransitionError: { status: 409, code: "CONFLICT" },
  UnauthorizedError: { status: 401, code: "UNAUTHORIZED" },
  ForbiddenError: { status: 403, code: "FORBIDDEN" },
};

function fieldName(path: ReadonlyArray<PropertyKey>): string {
  return path.map(String).join(".");
}

function mapError(error: unknown): Mapped {
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({ field: fieldName(issue.path), message: issue.message }));
    const first = issues[0];
    return {
      status: 400,
      code: "BAD_REQUEST",
      message: first ? (first.field ? `${first.field}: ${first.message}` : first.message) : "Datos inválidos",
      details: issues,
    };
  }
  if (error instanceof AccountLockedError) {
    const minutes = Math.max(1, Math.ceil((error.lockedUntil.getTime() - Date.now()) / 60_000));
    return {
      status: 423,
      code: "ACCOUNT_LOCKED",
      message: `Cuenta bloqueada por demasiados intentos fallidos. Intenta de nuevo en ${minutes} minuto${minutes === 1 ? "" : "s"}.`,
    };
  }
  const name = (error as { name?: string }).name ?? "";
  const known = BY_NAME[name];
  if (known) {
    return { status: known.status, code: known.code, message: (error as Error).message };
  }

  // Errores de PostgreSQL que son culpa de los datos y no del servidor.
  const pgCode = (error as { code?: string }).code;
  if (pgCode === "23505") {
    return { status: 409, code: "DUPLICATE", message: "Ya existe un registro con esos datos" };
  }
  if (pgCode === "23503") {
    return { status: 422, code: "INVALID_REFERENCE", message: "El dato hace referencia a algo que no existe" };
  }
  if (pgCode === "40001" || pgCode === "40P01") {
    return { status: 503, code: "RETRY", message: "El sistema está ocupado. Intenta de nuevo." };
  }

  // Errores propios de Fastify (cuerpo demasiado grande, JSON inválido, límite de solicitudes…).
  const fastify = error as FastifyError;
  if (typeof fastify.statusCode === "number" && fastify.statusCode >= 400 && fastify.statusCode < 500) {
    if (fastify.statusCode === 429) {
      return { status: 429, code: "RATE_LIMITED", message: "Demasiadas solicitudes. Espera un momento e intenta de nuevo." };
    }
    if (fastify.statusCode === 413) {
      return { status: 413, code: "TOO_LARGE", message: "La solicitud es demasiado grande" };
    }
    return { status: fastify.statusCode, code: "BAD_REQUEST", message: "La solicitud no es válida" };
  }

  return { status: 500, code: "INTERNAL", message: "Ocurrió un error inesperado. Ya quedó registrado." };
}

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const mapped = mapError(error);
  if (mapped.status >= 500) {
    // El detalle técnico va al registro del servidor, nunca a la respuesta.
    request.log.error({ err: error }, "error no controlado");
  }
  void reply.status(mapped.status).send({
    error: { code: mapped.code, message: mapped.message, ...(mapped.details ? { details: mapped.details } : {}) },
  });
}
