-- 0003_collections: pagos, su reparto entre cuotas, recibos y correlativo de folios.
-- Los pagos y sus repartos son INMUTABLES: un error se corrige con un reverso, nunca con UPDATE/DELETE.

-- Rechaza cualquier UPDATE o DELETE sobre las tablas que la usan.
CREATE FUNCTION prevent_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es inmutable: use un reverso', TG_TABLE_NAME;
END
$$;

CREATE TABLE payments (
  id                  uuid         PRIMARY KEY,
  organization_id     uuid         NOT NULL REFERENCES organizations (id),
  loan_id             uuid         NOT NULL REFERENCES loans (id),
  amount              bigint       NOT NULL,
  method              varchar(10)  NOT NULL,
  reference           varchar(80)  NULL,
  received_on         date         NOT NULL,
  received_by         uuid         NOT NULL,
  idempotency_key     varchar(80)  NOT NULL,
  reverses_payment_id uuid         NULL REFERENCES payments (id),
  reversal_reason     varchar(300) NULL,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_payments_idempotency UNIQUE (organization_id, idempotency_key),
  CONSTRAINT uq_payments_reverses UNIQUE (reverses_payment_id),
  CONSTRAINT ck_payments_method CHECK (method IN ('CASH','TRANSFER','DEPOSIT')),
  CONSTRAINT ck_payments_amount CHECK (
    (reverses_payment_id IS NULL AND amount > 0) OR
    (reverses_payment_id IS NOT NULL AND amount < 0 AND reversal_reason IS NOT NULL))
);
CREATE INDEX ix_payments_loan ON payments (organization_id, loan_id, received_on);

CREATE TABLE payment_allocations (
  payment_id         uuid    NOT NULL REFERENCES payments (id),
  installment_number integer NOT NULL,
  late_fee           bigint  NOT NULL,
  interest           bigint  NOT NULL,
  principal          bigint  NOT NULL,
  PRIMARY KEY (payment_id, installment_number),
  CONSTRAINT ck_allocations_amounts CHECK (late_fee >= 0 AND interest >= 0 AND principal >= 0)
);

CREATE TABLE receipts (
  id                uuid        PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES organizations (id),
  payment_id        uuid        NOT NULL REFERENCES payments (id),
  folio             integer     NOT NULL,
  verification_code varchar(40) NOT NULL,
  issued_on         date        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_receipts_payment UNIQUE (payment_id),
  CONSTRAINT uq_receipts_org_folio UNIQUE (organization_id, folio),
  CONSTRAINT uq_receipts_code UNIQUE (verification_code)
);

CREATE TABLE receipt_counters (
  organization_id uuid    PRIMARY KEY REFERENCES organizations (id),
  last_number     integer NOT NULL
);

CREATE TRIGGER trg_payments_immutable BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER trg_allocations_immutable BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER trg_receipts_immutable BEFORE UPDATE OR DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
