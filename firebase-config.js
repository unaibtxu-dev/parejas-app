// Configuración pública del cliente de Firebase para el proyecto "parejas-app-bd42e".
// Esta clave no es secreta: la seguridad real la dan las reglas de Firestore
// (ver firestore.rules.txt), no el hecho de ocultar este archivo.
(function () {
  var host = window.location.hostname;
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "";

  // authDomain: usamos NUESTRO propio dominio en producción, no
  // "parejas-app-bd42e.firebaseapp.com". Motivo: los navegadores móviles (y
  // las apps instaladas) aíslan el almacenamiento entre dominios distintos por
  // privacidad, y eso rompe el login con el error "Unable to process request
  // due to missing initial state".
  //
  // Para que esto funcione, el archivo `_redirects` reenvía internamente
  // /__/auth/* a firebaseapp.com — así el login ocurre en nuestro mismo
  // dominio y el navegador no bloquea nada.
  window.__FIREBASE_CONFIG__ = {
    apiKey: "AIzaSyD97f66U6zhBVbbd5BUxZ4nOhGGV9_bPyU",
    authDomain: isLocal ? "parejas-app-bd42e.firebaseapp.com" : host,
    projectId: "parejas-app-bd42e",
    storageBucket: "parejas-app-bd42e.firebasestorage.app",
    messagingSenderId: "587432299147",
    appId: "1:587432299147:web:bddd5f7a2ce7d73f31a28e"
  };

  // Clave pública para las notificaciones push (Web Push / VAPID). Se genera
  // en Firebase Console → Configuración del proyecto → Cloud Messaging →
  // pestaña "Configuración web" → "Generar par de claves".
  //
  // NO es secreta: viaja al navegador de todos los usuarios, así que cualquiera
  // puede leerla. Es solo la mitad pública del par — la privada se queda en
  // Firebase y es la que autoriza a enviar avisos.
  window.__FIREBASE_VAPID_KEY__ = "BFh_AHuxpyGGy0RzyWX3pIk0SboxEJABaRd0nnmcxsSz_mT1yJ64mMtgByQbx3gMW8bQVrLGZevtuVcMA0bkjrs";
})();
