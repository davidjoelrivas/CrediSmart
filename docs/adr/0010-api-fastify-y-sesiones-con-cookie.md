# Servir la API con Fastify y autenticar con sesiones en cookie HttpOnly guardadas en PostgreSQL

- **Estado:** Aceptada e implementada
- **Fecha:** 2026-11-27
- **ADR:** 0010
- **Reemplaza:** la elección de NestJS del plan inicial (solo la capa HTTP; la arquitectura hexagonal no cambia)

## Contexto

El plan original proponía NestJS para el backend. Con la presentación en una feria de tecnología a pocos días, el riesgo de NestJS pesaba más que su beneficio: decoradores, metadatos de reflexión y una configuración de compilación que el resto del monorepo (paquetes TypeScript que se ejecutan directamente) no necesita.

Toda la lógica de negocio ya vive fuera de cualquier framework: `packages/domain` (reglas financieras puras) y casos de uso en `apps/api` que solo dependen de puertos (reloj, generador de ids, unidad de trabajo, repositorios). La capa HTTP es, por diseño, una envoltura delgada.

Además hay que decidir cómo se autentica la gente (dueño, cobrador, contador y cliente del portal) sin guardar secretos en el navegador.

## Decisión

- **Fastify 5** como servidor HTTP: rápido, con validación y registros integrados, sin decoradores. Los plugins usados son oficiales: `@fastify/helmet`, `@fastify/cookie`, `@fastify/rate-limit` y `@fastify/static`.
- **Sesiones en el servidor, no JWT.** Al iniciar sesión se genera un token aleatorio de 32 bytes; en la tabla `sessions` solo se guarda su **hash SHA-256**. El token viaja en una cookie `HttpOnly`, `SameSite=Lax` y `Secure` en producción. Cerrar sesión, desactivar a un usuario o cambiar su contraseña **corta el acceso al instante**, algo que un JWT sin lista de revocación no permite.
- **Contraseñas con scrypt** (incluido en Node, sin librerías nativas que compilar), con sal propia por contraseña y parámetros guardados junto al hash para poder subirlos más adelante.
- **Bloqueo de cuenta:** 5 intentos fallidos bloquean 15 minutos; el conteo se actualiza en una sola sentencia SQL para que intentos simultáneos no se pisen. "Usuario inexistente" y "contraseña incorrecta" dan el mismo mensaje y tardan parecido.
- **Defensa contra CSRF** sin tokens adicionales: cookie `SameSite=Lax` más una comprobación de `Origin` y `Sec-Fetch-Site` en toda solicitud que modifica datos.
- **Permisos por rol** definidos en el dominio de identidad (`can(rol, permiso)`) y comprobados en cada solicitud leyendo el rol actual desde la base de datos.
- **Validación con Zod** en un paquete compartido (`@app/contracts`) que la web también usa: una sola definición de lo que la API acepta y devuelve.
- **Un solo servicio en producción:** el mismo proceso sirve la API (`/api/v1/*`) y la aplicación web compilada. Sin CORS, con una sola URL y una sola cookie.

## Consecuencias

### Positivas

- La capa HTTP se puede reemplazar (por NestJS u otro) sin tocar reglas de negocio ni casos de uso.
- Las pruebas de la API corren en milisegundos con `app.inject` y adaptadores en memoria, y las mismas rutas se prueban contra PostgreSQL real.
- Revocar sesiones es inmediato y no hay secretos de firma que rotar.

### Negativas (lo que se sacrifica)

- Cada solicitud autenticada consulta la sesión y el usuario en la base de datos (dos consultas por clave primaria o índice único). Para el volumen de un prestamista individual es irrelevante; si algún día creciera, se agrega un caché corto.
- Se pierde el ecosistema de módulos de NestJS (guards, interceptores, inyección de dependencias). Se compensa con funciones simples (`authorize(permiso)`) y composición manual en `compose-postgres.ts`.
- Una aplicación móvil nativa futura tendría que usar cookies o añadir un esquema de tokens propio.

## Alternativas consideradas

- **NestJS:** descartado por riesgo de tiempo, no por calidad.
- **JWT en `localStorage`:** descartado; cualquier fallo de XSS lo expone y no se puede revocar.
- **Proveedor externo de identidad (Auth0, Supabase Auth):** descartado; añade una dependencia más y el sistema de roles propio ya está resuelto. Se puede reevaluar si se agrega inicio de sesión con Google.
