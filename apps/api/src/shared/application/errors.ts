/** El recurso no existe, o existe pero pertenece a otra organización (no se distingue a propósito). */
export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} "${id}" no encontrado`);
    this.name = "NotFoundError";
  }
}

/** La operación choca con el estado actual (por ejemplo, un préstamo que ya fue desembolsado). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** No hay una sesión válida: falta iniciar sesión o la sesión venció. */
export class UnauthorizedError extends Error {
  constructor(message = "Inicia sesión para continuar") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** La persona está identificada pero su rol no permite esta operación. */
export class ForbiddenError extends Error {
  constructor(message = "Tu rol no permite realizar esta operación") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Los datos enviados no cumplen las reglas del negocio (distinto de un conflicto de estado). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
