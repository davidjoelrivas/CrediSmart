import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { ToastProvider } from "./components/ui";
import { AuthProvider } from "./lib/auth";

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

function mockApi(handler: Handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const { status, body } = handler(url, init);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
}

function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const owner = {
  id: "u1",
  fullName: "Mauricio (demo)",
  role: "OWNER",
  email: "dueno@demo.credismart.app",
  phone: null,
  permissions: ["reports:read", "borrowers:read", "loans:read", "loans:simulate"],
};

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("acceso", () => {
  it("sin sesión lleva al inicio de sesión", async () => {
    mockApi(() => ({ status: 401, body: { error: { code: "UNAUTHORIZED", message: "Inicia sesión para continuar" } } }));

    renderApp("/prestamos");

    expect(await screen.findByRole("heading", { name: "Inicia sesión" })).toBeInTheDocument();
  });

  it("muestra el error de credenciales sin borrar el correo", async () => {
    mockApi((url) =>
      url.endsWith("/auth/login")
        ? { status: 401, body: { error: { code: "UNAUTHORIZED", message: "Credenciales incorrectas" } } }
        : { status: 401, body: { error: { code: "UNAUTHORIZED", message: "x" } } },
    );
    renderApp("/login");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Correo o teléfono"), "dueno@demo.credismart.app");
    await user.type(screen.getByLabelText("Contraseña"), "mala-clave");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("Credenciales incorrectas")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo o teléfono")).toHaveValue("dueno@demo.credismart.app");
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
  });

  it("al entrar muestra el menú según los permisos del rol", async () => {
    mockApi((url) => {
      if (url.endsWith("/auth/me")) return { status: 200, body: { user: owner } };
      if (url.endsWith("/dashboard")) {
        return {
          status: 200,
          body: {
            asOf: "2026-11-27",
            capital: { cashCents: 100_000, portfolioCents: 50_000, totalCents: 150_000 },
            income: { interestCents: 0, lateFeeCents: 0, netIncomeCents: 0, collectedThisMonthCents: 0 },
            loans: { active: 0, pendingSignature: 0, paidOff: 0, total: 0 },
            risk: { outstandingPrincipalCents: 0, overdueLoans: 0, overdueAmountCents: 0, par7Bp: 0, par30Bp: 0 },
            topOverdue: [],
            upcoming: [],
            recentPayments: [],
          },
        };
      }
      return { status: 404, body: {} };
    });

    renderApp("/");

    expect(await screen.findByText("L 1,500.00")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(nav).toHaveTextContent("Tablero");
    expect(nav).toHaveTextContent("Préstamos");
    expect(nav).not.toHaveTextContent("Bitácora");
    expect(nav).not.toHaveTextContent("Equipo");
  });
});

describe("verificación pública de recibos", () => {
  it("un recibo auténtico se muestra sin pedir sesión", async () => {
    mockApi(() => ({
      status: 200,
      body: {
        valid: true,
        voided: false,
        folio: "REC-000010",
        issuedOn: "2026-11-27",
        receivedOn: "2026-11-27",
        amountCents: 202_500,
        organizationName: "Crédito Inteligente",
        borrowerHint: "Pedro Z.",
      },
    }));

    renderApp("/verificar/ABC-123-XYZ");

    expect(await screen.findByText("Recibo auténtico")).toBeInTheDocument();
    expect(screen.getByText("L 2,025.00")).toBeInTheDocument();
  });

  it("un código falso advierte que no existe", async () => {
    mockApi(() => ({ status: 404, body: { valid: false } }));

    renderApp("/verificar/CODIGO-FALSO");

    await waitFor(() => expect(screen.getByText("Recibo no encontrado")).toBeInTheDocument());
  });

  it("un recibo anulado lo dice claramente", async () => {
    mockApi(() => ({
      status: 200,
      body: {
        valid: false,
        voided: true,
        folio: "REC-000001",
        issuedOn: "2026-11-27",
        receivedOn: "2026-11-27",
        amountCents: 1000,
        organizationName: "Crédito Inteligente",
        borrowerHint: "Ana M.",
      },
    }));

    renderApp("/verificar/ANULADO-1");

    expect(await screen.findByText("Recibo anulado")).toBeInTheDocument();
  });
});
