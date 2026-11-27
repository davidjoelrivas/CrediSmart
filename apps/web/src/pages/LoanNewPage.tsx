import type { ApproveLoanRequest, LoanDetailView } from "@app/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  DEFAULT_TERMS,
  SimulationResult,
  TermsFields,
  graceDaysOf,
  lateFeeOf,
  termsRequestOf,
  today,
  useSimulation,
  type TermsValues,
} from "../components/TermsForm";
import { Button, Card, ErrorNotice, Field, PageHead, useToast } from "../components/ui";
import { api } from "../lib/api";
import { formatBp } from "../lib/format";
import { useBorrowers } from "../lib/queries";

export function LoanNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [borrowerId, setBorrowerId] = useState(params.get("cliente") ?? "");
  const [values, setValues] = useState<TermsValues>({ ...DEFAULT_TERMS, startDate: today() });
  const [overrideReason, setOverrideReason] = useState("");
  const borrowers = useBorrowers("");

  const terms = useMemo(() => termsRequestOf(values), [values]);
  const lateFee = lateFeeOf(values);
  const graceDays = graceDaysOf(values);
  const simulation = useSimulation(terms);
  const exceedsCap = simulation.data?.exceedsAprCap ?? false;

  const approve = useMutation({
    mutationFn: (body: ApproveLoanRequest) => api<{ loan: LoanDetailView }>("/loans", { method: "POST", body }),
    onSuccess: ({ loan }) => {
      void queryClient.invalidateQueries();
      toast(`Préstamo ${loan.code} aprobado. Falta firmarlo y desembolsarlo.`);
      navigate(`/prestamos/${loan.id}`);
    },
  });

  const eligible = (borrowers.data ?? []).filter((borrower) => borrower.status === "ACTIVE");
  const ready =
    borrowerId !== "" &&
    terms !== null &&
    lateFee !== null &&
    graceDays !== null &&
    (!exceedsCap || overrideReason.trim().length >= 5);

  function submit() {
    if (!terms || !lateFee || graceDays === null) {
      return;
    }
    approve.mutate({
      borrowerId,
      terms: { ...terms, interestMethod: terms.interestMethod ?? "FLAT" },
      lateFee,
      graceDays,
      aprCapOverride: exceedsCap ? { confirmed: true, reason: overrideReason.trim() } : undefined,
    });
  }

  return (
    <div className="stack">
      <PageHead title="Nuevo préstamo" subtitle={<Link to="/prestamos">← Préstamos</Link>} />

      <Card title="1. ¿A quién se le presta?">
        <Field label="Cliente" hint="¿No está en la lista? Primero regístralo en Clientes.">
          {(props) => (
            <select {...props} value={borrowerId} onChange={(event) => setBorrowerId(event.target.value)}>
              <option value="">Elige un cliente…</option>
              {eligible.map((borrower) => (
                <option key={borrower.id} value={borrower.id}>
                  {borrower.fullName} · {borrower.nationalIdMasked}
                </option>
              ))}
            </select>
          )}
        </Field>
      </Card>

      <Card title="2. Condiciones y mora">
        <TermsFields values={values} onChange={setValues} withLateFee />
        {lateFee === null || graceDays === null ? <p className="muted small" style={{ marginTop: 8 }}>Completa la política de mora para poder aprobar.</p> : null}
      </Card>

      <SimulationResult terms={terms} simulation={simulation} />

      {exceedsCap && simulation.data?.aprCapBp !== null ? (
        <Card title="Superas el tope legal">
          <div className="stack">
            <p>
              La tasa efectiva anual es {formatBp(simulation.data?.aprBp ?? 0)} y el tope configurado es{" "}
              {formatBp(simulation.data?.aprCapBp ?? 0)}. Si de todos modos lo apruebas, debes dejar el motivo: queda registrado en la bitácora.
            </p>
            <Field label="Motivo para aprobar por encima del tope">
              {(props) => <textarea {...props} rows={2} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} />}
            </Field>
          </div>
        </Card>
      ) : null}

      {approve.isError ? <ErrorNotice error={approve.error} /> : null}
      <div className="row">
        <Button variant="accent" loading={approve.isPending} disabled={!ready} onClick={submit}>
          Aprobar préstamo
        </Button>
        <span className="muted small">Aprobar no entrega el dinero: el préstamo queda pendiente de firma hasta que lo desembolses.</span>
      </div>
    </div>
  );
}
