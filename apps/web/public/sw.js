/* Service worker de CrediSmart.
 *
 * Qué guarda: SOLO la aplicación (pantalla principal y archivos con huella en /assets), para que abra sin internet.
 * Qué NUNCA guarda: respuestas de /api (datos de clientes, préstamos, recibos). Esos datos son personales y no deben
 * quedar en la memoria del navegador; sin internet la aplicación abre y muestra el aviso, y los cobros se guardan en una cola
 * aparte con su propia clave de idempotencia (ver offline-queue.ts).
 *
 * Al subir de versión (VERSION) se borran las memorias viejas.
 */
const VERSION = "v1";
const SHELL_CACHE = `credismart-shell-${VERSION}`;
const ASSET_CACHE = `credismart-assets-${VERSION}`;
const SHELL_URLS = ["/", "/favicon.svg", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => ![SHELL_CACHE, ASSET_CACHE].includes(name)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Solo solicitudes GET del mismo sitio. Todo lo demás (POST de cobros, otros dominios) pasa directo.
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }
  // La API nunca se guarda ni se sirve desde la memoria.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Archivos con huella (no cambian nunca): primero la memoria, luego la red.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Pantallas (navegación): primero la red para tener siempre la versión nueva; sin internet, la pantalla principal guardada.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === "/") {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || Response.error())),
    );
    return;
  }

  // Íconos y manifiesto: memoria primero.
  if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
