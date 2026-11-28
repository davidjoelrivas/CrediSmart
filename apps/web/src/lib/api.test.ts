import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("cliente de la API", () => {
  it("si el navegador sabe que no hay internet, falla de inmediato sin intentar la red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    await expect(api("/payments", { method: "POST", body: {} })).rejects.toMatchObject({ status: 0, code: "NETWORK" });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("una solicitud colgada se corta por tiempo y se trata como falta de conexión", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("abort", "AbortError"))))),
    );

    const pending = expect(api("/payments", { method: "POST", body: {}, timeoutMs: 5000 })).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(5001);

    await pending;
  });

  it("los errores de la API traen su mensaje en español", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Ya existe" } }), { status: 409 })));

    const error = await api("/x").catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "CONFLICT", message: "Ya existe" });
  });

  it("una cancelación pedida por quien llama no se confunde con falta de conexión", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("abort", "AbortError"))))));

    const pending = api("/x", { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
