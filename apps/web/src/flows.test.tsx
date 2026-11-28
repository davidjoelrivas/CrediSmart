import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { client, collector, loanDetail, loanSummary, mockServer, owner, renderAt } from "./test-utils";

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

const BORROWER_ID = "22222222-2222-4222-8222-222222222222";
const borrower = {
  id: BORROWER_ID,
  fullName: "María Fernanda López",
  nationalIdMasked: "****-****-12345",
  phone: "99887766",
  address: "Barrio El Centro",
  status: "ACTIVE",
  privacyConsentOn: "2026-11-27",
  createdOn: "2026-11-27",
};

describe("clientes", () => {
  it("lista clientes con el DNI enmascarado y registra uno nuevo con consentimiento", async () => {
    const server = mockServer({
      "GET /auth/me": { body: { user: owner } },
      "GET /borrowers": { body: { borrowers: [borrower] } },
      "POST /borrowers": { status: 201, body: { borrower } },
      [`GET /borrowers/${BORROWER_ID}`]: { body: { borrower } },
      "GET /loans": { body: { loans: [] } },
    });
    renderAt("/clientes");
    const user = userEvent.setup();

    expect(await screen.findByText("María Fernanda López")).toBeInTheDocument();
    expect(screen.getByText("****-****-12345")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    const save = screen.getByRole("button", { name: "Guardar cliente" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Nombre completo"), "Carlos Alberto Reyes");
    await user.type(screen.getByLabelText("DNI"), "0501-1985-00077");
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(server.last("POST", "/borrowers")).toBeDefined());
    expect(server.last("POST", "/borrowers")!.body).toMatchObject({
      fullName: "Carlos Alberto Reyes",
      nationalId: "0501-1985-00077",
      privacyConsent: true,
    });
  });

  it("muestra el mensaje de la API cuando el DNI ya existe", async () => {
    mockServer({
      "GET /auth/me": { body: { user: owner } },
      "GET /borrowers": { body: { borrowers: [] } },
      "POST /borrowers": { status: 409, body: { error: { code: "CONFLICT", message: "Ya existe un cliente con ese DNI" } } },
    });
    renderAt("/clientes");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Nuevo cliente" }));
    await user.type(screen.getByLabelText("Nombre completo"), "Carlos Alberto Reyes");
    await user.type(screen.getByLabelText("DNI"), "0501198500077");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Guardar cliente" }));

    expect(await screen.findByText("Ya existe un cliente con ese DNI")).toBeInTheDocument();
  });

  it("un contador no ve el botón de nuevo cliente", async () => {
    mockServer({
      "GET /auth/me": { body: { user: { ...owner, role: "ACCOUNTANT", permissions: ["borrowers:read", "loans:read", "reports:read"] } } },
      "GET /borrowers": { body: { borrowers: [borrower] } },
    });
    renderAt("/clientes");

    expect(await screen.findByText("María Fernanda López")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo cliente" })).not.toBeInTheDocument();
  });
});

describe("préstamos", () => {
  it("filtra por estado y enlaza al detalle", async () => {
    const server = mockServer({
      "GET /auth/me": { body: { user: owner } },
      "GET /loans": { body: { loans: [loanSummary] } },
    });
    renderAt("/prestamos");
    const user = userEvent.setup();

    expect(await screen.findByText("PR-0001")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "En mora" }));
    await waitFor(() => expect(server.calls.some((call) => call.method === "GET" && call.path === "/loans")).toBe(true));
    expect(screen.getByRole("link", { name: "PR-0001" })).toHaveAttribute("href", `/prestamos/${loanSummary.id}`);
  });

  it("el detalle muestra cuotas, política de mora y recibos", async () => {
    mockServer({
      "GET /auth/me": { body: { user: owner } },
      [`GET /loans/${loanDetail.id}`]: { body: { loan: loanDetail } },
    });
    renderAt(`/prestamos/${loanDetail.id}`);

    expect(await screen.findByText("5 % del monto vencido después de 3 días de gracia")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "REC-000001" })).toHaveAttribute("href", `/api/v1/payments/${loanDetail.payments[0]!.id}/receipt.pdf`);
    expect(screen.getAllByText("Pagada")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Contrato y pagaré" })).toBeInTheDocument();
  });

  it("registrar un pago envía centavos exactos y una clave de idempotencia, y ofrece el recibo", async () => {
    const server = mockServer({
      "GET /auth/me": { body: { user: collector } },
      [`GET /loans/${loanDetail.id}`]: { body: { loan: loanDetail } },
      "POST /payments": {
        status: 201,
        body: { paymentId: "44444444-4444-4444-8444-444444444444", replayed: false, receipt: { folio: 2, verificationCode: "XYZ" }, loanStatus: "ACTIVE" },
      },
    });
    renderAt(`/prestamos/${loanDetail.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));
    const amount = screen.getByLabelText("Monto recibido");
    await user.clear(amount);
    await user.type(amount, "1,250.50");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Registrar pago" }));

    expect(await screen.findByText(/Recibo REC-000002 emitido/)).toBeInTheDocument();
    const sent = server.last("POST", "/payments")!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ loanId: loanDetail.id, amountCents: 125_050, method: "CASH" });
    expect(String(sent.idempotencyKey)).toMatch(/^cobro-/);
    expect(screen.getByRole("link", { name: "Ver recibo (PDF)" })).toHaveAttribute("href", "/api/v1/payments/44444444-4444-4444-8444-444444444444/receipt.pdf");
    // El cobrador no puede revertir pagos.
    expect(screen.queryByRole("button", { name: "Revertir" })).not.toBeInTheDocument();
  });

  it("si el pago supera la deuda, muestra el motivo y permite corregir", async () => {
    mockServer({
      "GET /auth/me": { body: { user: owner } },
      [`GET /loans/${loanDetail.id}`]: { body: { loan: loanDetail } },
      "POST /payments": { status: 409, body: { error: { code: "CONFLICT", message: "El pago supera lo que se debe del préstamo PR-0001 por L 100.00" } } },
    });
    renderAt(`/prestamos/${loanDetail.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Registrar pago" }));

    expect(await screen.findByText(/supera lo que se debe/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("revertir un pago exige un motivo de al menos 5 caracteres", async () => {
    const server = mockServer({
      "GET /auth/me": { body: { user: owner } },
      [`GET /loans/${loanDetail.id}`]: { body: { loan: loanDetail } },
      [`POST /payments/${loanDetail.payments[0]!.id}/reverse`]: { body: { reversalId: "x", loanStatus: "ACTIVE" } },
    });
    renderAt(`/prestamos/${loanDetail.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Revertir" }));
    const confirm = screen.getByRole("button", { name: "Revertir pago" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Por qué se revierte/), "Se registró dos veces");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(server.last("POST", `/payments/${loanDetail.payments[0]!.id}/reverse`)).toBeDefined());
    expect(server.last("POST", `/payments/${loanDetail.payments[0]!.id}/reverse`)!.body).toEqual({ reason: "Se registró dos veces" });
  });

  it("un préstamo pendiente de firma se desembolsa eligiendo de dónde sale el dinero", async () => {
    const pending = { ...loanDetail, status: "PENDING_SIGNATURE" as const, disbursedOn: null, payments: [] };
    const server = mockServer({
      "GET /auth/me": { body: { user: owner } },
      [`GET /loans/${loanDetail.id}`]: { body: { loan: pending } },
      [`POST /loans/${loanDetail.id}/disburse`]: { body: { loan: loanDetail } },
    });
    renderAt(`/prestamos/${loanDetail.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Desembolsar" }));
    await user.selectOptions(screen.getByLabelText("¿De dónde sale el dinero?"), "TRANSFER");
    await user.click(screen.getByRole("button", { name: "Confirmar desembolso" }));

    await waitFor(() => expect(server.last("POST", `/loans/${loanDetail.id}/disburse`)).toBeDefined());
    expect(server.last("POST", `/loans/${loanDetail.id}/disburse`)!.body).toEqual({ method: "TRANSFER" });
  });
});

describe("nuevo préstamo", () => {
  it("calcula el plan y solo permite aprobar cuando todo está completo", async () => {
    const server = mockServer({
      "GET /auth/me": { body: { user: owner } },
      "GET /borrowers": { body: { borrowers: [borrower] } },
      "POST /loans/simulate": {
        body: {
          schedule: [{ number: 1, dueDate: "2026-12-15", principalCents: 250_000, interestCents: 25_000, totalCents: 275_000 }],
          totalInterestCents: 100_000, totalToPayCents: 1_100_000, aprBp: 17_281, aprCapBp: null, exceedsAprCap: false,
        },
      },
      "POST /loans": { status: 201, body: { loan: loanDetail } },
      [`GET /loans/${loanDetail.id}`]: { body: { loan: loanDetail } },
    });
    renderAt("/prestamos/nuevo");
    const user = userEvent.setup();

    const approve = await screen.findByRole("button", { name: "Aprobar préstamo" });
    expect(approve).toBeDisabled();
    await screen.findByRole("option", { name: /María Fernanda López/ });
    await user.selectOptions(screen.getByLabelText("Cliente"), BORROWER_ID);
    await user.type(screen.getByLabelText("Monto del préstamo"), "10000");

    expect(await screen.findByText("L 11,000.00")).toBeInTheDocument();
    expect(screen.getByText("172.81 %")).toBeInTheDocument();
    await waitFor(() => expect(approve).toBeEnabled());
    await user.click(approve);

    await waitFor(() => expect(server.last("POST", "/loans")).toBeDefined());
    const body = server.last("POST", "/loans")!.body as { terms: Record<string, unknown> } & Record<string, unknown>;
    expect(body).toMatchObject({ borrowerId: BORROWER_ID, graceDays: 0, lateFee: { type: "NONE" } });
    expect(body.terms).toMatchObject({ principalCents: 1_000_000, rateBp: 500, installments: 4 });
  });

  it("si supera el tope legal exige el motivo antes de aprobar", async () => {
    mockServer({
      "GET /auth/me": { body: { user: owner } },
      "GET /borrowers": { body: { borrowers: [borrower] } },
      "POST /loans/simulate": {
        body: { schedule: [], totalInterestCents: 0, totalToPayCents: 0, aprBp: 17_281, aprCapBp: 2_400, exceedsAprCap: true },
      },
    });
    renderAt("/prestamos/nuevo");
    const user = userEvent.setup();

    await screen.findByRole("option", { name: /María Fernanda López/ });
    await user.selectOptions(screen.getByLabelText("Cliente"), BORROWER_ID);
    await user.type(screen.getByLabelText("Monto del préstamo"), "10000");
    const reason = await screen.findByLabelText("Motivo para aprobar por encima del tope");
    const approve = screen.getByRole("button", { name: "Aprobar préstamo" });
    expect(approve).toBeDisabled();
    await user.type(reason, "Cliente de confianza");
    await waitFor(() => expect(approve).toBeEnabled());
  });
});

describe("cobranza y portal", () => {
  it("la cobranza arma el enlace de WhatsApp con el mensaje escrito", async () => {
    mockServer({
      "GET /auth/me": { body: { user: collector } },
      "GET /loans": { body: { loans: [{ ...loanSummary, daysOverdue: 12 }] } },
      "GET /borrowers": { body: { borrowers: [borrower] } },
    });
    renderAt("/cobranza");

    const link = await screen.findByRole("link", { name: "Recordar por WhatsApp" });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/50499887766\?text=/);
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain("PR-0001");
  });

  it("el cliente final solo ve su portal y no el menú de gestión", async () => {
    mockServer({
      "GET /auth/me": { body: { user: client } },
      "GET /portal/loans": { body: { loans: [loanSummary] } },
    });
    renderAt("/prestamos");

    expect(await screen.findByText("Mis préstamos")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Principal" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR-0001" })).toHaveAttribute("href", `/portal/prestamos/${loanSummary.id}`);
  });
});

describe("precalificación", () => {
  const submission = {
    id: "55555555-5555-4555-8555-555555555555",
    applicantName: "Oscar David Pineda",
    phone: "99000003",
    receivedOn: "2026-11-27",
    formVersion: 1,
    outcome: "NOT_APPLIES",
    score: 0,
    reasons: [{ questionKey: "deudaAtrasada", kind: "KNOCKOUT", reason: "Tiene una deuda atrasada", points: 0 }],
    answers: [{ key: "deudaAtrasada", question: "¿Tiene alguna deuda atrasada?", answer: "Sí" }],
    status: "NEW",
    decision: null,
    decisionNote: null,
    decidedOn: null,
    contradictsOutcome: null,
  };

  it("explica el resultado y la decisión contraria al sistema muestra el error de nota obligatoria", async () => {
    const server = mockServer({
      "GET /auth/me": { body: { user: owner } },
      "GET /prescreening": { body: { submissions: [submission] } },
      "GET /prescreening/form": { body: { form: { slug: "mi-negocio", version: 1, isDefault: true, definition: { questions: [{ key: "a", text: "¿Pregunta de prueba?", type: "YES_NO" }], rules: [], thresholds: { appliesMin: 5, reviewMin: 3 } } } } },
      [`GET /prescreening/${submission.id}`]: { body: { submission } },
      [`POST /prescreening/${submission.id}/decision`]: { status: 422, body: { error: { code: "VALIDATION", message: "Decidir en contra del resultado orientativo requiere una nota con el motivo" } } },
    });
    renderAt("/precalificacion");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Oscar David Pineda" }));
    expect(await screen.findByText("Tiene una deuda atrasada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar con esta persona" }));

    expect(await screen.findByText(/requiere una nota/)).toBeInTheDocument();
    expect(server.last("POST", `/prescreening/${submission.id}/decision`)!.body).toEqual({ decision: "CONTINUE" });
    expect(screen.getByDisplayValue("http://localhost:3000/aplicar/mi-negocio")).toBeInTheDocument();
  });

  it("el formulario público envía las respuestas con su tipo correcto", async () => {
    const server = mockServer({
      "GET /public/apply/mi-negocio": {
        body: {
          organizationName: "Crédito Inteligente",
          version: 1,
          questions: [
            { key: "tieneIngresoFijo", text: "¿Tiene un ingreso fijo?", type: "YES_NO" },
            { key: "montoSolicitado", text: "¿Cuánto necesita?", type: "NUMBER" },
          ],
        },
      },
      "POST /public/apply/mi-negocio": { status: 201, body: { received: true } },
    });
    renderAt("/aplicar/mi-negocio");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Nombre completo"), "Marta Elena Guzmán");
    await user.type(screen.getByLabelText("Teléfono (WhatsApp)"), "9955-1122");
    await user.selectOptions(screen.getByLabelText("¿Tiene un ingreso fijo?"), "yes");
    const submit = screen.getByRole("button", { name: "Enviar solicitud" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("¿Cuánto necesita?"), "8,000");
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit);

    expect(await screen.findByText("¡Recibimos tu solicitud!")).toBeInTheDocument();
    expect(server.last("POST", "/public/apply/mi-negocio")!.body).toEqual({
      applicantName: "Marta Elena Guzmán",
      phone: "9955-1122",
      answers: { tieneIngresoFijo: true, montoSolicitado: 8000 },
      privacyConsent: true,
    });
  });
});

describe("bitácora y equipo", () => {
  it("avisa claramente si la cadena de la bitácora está rota", async () => {
    mockServer({
      "GET /auth/me": { body: { user: owner } },
      "GET /audit": { body: { records: [], chainValid: false, brokenAtSequence: 7 } },
    });
    renderAt("/bitacora");

    expect(await screen.findByText(/se rompe en el evento 7/)).toBeInTheDocument();
  });

  it("el equipo lista usuarios y crea uno nuevo", async () => {
    const server = mockServer({
      "GET /auth/me": { body: { user: owner } },
      "GET /users": { body: { users: [owner, collector] } },
      "POST /users": { status: 201, body: { user: collector } },
    });
    renderAt("/usuarios");
    const user = userEvent.setup();

    expect(await screen.findByText("Cobrador (demo)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nuevo usuario" }));
    await user.type(screen.getByLabelText("Nombre completo"), "Nuevo Cobrador");
    await user.type(screen.getByLabelText("Teléfono"), "3300-1122");
    const create = screen.getByRole("button", { name: "Crear usuario" });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText(/Contraseña inicial/), "una-clave-larga-1");
    await user.click(create);

    await waitFor(() => expect(server.last("POST", "/users")).toBeDefined());
    expect(server.last("POST", "/users")!.body).toMatchObject({ role: "COLLECTOR", fullName: "Nuevo Cobrador", phone: "3300-1122" });
  });
});

describe("cobros sin conexión", () => {
  it("si no hay internet al cobrar, el cobro se guarda en el equipo con su clave y se avisa", async () => {
    window.localStorage.clear();
    const server = mockServer({
      "GET /auth/me": { body: { user: collector } },
      [`GET /loans/${loanDetail.id}`]: { body: { loan: loanDetail } },
    });
    renderAt(`/prestamos/${loanDetail.id}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));
    const amount = screen.getByLabelText("Monto recibido");
    await user.clear(amount);
    await user.type(amount, "500");
    // A partir de aquí el servidor "se cae": el navegador reporta que no hay conexión.
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Registrar pago" }));

    expect(await screen.findByText(/quedó guardado en este equipo/)).toBeInTheDocument();
    const queued = JSON.parse(window.localStorage.getItem("credismart.offline.payments.v1")!);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ userId: collector.id, loanId: loanDetail.id, amountCents: 50_000, status: "PENDING", borrowerName: "María Fernanda López" });
    expect(queued[0].id).toMatch(/^cobro-/);
    expect(server.last("POST", "/payments")).toBeUndefined();
    vi.restoreAllMocks();
  });
});
