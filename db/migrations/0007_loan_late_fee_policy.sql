-- 0007_loan_late_fee_policy: cada préstamo guarda su política de mora y sus días de gracia
-- (sección 9.5 del plan). La política se guarda como datos, no como código.

ALTER TABLE loans
  ADD COLUMN late_fee_policy jsonb   NOT NULL DEFAULT '{"type":"NONE"}'::jsonb,
  ADD COLUMN grace_days      integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_loans_grace_days CHECK (grace_days >= 0),
  ADD CONSTRAINT ck_loans_late_fee_policy CHECK (
    late_fee_policy ->> 'type' IN ('NONE', 'PERCENT_OF_OVERDUE', 'FIXED_PER_DAY', 'PERCENT_PER_DAY'));
