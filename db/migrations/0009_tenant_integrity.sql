-- 0009_tenant_integrity: la base de datos misma impide mezclar organizaciones.
-- Hasta ahora un préstamo apuntaba a un cliente solo por su id; con estas llaves compuestas, un préstamo
-- (o una cuenta de cliente del portal) solo puede apuntar a un cliente DE SU PROPIA organización,
-- aunque algún día un error en el código se saltara la validación de la aplicación.

ALTER TABLE borrowers ADD CONSTRAINT uq_borrowers_org_id UNIQUE (organization_id, id);

ALTER TABLE loans
  ADD CONSTRAINT fk_loans_borrower_same_org
  FOREIGN KEY (organization_id, borrower_id) REFERENCES borrowers (organization_id, id);

ALTER TABLE users
  ADD CONSTRAINT fk_users_borrower_same_org
  FOREIGN KEY (organization_id, borrower_id) REFERENCES borrowers (organization_id, id);
