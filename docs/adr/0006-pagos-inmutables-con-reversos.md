# Hacer inmutables los pagos, asientos y auditoría con triggers de MySQL y corregir los errores con reversos en vez de editar o borrar registros

- **Estado:** Aceptada e implementada (2026-11-27)
- **Fecha:** 2026-11-19
- **ADR:** 0006
- **Actualización (2026-11-27):** el motor es PostgreSQL y no MySQL. La decisión es la misma, pero PostgreSQL permite además seguridad por fila, que se activó en todas las tablas (migración 0005). Los triggers usan `RAISE EXCEPTION` en lugar de `SIGNAL SQLSTATE`.

## Contexto

Los pagos, los asientos contables y el registro de auditoría son la evidencia de lo que pasó con el dinero. Si se pueden editar o borrar, dejan de servir para resolver una disputa ("yo ya pagué") y la contabilidad deja de cuadrar de forma verificable.

MySQL no tiene seguridad por fila ni columnas de solo escritura. Una regla que solo vive en el código de la aplicación se puede saltar con un error, con otro módulo o con una consulta manual.

## Decisión

- **Estas tablas son de solo inserción:** `payments`, `payment_allocations`, `journal_entries`, `journal_lines` y `audit_log`.
- **Un error se corrige con un reverso:** un movimiento nuevo, enlazado al original, con motivo y autor. En contabilidad, el reverso es un asiento contrario. El original nunca cambia.
- **La garantía se refuerza en la base de datos** con triggers `BEFORE UPDATE` y `BEFORE DELETE` que lanzan `SIGNAL SQLSTATE '45000'`, además de la validación en el dominio. El borrador del esquema ya define estos triggers.
- **Los reintentos son seguros:** cada pago lleva una clave de idempotencia única por organización, y aplicar un pago bloquea la fila del préstamo dentro de una transacción.
- **El usuario de la aplicación en la base de datos tiene el mínimo privilegio:** sin `DROP` ni `TRUNCATE`, porque los triggers de fila no se disparan con esas sentencias.

## Consecuencias

### Positivas

- Cada pago y cada asiento son una prueba permanente: el historial completo se puede reconstruir.
- La garantía no depende de que todo el código de la aplicación sea correcto.
- Una corrección deja rastro de quién la hizo, cuándo y por qué, lo que sirve en una disputa.

### Negativas (lo que se sacrifica)

- **No se puede "arreglar" un registro mal digitado:** hay que registrar un reverso y luego el movimiento correcto, y eso son más pasos para el usuario.
- **Más filas y consultas más cuidadosas:** el saldo se calcula considerando los reversos, y las listas deben distinguir los movimientos anulados.
- **Más cuidado operativo:** los triggers bloquean también el mantenimiento legítimo, y limpiar datos de prueba o corregir una migración requiere un procedimiento explícito.
- **Más lógica en la base de datos:** los triggers hay que escribirlos, probarlos y versionarlos como cualquier otro código.

## Alternativas consideradas

- **Solo validación en la aplicación:** más simple, pero sin garantía frente a errores o accesos directos.
- **Borrado lógico (una marca de "anulado" que se edita):** modifica el registro original y rompe la inmutabilidad.
- **Permisos de base de datos sin triggers:** quitar `UPDATE` y `DELETE` al usuario de la aplicación es una defensa adicional válida, pero no cubre a un usuario con más privilegios. Se combina con los triggers.

## Evidencia

- **Triggers:** `prevent_modification()` y los triggers `BEFORE UPDATE OR DELETE` de `payments`, `payment_allocations`, `receipts`, `journal_entries`, `journal_lines` y `audit_log` están en las migraciones `0003_collections.sql` y `0004_accounting_and_audit.sql`.
- **Pruebas de integración contra PostgreSQL real:** `apps/api/src/integration/postgres-system.integration.test.ts` comprueba que `UPDATE` y `DELETE` sobre esas tablas fallan y que un reverso deja el saldo correcto.
- **Contabilidad que siempre cuadra:** un trigger diferido rechaza cualquier asiento cuyos débitos y créditos no sean iguales.
- **Bitácora encadenada:** cada registro guarda el hash del anterior; `GET /api/v1/audit` verifica la cadena y la pantalla de Bitácora avisa si se rompe.
