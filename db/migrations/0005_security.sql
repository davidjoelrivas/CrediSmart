-- 0005_security: endurecimiento para una base administrada en la nube (Supabase).
--
-- Supabase publica por internet, mediante su API REST, todas las tablas del esquema `public`
-- a los roles `anon` y `authenticated`. Este sistema accede a la base SOLO desde el servidor,
-- con una conexión directa, así que ninguna tabla debe ser visible para esos roles.
--
-- 1. Se activa la seguridad por fila (RLS) en todas las tablas SIN políticas: para cualquier rol
--    que no sea el dueño de la tabla, el resultado es "negar todo". El servidor se conecta como
--    dueño y no se ve afectado.
-- 2. Se quitan todos los permisos de `anon` y `authenticated` (si existen en este servidor) y
--    se evita que las tablas futuras se los concedan por defecto.
--
-- Regla para migraciones futuras: toda tabla nueva en `public` debe activar RLS. Una prueba
-- automática falla si se olvida.

DO $$
DECLARE
  target record;
  exposed_role text;
BEGIN
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.tablename);
  END LOOP;

  FOREACH exposed_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = exposed_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', exposed_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', exposed_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', exposed_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', exposed_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', exposed_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', exposed_role);
    END IF;
  END LOOP;
END
$$;
