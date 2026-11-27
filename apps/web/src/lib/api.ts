/** Error devuelto por la API: trae un mensaje en español listo para mostrar. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** La sesión venció o no existe: la pantalla debe volver al inicio de sesión. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT";
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      throw error;
    }
    throw new ApiError(0, "NETWORK", "No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.");
  }

  const text = await response.text();
  const payload: unknown = text ? safeJson(text) : null;

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (response.status === 401 && !path.startsWith("/auth/login")) {
      unauthorizedListeners.forEach((listener) => listener());
    }
    throw new ApiError(
      response.status,
      error?.code ?? "ERROR",
      error?.message ?? "Ocurrió un error inesperado",
      error?.details,
    );
  }
  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Mensaje amable para cualquier error capturado. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado";
}

/** Genera la clave que evita cobrar dos veces si el botón se toca dos veces o la red se repite. */
export function newIdempotencyKey(): string {
  return `cobro-${crypto.randomUUID()}`;
}
