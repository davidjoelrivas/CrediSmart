-- 0002_lending: préstamos, saldos por cuota y correlativo de códigos

CREATE TABLE loans (
  id                      uuid         PRIMARY KEY,
  organization_id         uuid         NOT NULL REFERENCES organizations (id),
  borrower_id             uuid         NOT NULL REFERENCES borrowers (id),
  code                    varchar(20)  NOT NULL,
  principal               bigint       NOT NULL,
  rate_bp                 integer      NOT NULL,
  rate_period             varchar(10)  NOT NULL,
  payment_frequency       varchar(10)  NOT NULL,
  installments_count      integer      NOT NULL,
  interest_method         varchar(15)  NOT NULL DEFAULT 'FLAT',
  start_date              date         NOT NULL,
  apr_bp                  bigint       NOT NULL,
  apr_cap_override_reason varchar(300) NULL,
  status                  varchar(20)  NOT NULL,
  approved_on             date         NOT NULL,
  disbursed_on            date         NULL,
  closed_on               date         NULL,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_loans_org_code UNIQUE (organization_id, code),
  CONSTRAINT ck_loans_principal   CHECK (principal > 0),
  CONSTRAINT ck_loans_rate        CHECK (rate_bp >= 0),
  CONSTRAINT ck_loans_count       CHECK (installments_count > 0),
  CONSTRAINT ck_loans_rate_period CHECK (rate_period IN ('WEEKLY','BIWEEKLY','MONTHLY')),
  CONSTRAINT ck_loans_frequency   CHECK (payment_frequency IN ('WEEKLY','BIWEEKLY','MONTHLY')),
  CONSTRAINT ck_loans_method      CHECK (interest_method IN ('FLAT','DECLINING','INTEREST_ONLY')),
  CONSTRAINT ck_loans_status      CHECK (status IN
    ('PENDING_SIGNATURE','ACTIVE','PAID_OFF','WRITTEN_OFF','CANCELLED'))
);
CREATE INDEX ix_loans_org_status ON loans (organization_id, status);
CREATE INDEX ix_loans_org_borrower ON loans (organization_id, borrower_id);
CREATE TRIGGER trg_loans_touch BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Saldo de cada cuota: lo que se debe y lo que ya se pagó, por componente.
CREATE TABLE installments (
  loan_id          uuid    NOT NULL REFERENCES loans (id),
  number           integer NOT NULL,
  organization_id  uuid    NOT NULL,
  due_date         date    NOT NULL,
  principal_due    bigint  NOT NULL,
  interest_due     bigint  NOT NULL,
  late_fee_due     bigint  NOT NULL DEFAULT 0,
  principal_paid   bigint  NOT NULL DEFAULT 0,
  interest_paid    bigint  NOT NULL DEFAULT 0,
  late_fee_paid    bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (loan_id, number),
  CONSTRAINT ck_installments_amounts CHECK (
    principal_due >= 0 AND interest_due >= 0 AND late_fee_due >= 0 AND
    principal_paid >= 0 AND interest_paid >= 0 AND late_fee_paid >= 0 AND
    principal_paid <= principal_due AND interest_paid <= interest_due AND
    late_fee_paid <= late_fee_due)
);
CREATE INDEX ix_installments_org_due ON installments (organization_id, due_date);

-- Correlativo de códigos de préstamo por organización (PR-0001, PR-0002…).
CREATE TABLE loan_counters (
  organization_id uuid    PRIMARY KEY REFERENCES organizations (id),
  last_number     integer NOT NULL
);
