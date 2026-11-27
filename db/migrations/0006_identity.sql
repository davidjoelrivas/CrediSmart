-- 0006_identity: usuarios y sesiones.
-- Las contraseñas se guardan con scrypt (nunca en texto). Las sesiones guardan solo el HASH del
-- token: si alguien copiara la base de datos no podría usar las sesiones abiertas.

CREATE TABLE users (
  id              uuid         PRIMARY KEY,
  organization_id uuid         NOT NULL REFERENCES organizations (id),
  role            varchar(20)  NOT NULL,
  full_name       varchar(160) NOT NULL,
  email           varchar(190) NULL,
  phone           varchar(30)  NULL,
  password_hash   text         NOT NULL,
  borrower_id     uuid         NULL REFERENCES borrowers (id),
  status          varchar(20)  NOT NULL DEFAULT 'ACTIVE',
  failed_logins   integer      NOT NULL DEFAULT 0,
  locked_until    timestamptz  NULL,
  last_login_at   timestamptz  NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_users_role CHECK (role IN ('OWNER', 'COLLECTOR', 'ACCOUNTANT', 'CLIENT')),
  CONSTRAINT ck_users_status CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT ck_users_identifier CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT ck_users_client_borrower CHECK ((role = 'CLIENT') = (borrower_id IS NOT NULL))
);
-- El correo y el teléfono identifican a una persona en todo el sistema (se usan para iniciar sesión).
CREATE UNIQUE INDEX uq_users_email ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_users_phone ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX ix_users_org ON users (organization_id, role);
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE sessions (
  id           uuid         PRIMARY KEY,
  user_id      uuid         NOT NULL REFERENCES users (id),
  token_hash   char(64)     NOT NULL,
  expires_at   timestamptz  NOT NULL,
  revoked_at   timestamptz  NULL,
  user_agent   varchar(200) NULL,
  ip           varchar(45)  NULL,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_sessions_token UNIQUE (token_hash)
);
CREATE INDEX ix_sessions_user ON sessions (user_id);

-- Misma regla de seguridad que el resto de las tablas (ver 0005_security.sql).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
