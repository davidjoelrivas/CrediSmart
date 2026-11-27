import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field } from "../components/ui";
import { messageOf } from "../lib/api";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login({ login: identifier, password });
      navigate("/", { replace: true });
    } catch (caught) {
      setError(messageOf(caught));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#0f3d3e" />
            <path d="M38 20a14 14 0 1 0 0 24" fill="none" stroke="#7ee0c3" strokeWidth="7" strokeLinecap="round" />
            <circle cx="43" cy="32" r="4" fill="#7ee0c3" />
          </svg>
          CrediSmart
        </div>
        <div>
          <h1 style={{ fontSize: "1.35rem" }}>Inicia sesión</h1>
          <p className="muted">Control de préstamos, cobros y capital.</p>
        </div>
        {error ? (
          <div className="notice danger" role="alert">
            {error}
          </div>
        ) : null}
        <Field label="Correo o teléfono">
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
            />
          )}
        </Field>
        <Field label="Contraseña">
          {(props) => (
            <input
              {...props}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" loading={busy} disabled={!identifier || !password}>
          Entrar
        </Button>
        <p className="muted small">Tu sesión se cierra sola a las 12 horas y tras 5 intentos fallidos la cuenta se bloquea 15 minutos.</p>
      </form>
    </div>
  );
}
