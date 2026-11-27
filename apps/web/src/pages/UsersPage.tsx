import type { CreateUserRequest } from "@app/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge, Button, Card, ErrorNotice, Field, Loading, Modal, PageHead, useToast } from "../components/ui";
import { api } from "../lib/api";
import { ROLE_LABELS, labelOf } from "../lib/format";
import { keys, useUsers } from "../lib/queries";

function NewUserModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ role: "COLLECTOR", fullName: "", email: "", phone: "", password: "" });

  const create = useMutation({
    mutationFn: (body: CreateUserRequest) => api("/users", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.users });
      toast("Usuario creado. Entrégale su contraseña en persona.");
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate({
      role: form.role as CreateUserRequest["role"],
      fullName: form.fullName,
      email: form.email || undefined,
      phone: form.phone || undefined,
      password: form.password,
    });
  }

  return (
    <Modal title="Nuevo usuario" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {create.isError ? <ErrorNotice error={create.error} /> : null}
        <div className="form-grid">
          <Field label="Nombre completo" wide>
            {(props) => <input {...props} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />}
          </Field>
          <Field label="Rol" hint="El cobrador cobra y registra clientes. El contador solo consulta.">
            {(props) => (
              <select {...props} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                <option value="COLLECTOR">Cobrador</option>
                <option value="ACCOUNTANT">Contador</option>
                <option value="OWNER">Dueño (control total)</option>
              </select>
            )}
          </Field>
          <Field label="Correo">
            {(props) => <input {...props} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}
          </Field>
          <Field label="Teléfono" hint="Sirve para iniciar sesión si no tiene correo">
            {(props) => <input {...props} value={form.phone} inputMode="tel" onChange={(event) => setForm({ ...form, phone: event.target.value })} />}
          </Field>
          <Field label="Contraseña inicial" hint="Mínimo 10 caracteres. Que la cambie después." wide>
            {(props) => <input {...props} type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />}
          </Field>
        </div>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!form.fullName || (!form.email && !form.phone) || form.password.length < 10}>
            Crear usuario
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function UsersPage() {
  const users = useUsers();
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack">
      <PageHead title="Equipo" subtitle="Quién puede entrar al sistema y qué puede hacer.">
        <Button onClick={() => setCreating(true)}>Nuevo usuario</Button>
      </PageHead>

      <Card>
        {users.isPending ? (
          <Loading />
        ) : users.isError ? (
          <ErrorNotice error={users.error} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Acceso</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((user) => (
                  <tr key={user.id}>
                    <td>{user.fullName}</td>
                    <td>
                      <Badge tone={user.role === "OWNER" ? "info" : "neutral"}>{labelOf(ROLE_LABELS, user.role)}</Badge>
                    </td>
                    <td>{user.email ?? user.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="¿Qué puede hacer cada rol?">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Acción</th>
                <th>Dueño</th>
                <th>Cobrador</th>
                <th>Contador</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Ver tablero y préstamos", "✔", "✔", "✔"],
                ["Registrar clientes", "✔", "✔", "—"],
                ["Registrar pagos y emitir recibos", "✔", "✔", "—"],
                ["Aprobar y desembolsar préstamos", "✔", "—", "—"],
                ["Revertir pagos", "✔", "—", "—"],
                ["Ver la bitácora", "✔", "—", "✔"],
                ["Administrar usuarios", "✔", "—", "—"],
              ].map(([action, owner, collector, accountant]) => (
                <tr key={action}>
                  <td>{action}</td>
                  <td>{owner}</td>
                  <td>{collector}</td>
                  <td>{accountant}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {creating ? <NewUserModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
