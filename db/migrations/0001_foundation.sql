-- 0001_foundation: organizaciones y clientes (prestatarios)
-- Convenciones: ids UUID; dinero en centavos (bigint); tasas en puntos base; fechas de negocio
-- en date; instantes en timestamptz; organization_id primero en los índices.

-- Mantiene updated_at al día en las tablas que se modifican.
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TABLE organizations (
  id               uuid         PRIMARY KEY,
  name             varchar(160) NOT NULL,
  currency         char(3)      NOT NULL DEFAULT 'HNL',
  timezone         varchar(40)  NOT NULL DEFAULT 'America/Tegucigalpa',
  legal_apr_cap_bp bigint       NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_organizations_cap CHECK (legal_apr_cap_bp IS NULL OR legal_apr_cap_bp >= 0)
);
CREATE TRIGGER trg_organizations_touch BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE borrowers (
  id                 uuid         PRIMARY KEY,
  organization_id    uuid         NOT NULL REFERENCES organizations (id),
  full_name          varchar(200) NOT NULL,
  national_id_enc    bytea        NOT NULL,
  national_id_hash   char(64)     NOT NULL,
  phone              varchar(30)  NULL,
  address            varchar(300) NULL,
  status             varchar(20)  NOT NULL DEFAULT 'ACTIVE',
  privacy_consent_at timestamptz  NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_borrowers_org_idhash UNIQUE (organization_id, national_id_hash),
  CONSTRAINT ck_borrowers_status CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED'))
);
CREATE INDEX ix_borrowers_org_name ON borrowers (organization_id, full_name);
CREATE TRIGGER trg_borrowers_touch BEFORE UPDATE ON borrowers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
