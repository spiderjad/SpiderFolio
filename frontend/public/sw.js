// Service worker mínimo de SpiderFolio: hace que la app se pueda instalar (PWA). No guarda nada en
// caché ni toca las respuestas: la API, la sesión y los archivos siempre van a la red. La lectura
// sin conexión es de la fase 2.
self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Sin caché: el navegador resuelve cada pedido como si no hubiera service worker.
self.addEventListener("fetch", () => undefined);
