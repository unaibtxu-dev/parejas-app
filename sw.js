// Service worker mínimo: solo existe para que el navegador permita instalar
// la web como app ("Añadir a pantalla de inicio"). No cachea nada — los
// datos son en tiempo real vía Firebase y no tendría sentido servir algo
// viejo; el .htaccess ya controla la caché de los archivos estáticos.
self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  event.respondWith(fetch(event.request));
});

// Notificaciones push: se maneja el evento nativo directamente (sin cargar
// aquí el SDK completo de Firebase Messaging, que es pesado) — FCM manda un
// payload estándar que sirve igual leyendo el evento "push" a mano.
self.addEventListener("push", function (event) {
  var payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (err) { payload = {}; }
  var data = payload.notification || payload.data || payload;
  var title = data.title || "Gastos en Pareja";
  var options = {
    body: data.body || "",
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png"
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if ("focus" in clientList[i]) return clientList[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
