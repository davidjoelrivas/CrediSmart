-- 0008_prescreening: precalificación de solicitantes (plan §9.10).
-- Cada organización tiene su plantilla de preguntas (versionada) y una bandeja de solicitudes que llegan
-- por un enlace público. El sistema solo ORIENTA: la decisión final es siempre de una persona y queda registrada.

-- Texto corto que identifica a la organización en su enlace público (/aplicar/mi-negocio).
ALTER TABLE organizations ADD COLUMN slug varchar(60) NULL;
ALTER TABLE organizations ADD CONSTRAINT ck_organizations_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
CREATE UNIQUE INDEX uq_organizations_slug ON organizations (slug) WHERE slug IS NOT NULL;

CREATE TABLE prescreening_forms (
  organization_id uuid        PRIMARY KEY REFERENCES organizations (id),
  version         integer     NOT NULL,
  definition      jsonb       NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_prescreening_forms_version CHECK (version >= 1)
);

CREATE TABLE prescreening_submissions (
  id                   uuid         PRIMARY KEY,
  organization_id      uuid         NOT NULL REFERENCES organizations (id),
  form_version         integer      NOT NULL,
  applicant_name       varchar(160) NOT NULL,
  phone                varchar(30)  NOT NULL,
  answers              jsonb        NOT NULL,
  outcome              varchar(20)  NOT NULL,
  score                integer      NOT NULL,
  reasons              jsonb        NOT NULL,
  status               varchar(20)  NOT NULL DEFAULT 'NEW',
  decision             varchar(20)  NULL,
  decision_note        varchar(500) NULL,
  decided_by           varchar(64)  NULL,
  decided_on           date         NULL,
  contradicts_outcome  boolean      NULL,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_prescreening_outcome CHECK (outcome IN ('APPLIES', 'REVIEW', 'NOT_APPLIES')),
  CONSTRAINT ck_prescreening_status CHECK (status IN ('NEW', 'DECIDED')),
  CONSTRAINT ck_prescreening_decision CHECK (decision IS NULL OR decision IN ('CONTINUE', 'DISCARD')),
  -- Una solicitud decidida siempre dice quién, cuándo y qué decidió.
  CONSTRAINT ck_prescreening_decided CHECK (
    (status = 'NEW' AND decision IS NULL)
    OR (status = 'DECIDED' AND decision IS NOT NULL AND decided_by IS NOT NULL AND decided_on IS NOT NULL)
  )
);
CREATE INDEX ix_prescreening_org_status ON prescreening_submissions (organization_id, status, created_at DESC);

ALTER TABLE prescreening_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescreening_submissions ENABLE ROW LEVEL SECURITY;
