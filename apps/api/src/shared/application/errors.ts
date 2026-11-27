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
