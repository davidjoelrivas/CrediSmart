import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Button, useToast } from "../components/ui";
import { useAuth } from "./auth";
import { formatCents } from "./format";
import { flushQueue, offlineQueue, type QueuedPayment } from "./offline-queue";

const subscribeOnline = (listener: () => void) => {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};

/** Verdadero cuando el navegador cree que hay internet. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

const NO_ITEMS: QueuedPayment[] = [];

/** Cobros guardados en este equipo que esta persona aún no ha enviado. */
export function useQueue(userId: string | undefined): QueuedPayment[] {
  return useSyncExternalStore(
    offlineQueue.subscribe,
    () => (userId ? offlineQueue.list(userId) : NO_ITEMS),
    () => NO_ITEMS,
  );
}

/**
 * Envía los cobros pendientes cuando vuelve la conexión, al abrir la aplicación y cada 30 segundos mientras
 * haya cobros esperando. No dibuja nada.
 */
export function SyncManager(): null {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const userId = user?.id;

  const sync = useCallback(async () => {
    if (!userId) {
      return;
    }
    const result = await flushQueue(userId, (item, response) => {
      toast(`Cobro de ${item.borrowerName} (${formatCents(item.amountCents)}) enviado. Recibo REC-${String(response.receipt.folio).padStart(6, "0")}.`);
    });
    if (result.synced > 0) {
      void queryClient.invalidateQueries();
    }
    if (result.failed > 0) {
      toast(`${result.failed} cobro${result.failed === 1 ? "" : "s"} no se pudo${result.failed === 1 ? "" : "ieron"} enviar: revísalos arriba.`, "danger");
    }
  }, [userId, queryClient, toast]);

  useEffect(() => {
    void sync();
    window.addEventListener("online", sync);
    const timer = window.setInterval(() => void sync(), 30_000);
    return () => {
      window.removeEventListener("online", sync);
      window.clearInterval(timer);
    };
  }, [sync]);

  return null;
}

/** Aviso fijo arriba: sin conexión, cobros por enviar y cobros que necesitan revisión. */
export function OfflineBanner() {
  const { user } = useAuth();
  const online = useOnline();
  const queue = useQueue(user?.id);
  const pending = queue.filter((item) => item.status === "PENDING");
  const failed = queue.filter((item) => item.status === "FAILED");
  const toast = useToast();
  const queryClient = useQueryClient();

  if (online && queue.length === 0) {
    return null;
  }

  async function sendNow() {
    if (!user) return;
    const result = await flushQueue(user.id);
    if (result.synced > 0) {
      void queryClient.invalidateQueries();
      toast("Cobros enviados.");
    } else if (result.stopped) {
      toast("Todavía no hay conexión con el servidor.", "danger");
    }
  }

  return (
    <div className="stack" style={{ marginBottom: 16 }}>
      {!online ? (
        <div className="notice warn" role="status">
          <strong>Sin conexión.</strong> Puedes seguir registrando cobros: se guardan en este equipo y se envían solos cuando vuelva el internet. El recibo se emite al enviarlos.
        </div>
      ) : null}
      {pending.length > 0 ? (
        <div className="notice" role="status">
          <div className="row spread">
            <span>
              <strong>{pending.length}</strong> cobro{pending.length === 1 ? "" : "s"} por enviar:{" "}
              {pending.map((item) => `${item.borrowerName} ${formatCents(item.amountCents)}`).join(" · ")}
            </span>
            <Button small variant="secondary" disabled={!online} onClick={() => void sendNow()}>
              Enviar ahora
            </Button>
          </div>
        </div>
      ) : null}
      {failed.map((item) => (
        <div key={item.id} className="notice danger" role="alert">
          <div className="row spread">
            <span>
              No se pudo registrar el cobro de {item.borrowerName} ({formatCents(item.amountCents)}, {item.loanCode}): {item.error}
            </span>
            <span className="actions">
              <Button small variant="secondary" onClick={() => offlineQueue.retry(item.id)}>
                Reintentar
              </Button>
              <Button small variant="danger" onClick={() => offlineQueue.remove(item.id)}>
                Descartar
              </Button>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
