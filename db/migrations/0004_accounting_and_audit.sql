-- 0004_accounting_and_audit: libro diario de partida doble y bitácora con cadena de hashes.
-- Todo es INMUTABLE: los asientos se corrigen con reversos y la bitácora solo se agrega.

CREATE TABLE journal_entries (
  id              bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid         NOT NULL REFERENCES organizations (id),
  entry_date      date         NOT NULL,
  description     varchar(300) NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ix_journal_entries_org ON journal_entries (organization_id, id);
CREATE INDEX ix_journal_entries_org_date ON journal_entries (organization_id, entry_date);

CREATE TABLE journal_lines (
  entry_id     bigint      NOT NULL REFERENCES journal_entries (id),
  line_number  integer     NOT NULL,
  account_code varchar(10) NOT NULL,
  debit        bigint      NOT NULL DEFAULT 0,
  credit       bigint      NOT NULL DEFAULT 0,
  loan_id      uuid        NULL,
  PRIMARY KEY (entry_id, line_number),
  CONSTRAINT ck_journal_lines_one_side CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX ix_journal_lines_account ON journal_lines (account_code);
CREATE INDEX ix_journal_lines_loan ON journal_lines (loan_id);

-- La base misma garantiza que la contabilidad cuadre: al confirmar la transacción, los
-- débitos de cada asiento deben ser iguales a sus créditos. Si no, se deshace todo.
CREATE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  difference bigint;
BEGIN
  SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) INTO difference
  FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF difference <> 0 THEN
    RAISE EXCEPTION 'El asiento % no cuadra: débitos y créditos difieren en %', NEW.entry_id, difference;
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER trg_journal_lines_balanced
  AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- Cada registro de la bitácora incluye el hash del anterior: alterar el pasado rompe la cadena.
CREATE TABLE audit_log (
  id              bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid         NOT NULL REFERENCES organizations (id),
  seq             bigint       NOT NULL,
  actor_id        varchar(64)  NOT NULL,
  action          varchar(60)  NOT NULL,
  entity          varchar(40)  NOT NULL,
  entity_id       varchar(64)  NOT NULL,
  event_on        date         NOT NULL,
  details         jsonb        NOT NULL,
  prev_hash       char(64)     NOT NULL,
  row_hash        char(64)     NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_audit_org_seq UNIQUE (organization_id, seq)
);
CREATE INDEX ix_audit_entity ON audit_log (organization_id, entity, entity_id);

-- Cabeza de la cadena por organización: se bloquea para que los registros se encadenen en orden.
CREATE TABLE audit_chain_heads (
  organization_id uuid     PRIMARY KEY REFERENCES organizations (id),
  last_seq        bigint   NOT NULL,
  last_hash       char(64) NOT NULL
);

CREATE TRIGGER trg_journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER trg_journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
