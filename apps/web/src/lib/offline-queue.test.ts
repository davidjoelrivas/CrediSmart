import type { PaymentResult } from "@app/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { flushQueue, offlineQueue } from "./offline-queue";

const base = {
  userId: "u1",
  loanId: "11111111-1111-4111-8111-111111111111",
  loanCode: "PR-0001",
  borrowerName: "María López",
  amountCents: 100_000,
  method: "CASH",
  receivedOn: "2026-12-01",
};
const ok: PaymentResult = { paymentId: "p", replayed: false, receipt: { folio: 1, verificationCode: "X" }, loanStatus: "ACTIVE" };

beforeEach(() => {
  window.localStorage.clear();
  offlineQueue.clear();
});

describe("cola de cobros sin conexión", () => {
  it("guarda el cobro con su clave de idempotencia y lo separa por persona", () => {
    offlineQueue.enqueue({ ...base, id: "cobro-a" });
    offlineQueue.enqueue({ ...base, userId: "u2", id: "cobro-b" });

    expect(offlineQueue.list("u1").map((item) => item.id)).toEqual(["cobro-a"]);
    expect(offlineQueue.list("u2")).toHaveLength(1);
    expect(offlineQueue.list("u1")[0]).toMatchObject({ status: "PENDING", amountCents: 100_000 });
  });

  it("encolar dos veces la misma clave no duplica el cobro", () => {
    offlineQueue.enqueue({ ...base, id: "cobro-a" });
    offlineQueue.enqueue({ ...base, id: "cobro-a" });

    expect(offlineQueue.list("u1")).toHaveLength(1);
  });

  it("devuelve la misma lista mientras no cambie nada (necesario para React)", () => {
    offlineQueue.enqueue({ ...base, id: "cobro-a" });

    expect(offlineQueue.list("u1")).toBe(offlineQueue.list("u1"));
  });

  it("avisa a quien está suscrito cuando la cola cambia", () => {
    const listener = vi.fn();
    const unsubscribe = offlineQueue.subscribe(listener);

    offlineQueue.enqueue({ ...base, id: "cobro-a" });
    unsubscribe();
    offlineQueue.remove("cobro-a");

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("flushQueue", () => {
  it("envía en orden, con la misma clave de idempotencia, y vacía la cola", async () => {
    offlineQueue.enqueue({ ...base, id: "cobro-a" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    offlineQueue.enqueue({ ...base, id: "cobro-b", amountCents: 50_000 });
    const send = vi.fn().mockResolvedValue(ok);
    const synced = vi.fn();

    const result = await flushQueue("u1", synced, send);

    expect(result).toEqual({ synced: 2, failed: 0, stopped: false });
    expect(send.mock.calls.map(([body]) => (body as { idempotencyKey: string }).idempotencyKey)).toEqual(["cobro-a", "cobro-b"]);
    expect(send.mock.calls[1]![0]).toMatchObject({ amountCents: 50_000, receivedOn: "2026-12-01" });
    expect(synced).toHaveBeenCalledTimes(2);
    expect(offlineQueue.list("u1")).toEqual([]);
  });

  it("si no hay conexión se detiene y conserva todo para reintentar", async () => {
    offlineQueue.enqueue({ ...base, id: "cobro-a" });
    offlineQueue.enqueue({ ...base, id: "cobro-b" });
    const send = vi.fn().mockRejectedValue(new ApiError(0, "NETWORK", "Sin conexión"));

    const result = await flushQueue("u1", undefined, send);

    expect(result).toEqual({ synced: 0, failed: 0, stopped: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(offlineQueue.list("u1")).toHaveLength(2);
  });

  it("un error de datos marca ese cobro como fallido y sigue con los demás", async () => {
    offlineQueue.enqueue({ ...base, id: "cobro-a" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    offlineQueue.enqueue({ ...base, id: "cobro-b" });
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "CONFLICT", "El pago supera lo que se debe"))
      .mockResolvedValueOnce(ok);

    const result = await flushQueue("u1", undefined, send);

    expect(result).toEqual({ synced: 1, failed: 1, stopped: false });
    expect(offlineQueue.list("u1")).toMatchObject([{ id: "cobro-a", status: "FAILED", error: "El pago supera lo que se debe" }]);
  });

  it("una sesión vencida o un error del servidor no descartan el cobro", async () => {
    offlineQueue.enqueue({ ...base, id: "cobro-a" });

    for (const status of [401, 503]) {
      const result = await flushQueue("u1", undefined, vi.fn().mockRejectedValue(new ApiError(status, "X", "x")));
      expect(result.stopped).toBe(true);
    }
    expect(offlineQueue.list("u1")[0]).toMatchObject({ status: "PENDING" });
  });

  it("los cobros fallidos no se reenvían solos hasta que una persona los reintenta", async () => {
    offlineQueue.enqueue({ ...base, id: "cobro-a" });
    offlineQueue.markFailed("cobro-a", "Revisar");
    const send = vi.fn().mockResolvedValue(ok);

    await flushQueue("u1", undefined, send);
    expect(send).not.toHaveBeenCalled();

    offlineQueue.retry("cobro-a");
    await flushQueue("u1", undefined, send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("no corren dos envíos a la vez", async () => {
    offlineQueue.enqueue({ ...base, id: "cobro-a" });
    let release!: () => void;
    const send = vi.fn().mockImplementation(() => new Promise<PaymentResult>((resolve) => (release = () => resolve(ok))));

    const first = flushQueue("u1", undefined, send);
    const second = await flushQueue("u1", undefined, send);
    release();
    await first;

    expect(second).toEqual({ synced: 0, failed: 0, stopped: false });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
