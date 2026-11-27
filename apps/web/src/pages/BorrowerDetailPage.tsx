import type { BorrowerView, UpdateBorrowerRequest } from "@app/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { LoansTable } from "../components/loan-parts";
import { Badge, Button, Card, ErrorNotice, Field, Loading, Modal, PageHead, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { BORROWER_STATUS_LABELS, formatDate, labelOf, whatsappLink } from "../lib/format";
import { useBorrower, useLoans } from "../lib/queries";
import { statusTone } from "./BorrowersPage";

function EditModal({ borrower, onClose }: { borrower: BorrowerView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    fullName: borrower.fullName,
    phone: borrower.phone ?? "",
    address: borrower.address ?? "",
    status: borrower.status,
  });

  const update = useMutation({
    mutationFn: (body: UpdateBorrowerRequest) =>
      api<{ borrower: BorrowerView }>(`/borrowers/${borrower.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      toast("Datos actualizados.");
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate({
      fullName: form.fullName,
      phone: form.phone.trim() === "" ? null : form.phone,
      address: form.address.trim() === "" ? null : form.address,
      status: form.status,
    });
  }

  return (
    <Modal title="Editar cliente" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {update.isError ? <ErrorNotice error={update.error} /> : null}
        <div className="form-grid">
          <Field label="Nombre completo" wide>
            {(props) => <input {...props} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />}
          </Field>
          <Field label="Teléfono">
            {(props) => <input {...props} value={form.phone} inputMode="tel" onChange={(event) => setForm({ ...form, phone: event.target.value })} />}
          </Field>
          <Field label="Estado" hint="Un cliente bloqueado no debería recibir nuevos préstamos">
            {(props) => (
              <select {...props} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as BorrowerView["status"] })}>
                {Object.entries(BORROWER_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Dirección" wide>
            {(props) => <input {...props} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />}
          </Field>
        </div>
        <p className="muted small">El DNI no se puede cambiar: es la identidad del cliente.</p>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={update.isPending}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function BorrowerDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const borrower = useBorrower(id);
  const loans = useLoans({ borrowerId: id });
  const [editing, setEditing] = useState(false);

  if (borrower.isPending) {
    return <Loading />;
  }
  if (borrower.isError) {
    return <ErrorNotice error={borrower.error} />;
  }
  const data = borrower.data;
  const whatsapp = whatsappLink(data.phone, `Hola ${data.fullName.split(" ")[0]}, te escribimos de parte de tu prestamista.`);

  return (
    <div className="stack">
      <PageHead
        title={data.fullName}
        subtitle={
          <>
            <Link to="/clientes">← Clientes</Link>
          </>
        }
      >
        {whatsapp ? (
          <a className="btn secondary" href={whatsapp} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        ) : null}
        {can("borrowers:write") ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Editar
          </Button>
        ) : null}
        {can("loans:approve") && data.status === "ACTIVE" ? (
          <Link className="btn accent" to={`/prestamos/nuevo?cliente=${data.id}`}>
            Nuevo préstamo
          </Link>
        ) : null}
      </PageHead>

      <div className="grid cols-2">
        <Card title="Datos del cliente">
          <dl className="kv">
            <dt>DNI</dt>
            <dd>{data.nationalIdMasked}</dd>
            <dt>Teléfono</dt>
            <dd>{data.phone ?? "—"}</dd>
            <dt>Dirección</dt>
            <dd>{data.address ?? "—"}</dd>
            <dt>Estado</dt>
            <dd>
              <Badge tone={statusTone(data.status)}>{labelOf(BORROWER_STATUS_LABELS, data.status)}</Badge>
            </dd>
            <dt>Registrado</dt>
            <dd>{formatDate(data.createdOn)}</dd>
            <dt>Aviso de privacidad</dt>
            <dd>{data.privacyConsentOn ? `Aceptado el ${formatDate(data.privacyConsentOn)}` : "Pendiente"}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Préstamos">
        {loans.isPending ? <Loading /> : loans.isError ? <ErrorNotice error={loans.error} /> : <LoansTable loans={loans.data} showBorrower={false} />}
      </Card>
      {editing ? <EditModal borrower={data} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
