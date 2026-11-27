import type { BorrowerView, CreateBorrowerRequest } from "@app/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, Loading, Modal, PageHead, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { BORROWER_STATUS_LABELS, formatDate, labelOf } from "../lib/format";
import { useBorrowers } from "../lib/queries";

export function statusTone(status: BorrowerView["status"]) {
  return status === "ACTIVE" ? "ok" : status === "BLOCKED" ? "danger" : "neutral";
}

function NewBorrowerModal({ onClose, initial }: { onClose: () => void; initial?: { fullName: string; phone: string } }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ fullName: initial?.fullName ?? "", nationalId: "", phone: initial?.phone ?? "", address: "", privacyConsent: false });

  const create = useMutation({
    mutationFn: (body: CreateBorrowerRequest) => api<{ borrower: BorrowerView }>("/borrowers", { method: "POST", body }),
    onSuccess: ({ borrower }) => {
      void queryClient.invalidateQueries({ queryKey: ["borrowers"] });
      toast("Cliente registrado.");
      onClose();
      navigate(`/clientes/${borrower.id}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate({
      fullName: form.fullName,
      nationalId: form.nationalId,
      phone: form.phone || undefined,
      address: form.address || undefined,
      privacyConsent: form.privacyConsent,
    });
  }

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Modal title="Nuevo cliente" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {create.isError ? <ErrorNotice error={create.error} /> : null}
        <div className="form-grid">
          <Field label="Nombre completo" wide>
            {(props) => <input {...props} value={form.fullName} onChange={set("fullName")} autoComplete="off" required />}
          </Field>
          <Field label="DNI" hint="13 dígitos, con o sin guiones">
            {(props) => <input {...props} value={form.nationalId} onChange={set("nationalId")} inputMode="numeric" placeholder="0801-1990-12345" required />}
          </Field>
          <Field label="Teléfono" hint="8 dígitos">
            {(props) => <input {...props} value={form.phone} onChange={set("phone")} inputMode="tel" placeholder="9988-7766" />}
          </Field>
          <Field label="Dirección" wide>
            {(props) => <input {...props} value={form.address} onChange={set("address")} autoComplete="off" />}
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={form.privacyConsent}
            onChange={(event) => setForm((current) => ({ ...current, privacyConsent: event.target.checked }))}
          />
          <span>El cliente aceptó el aviso de privacidad y autoriza guardar sus datos. El DNI se guarda cifrado.</span>
        </label>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!form.fullName || !form.nationalId || !form.privacyConsent}>
            Guardar cliente
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function BorrowersPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search.trim());
  const borrowers = useBorrowers(deferred);
  const [params] = useSearchParams();
  const fromRequest = params.get("nuevo");
  const [creating, setCreating] = useState(fromRequest !== null);

  return (
    <div className="stack">
      <PageHead title="Clientes" subtitle="Personas a las que les prestas. El DNI siempre se muestra enmascarado.">
        {can("borrowers:write") ? <Button onClick={() => setCreating(true)}>Nuevo cliente</Button> : null}
      </PageHead>

      <div className="field" style={{ maxWidth: 420 }}>
        <label className="sr-only" htmlFor="buscar">
          Buscar cliente
        </label>
        <input id="buscar" type="search" placeholder="Buscar por nombre, teléfono o DNI completo" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <Card>
        {borrowers.isPending ? (
          <Loading />
        ) : borrowers.isError ? (
          <ErrorNotice error={borrowers.error} />
        ) : borrowers.data.length === 0 ? (
          <EmptyState title={deferred ? "Sin resultados" : "Aún no tienes clientes"}>
            {deferred ? "Prueba con otro nombre o teléfono." : "Registra tu primer cliente para empezar."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>DNI</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                  <th>Desde</th>
                </tr>
              </thead>
              <tbody>
                {borrowers.data.map((borrower) => (
                  <tr key={borrower.id}>
                    <td>
                      <Link to={`/clientes/${borrower.id}`}>{borrower.fullName}</Link>
                    </td>
                    <td>{borrower.nationalIdMasked}</td>
                    <td>{borrower.phone ?? "—"}</td>
                    <td>
                      <Badge tone={statusTone(borrower.status)}>{labelOf(BORROWER_STATUS_LABELS, borrower.status)}</Badge>
                    </td>
                    <td>{formatDate(borrower.createdOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating ? <NewBorrowerModal onClose={() => setCreating(false)} initial={fromRequest ? { fullName: fromRequest, phone: params.get("tel") ?? "" } : undefined} /> : null}
    </div>
  );
}
