// Manda un aviso push a tu pareja cuando apuntas un gasto conjunto.
//
// Por qué esto necesita un servidor y no basta con el navegador: para enviar
// una notificación push hace falta la clave de administrador de Firebase, que
// puede leer y escribir CUALQUIER dato sin restricciones — si esa clave
// estuviera en el código del navegador, cualquiera podría copiarla y usarla
// para leer o borrar los datos de cualquiera. Por eso vive aquí, en una
// variable de entorno de Netlify, nunca en un archivo que se manda al cliente.
//
// Variable de entorno necesaria: FIREBASE_SERVICE_ACCOUNT_KEY
//   Se genera en la consola de Firebase → icono de engranaje → Configuración
//   del proyecto → pestaña "Cuentas de servicio" → "Generar nueva clave
//   privada". Descarga un archivo .json — su CONTENIDO ENTERO (tal cual, sin
//   tocar nada) es el valor de esta variable. Se pega en Netlify: panel del
//   sitio → Site configuration → Environment variables → Add a variable.

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
  });
}

const CATEGORY_LABELS = {
  comida: "🍔 Comida",
  transporte: "🚗 Transporte",
  ocio: "🎉 Ocio",
  casa: "🏠 Casa",
  salud: "💊 Salud",
  otros: "📦 Otros"
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }

  const { idToken, spaceId, amount, category, place } = body;
  if (!idToken || !spaceId) {
    return { statusCode: 400, body: "Faltan campos" };
  }

  // No nos fiamos de ningún dato que diga "soy tal persona" si no viene
  // firmado por Firebase — cualquiera podría escribir un email falso en el
  // cuerpo de la petición.
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    return { statusCode: 401, body: "Token inválido" };
  }
  const callerEmail = decoded.email;

  const db = admin.firestore();
  const spaceDoc = await db.collection("spaces").doc(spaceId).get();
  if (!spaceDoc.exists) return { statusCode: 404, body: "Espacio no encontrado" };

  const memberEmails = spaceDoc.data().memberEmails || [];
  if (!memberEmails.includes(callerEmail)) {
    return { statusCode: 403, body: "No perteneces a ese espacio" };
  }

  const recipients = memberEmails.filter(function (e) { return e !== callerEmail; });
  if (!recipients.length) {
    return { statusCode: 200, body: "Sin destinatarios (espacio personal)" };
  }

  const tokensSnap = await db.collection("push_tokens").where("email", "in", recipients).get();
  const tokens = tokensSnap.docs.map(function (d) { return d.data().token; }).filter(Boolean);
  if (!tokens.length) {
    return { statusCode: 200, body: "Tu pareja no tiene notificaciones activadas" };
  }

  const callerName = (callerEmail.split("@")[0] || "Alguien");
  const catLabel = CATEGORY_LABELS[category] || CATEGORY_LABELS.otros;
  const amountStr = (Number(amount) || 0).toFixed(2).replace(".", ",") + " €";

  const message = {
    notification: {
      title: "Nuevo gasto conjunto",
      body: callerName + " apuntó " + amountStr + " en " + catLabel + (place ? " · " + place : "")
    },
    tokens: tokens
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  // Un token deja de funcionar si desinstalan la app o revocan el permiso.
  // En vez de seguir intentando mandarle avisos para siempre, lo borramos.
  const deletions = [];
  response.responses.forEach(function (r, i) {
    if (!r.success && r.error && r.error.code === "messaging/registration-token-not-registered") {
      deletions.push(db.collection("push_tokens").doc(tokens[i]).delete());
    }
  });
  await Promise.all(deletions);

  return { statusCode: 200, body: JSON.stringify({ sent: response.successCount }) };
};
