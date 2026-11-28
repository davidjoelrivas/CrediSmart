import type { LoanDetailView, LoanSummaryView, SessionUser } from "@app/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { App } from "./App";
import { ToastProvider } from "./components/ui";
import { AuthProvider } from "./lib/auth";

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

type Reply = { status?: number; body: unknown };
type Routes = Record<string, Reply | ((call: RecordedCall) => Reply)>;

/**
 * Servidor simulado: cada clave es "MÉTODO /ruta" (sin /api/v1). Devuelve 404 para lo que no esté definido
 * y guarda todas las llamadas, para comprobar qué envió la pantalla.
 */
export function mockServer(routes: Routes) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path] = url.replace("/api/v1", "").split("?");
      const method = init?.method ?? "GET";
      const call: RecordedCall = { method, path: path!, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const route = routes[`${method} ${path}`];
      if (!route) {
        return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } }), { status: 404 });
      }
      const reply = typeof route === "function" ? route(call) : route;
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
  return { calls, last: (method: string, path: string) => [...calls].reverse().find((call) => call.method === method && call.path === path) };
}

export function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" }, mutations: { networkMode: "always" } } });
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

const OWNER_PERMISSIONS = [
  "borrowers:read", "borrowers:write", "loans:read", "loans:simulate", "loans:approve", "loans:disburse",
  "payments:register", "payments:reverse", "late-fees:run", "reports:read", "users:manage", "audit:read",
  "prescreening:read", "prescreening:decide",
];

export const owner: SessionUser = {
  id: "u-owner",
  fullName: "Mauricio (demo)",
  role: "OWNER",
  email: "dueno@demo.credismart.app",
  phone: null,
  permissions: OWNER_PERMISSIONS,
};

export const collector: SessionUser = {
  id: "u-collector",
  fullName: "Cobrador (demo)",
  role: "COLLECTOR",
  email: "cobrador@demo.credismart.app",
  phone: null,
  permissions: ["borrowers:read", "borrowers:write", "loans:read", "loans:simulate", "payments:register", "reports:read", "prescreening:read"],
};

export const client: SessionUser = {
  id: "u-client",
  fullName: "María López",
  role: "CLIENT",
  email: null,
  phone: "99887766",
  permissions: ["portal:read"],
};

export const loanSummary: LoanSummaryView = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "PR-0001",
  borrowerId: "22222222-2222-4222-8222-222222222222",
  borrowerName: "María Fernanda López",
  status: "ACTIVE",
  principalCents: 1_000_000,
  aprBp: 17_281,
  installments: 4,
  outstandingCents: 825_000,
  nextDueDate: "2026-12-15",
  nextDueCents: 275_000,
  daysOverdue: 0,
  approvedOn: "2026-12-01",
  disbursedOn: "2026-12-01",
};

export const loanDetail: LoanDetailView = {
  ...loanSummary,
  terms: { rateBp: 500, ratePeriod: "MONTHLY", paymentFrequency: "BIWEEKLY", interestMethod: "FLAT", startDate: "2026-12-01" },
  lateFee: { config: { type: "PERCENT_OF_OVERDUE", rateBp: 500 }, graceDays: 3, description: "5 % del monto vencido después de 3 días de gracia" },
  aprCapOverrideReason: null,
  installmentsDetail: [1, 2, 3, 4].map((number) => ({
    number,
    dueDate: `2026-12-${String(number * 14 + 1).padStart(2, "0")}`,
    status: number === 1 ? "PAID" : "PENDING",
    principalDueCents: 250_000,
    interestDueCents: 25_000,
    lateFeeDueCents: 0,
    paidCents: number === 1 ? 275_000 : 0,
    outstandingCents: number === 1 ? 0 : 275_000,
    isOverdue: false,
  })),
  payments: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      amountCents: 275_000,
      method: "CASH",
      reference: null,
      receivedOn: "2026-12-15",
      isReversal: false,
      reversesPaymentId: null,
      reversalReason: null,
      reversed: false,
      receiptFolio: "REC-000001",
      verificationCode: "ABC-123",
    },
  ],
};
