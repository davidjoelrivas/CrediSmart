import type { PaymentResult } from "@app/contracts";
import { api, ApiError } from "./api";

/**
 * Cola de cobros sin conexión. Cuando no hay internet, un cobro se guarda en este equipo con su clave de
 * idempotencia; al volver la conexión se envía solo. Como la clave no cambia, aunque el envío se repita el
 * cobro no se duplica. El recibo se emite al sincronizar (el folio lo asigna el servidor).
 */
export interface QueuedPayment {
  /** Es la clave de idempotencia: identifica el cobro de principio a fin. */
  id: string;
  userId: string;
  loanId: string;
  loanCode: string;
  borrowerName: string;
  amountCents: number;
  method: string;
  reference?: string;
  receivedOn: string;
  queuedAt: string;
  status: "PENDING" | "FAILED";
  error?: string;
}

const STORAGE_KEY = "credismart.offline.payments.v1";

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
const snapshots = new Map<string, { version: number; items: QueuedPayment[] }>();

function readAll(): QueuedPayment[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedPayment[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: QueuedPayment[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    throw new Error("No se pudo guardar el cobro en este equipo (almacenamiento lleno o bloqueado).");
  }
  version += 1;
  listeners.forEach((listener) => listener());
}

export const offlineQueue = {
  /** Cobros de una persona (el mismo equipo puede ser usado por varias). Devuelve la misma lista mientras nada cambie. */
  list(userId: string): QueuedPayment[] {
    const cached = snapshots.get(userId);
    if (cached && cached.version === version) {
      return cached.items;
    }
    const items = readAll()
      .filter((item) => item.userId === userId)
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    snapshots.set(userId, { version, items });
    return items;
  },
  enqueue(item: Omit<QueuedPayment, "status" | "queuedAt">): QueuedPayment {
    const queued: QueuedPayment = { ...item, status: "PENDING", queuedAt: new Date().toISOString() };
    writeAll([...readAll().filter((existing) => existing.id !== item.id), queued]);
    return queued;
  },
  remove(id: string): void {
    writeAll(readAll().filter((item) => item.id !== id));
  },
  markFailed(id: string, error: string): void {
    writeAll(readAll().map((item) => (item.id === id ? { ...item, status: "FAILED" as const, error } : item)));
  },
  retry(id: string): void {
    writeAll(readAll().map((item) => (item.id === id ? { ...item, status: "PENDING" as const, error: undefined } : item)));
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Solo para pruebas. */
  clear(): void {
    writeAll([]);
  },
};

export interface FlushResult {
  synced: number;
  failed: number;
  /** Verdadero si se detuvo porque no hay conexión o el servidor no responde: se reintenta más tarde. */
  stopped: boolean;
}

let flushing = false;

type Sender = (body: object) => Promise<PaymentResult>;
const defaultSender: Sender = (body) => api<PaymentResult>("/payments", { method: "POST", body });

/**
 * Envía los cobros pendientes en el orden en que se hicieron. Un error de datos (por ejemplo "el pago supera
 * la deuda") marca ese cobro como fallido para que una persona lo revise y sigue con los demás; un error de
 * red o del servidor detiene el envío y se reintenta después. Nunca corren dos envíos a la vez.
 */
export async function flushQueue(
  userId: string,
  onSynced: (item: QueuedPayment, result: PaymentResult) => void = () => undefined,
  send: Sender = defaultSender,
): Promise<FlushResult> {
  if (flushing) {
    return { synced: 0, failed: 0, stopped: false };
  }
  flushing = true;
  const result: FlushResult = { synced: 0, failed: 0, stopped: false };
  try {
    for (const item of offlineQueue.list(userId).filter((candidate) => candidate.status === "PENDING")) {
      try {
        const response = await send({
          loanId: item.loanId,
          amountCents: item.amountCents,
          method: item.method,
          reference: item.reference,
          receivedOn: item.receivedOn,
          idempotencyKey: item.id,
        });
        offlineQueue.remove(item.id);
        result.synced += 1;
        onSynced(item, response);
      } catch (error) {
        const temporary = !(error instanceof ApiError) || error.status === 0 || error.status === 401 || error.status >= 500;
        if (temporary) {
          result.stopped = true;
          break;
        }
        offlineQueue.markFailed(item.id, (error as ApiError).message);
        result.failed += 1;
      }
    }
  } finally {
    flushing = false;
  }
  return result;
}
