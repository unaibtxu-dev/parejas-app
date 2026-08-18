(function () {
  "use strict";

  function safe(fn, name) {
    try { fn(); } catch (err) { console.error("[gastos-pareja] fallo en " + name, err); }
  }

  var CATEGORIES = [
    { key: "comida", label: "Comida", emoji: "🍔", color: "#FF6B6B" },
    { key: "transporte", label: "Transporte", emoji: "🚗", color: "#4ECDC4" },
    { key: "ocio", label: "Ocio", emoji: "🎉", color: "#FFD93D" },
    { key: "casa", label: "Casa", emoji: "🏠", color: "#6C5CE7" },
    { key: "salud", label: "Salud", emoji: "💊", color: "#00B894" },
    { key: "otros", label: "Otros", emoji: "📦", color: "#A29BFE" }
  ];
  var CATEGORY_BY_KEY = {};
  CATEGORIES.forEach(function (c) { CATEGORY_BY_KEY[c.key] = c; });

  var TYPES = [
    { key: "conjunto", label: "Conjunto", emoji: "🤝" },
    { key: "individual", label: "Individual", emoji: "🙋" }
  ];

  var GOAL_CATEGORIES = [
    { key: "viaje", label: "Viaje", emoji: "✈️" },
    { key: "general", label: "General", emoji: "🎯" }
  ];

  // A diferencia de la versión de una sola pareja, aquí NO hay emails fijos
  // escritos en el código. PARTNERS se rellena dinámicamente a partir del
  // "espacio" (state.space) de quien ha iniciado sesión — ver
  // updatePartnersFromSpace(). Siempre tiene 2 huecos: si la otra persona
  // todavía no se ha unido, el segundo hueco es un marcador de "pendiente".
  var PARTNERS = [];

  function updatePartnersFromSpace() {
    var emails = (state.space && state.space.memberEmails) || [];
    PARTNERS = emails.map(function (email) {
      var info = state.spaceMembers.find(function (m) { return m.email === email; });
      return { email: email, label: (info && info.label) || firstName(email.split("@")[0]) };
    });
    while (PARTNERS.length < 2) {
      PARTNERS.push({ email: null, label: "Tu pareja" });
    }
  }

  function partnerLabel(email) {
    var p = PARTNERS.find(function (x) { return x.email === email; });
    return p ? p.label : "Alguien";
  }

  function otherPartnerEmail(email) {
    var other = PARTNERS.find(function (x) { return x.email !== email; });
    return other ? other.email : "";
  }

  var AVATAR_EMOJIS = [
    "🦖", "🐉", "🦊", "🐨", "🐸", "🐙",
    "🦄", "🐝", "🦁", "🐧", "🦋", "🐲",
    "🧙", "🧛", "🧟", "🥷", "🤖", "👽",
    "🎃", "🦸", "🦹", "🧜", "🧞", "🐯"
  ];

  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  var state = {
    user: null,
    space: null,
    spaceMembers: [],
    allExpenses: [],
    budgets: [],
    fixedExpenses: [],
    settlements: [],
    goals: [],
    goalContributions: [],
    profiles: [],
    loans: [],
    pendingSpaceId: null,
    userSpaces: [],
    onboardingReturnTo: null,
    monthOffset: 0,
    mainTab: "conjunto",
    selectedCategory: CATEGORIES[0].key,
    selectedType: TYPES[0].key,
    selectedAffectsDebt: true,
    selectedIsTripExpense: true,
    selectedPayer: "",
    editingExpenseId: null,
    editingLoanId: null,
    selectedLoanTermUnit: "years",
    selectedLoanAddToMonthly: true,
    locatedCoords: null,
    chart: null,
    trendChart: null,
    map: null,
    mapMarkersLayer: null,
    unsubSpace: null,
    unsubSpaceMembers: null,
    unsubExpenses: null,
    unsubBudgets: null,
    unsubFixedExpenses: null,
    unsubSettlements: null,
    unsubGoals: null,
    unsubGoalContributions: null,
    unsubProfiles: null,
    unsubLoans: null,
    swRegistration: null,
    editingGoalId: null,
    selectedGoalCategory: "viaje",
    selectedGoalShared: true,
    selectedGoalAddToMonthly: true
  };

  var db, auth;
  var $ = function (id) { return document.getElementById(id); };

  function fmtMoney(n) {
    // No usamos toLocaleString: algunos navegadores no añaden el punto de
    // los miles en formato español (p. ej. "1249,00 €" en vez de "1.249,00 €").
    // Lo formateamos a mano para que salga siempre igual, en cualquier sitio.
    n = Number(n) || 0;
    var negative = n < 0;
    var fixed = Math.abs(n).toFixed(2);
    var parts = fixed.split(".");
    var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (negative ? "-" : "") + intPart + "," + parts[1] + " €";
  }

  function fmtDate(d) {
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function currentMonthDate() {
    var d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + state.monthOffset);
    return d;
  }

  function monthKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function isSameMonth(date, ref) {
    return date.getFullYear() === ref.getFullYear() && date.getMonth() === ref.getMonth();
  }

  // El aviso admite opcionalmente una acción ("Deshacer"): con los accesos
  // rápidos se apunta de un solo toque, así que hace falta una red por si
  // le das sin querer.
  function showToast(msg, actionLabel, onAction) {
    var t = $("toast");
    if (!t) return;
    var msgEl = $("toast-message");
    var actionEl = $("toast-action");
    msgEl.textContent = msg;

    actionEl.hidden = !actionLabel;
    if (actionLabel) {
      actionEl.textContent = actionLabel;
      actionEl.onclick = function () {
        t.hidden = true;
        clearTimeout(t._timer);
        if (onAction) onAction();
      };
    } else {
      actionEl.onclick = null;
    }

    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, actionLabel ? 5000 : 2600);
  }

  function firstName(name) {
    return (name || "").split(" ")[0] || "Alguien";
  }

  function randomCode(len) {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin caracteres ambiguos (0/O, 1/I)
    var out = "";
    for (var i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  // Diálogo de confirmación propio: window.confirm() no es fiable en algunos
  // navegadores/webviews de móvil (a veces no muestra nada y no hace nada al pulsar).
  function showConfirm(message) {
    return new Promise(function (resolve) {
      var dialog = $("confirm-dialog");
      var okBtn = $("confirm-ok");
      var cancelBtn = $("confirm-cancel");
      var backdrop = dialog.querySelector("[data-confirm-cancel]");
      $("confirm-message").textContent = message;
      dialog.hidden = false;

      function cleanup(result) {
        dialog.hidden = true;
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        backdrop.removeEventListener("click", onCancel);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }

      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      backdrop.addEventListener("click", onCancel);
    });
  }

  /* ============ Auth ============ */

  function initFirebase() {
    var cfg = window.__FIREBASE_CONFIG__;
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();

    auth.onAuthStateChanged(function (user) {
      if (user) {
        state.user = user;
        resolveUserSpace(user.email);
      } else {
        state.user = null;
        unsubscribeAll();
        showScreen("splash-screen");
      }
    });

    // Al volver de un login por redirección, aquí se recoge el resultado.
    // Solo sirve para poder mostrar el error si algo falló: si fue bien,
    // onAuthStateChanged ya se encarga de entrar en la app.
    auth.getRedirectResult().catch(function (err) {
      console.error(err);
      showAuthError(err);
    });
  }

  // La ventana emergente (popup) falla en móviles y en la app instalada:
  // el navegador aísla el almacenamiento y Firebase pierde el estado inicial
  // ("missing initial state"). En esos casos usamos redirección, que sí funciona.
  function prefersRedirectLogin() {
    var standalone = window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    var touchDevice = window.matchMedia("(pointer: coarse)").matches;
    return standalone || touchDevice;
  }

  function showAuthError(err) {
    var errEl = $("splash-error");
    if (!errEl) return;
    var code = err && err.code ? err.code : "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
    errEl.textContent = code === "auth/unauthorized-domain"
      ? "Este dominio no está autorizado en Firebase. Añádelo en Authentication → Settings → Dominios autorizados."
      : "No hemos podido iniciar sesión. Inténtalo otra vez.";
    errEl.hidden = false;
  }

  function signIn() {
    var provider = new firebase.auth.GoogleAuthProvider();
    var errEl = $("splash-error");
    if (errEl) errEl.hidden = true;

    if (prefersRedirectLogin()) {
      auth.signInWithRedirect(provider).catch(function (err) {
        console.error(err);
        showAuthError(err);
      });
      return;
    }

    auth.signInWithPopup(provider).catch(function (err) {
      console.error(err);
      // Si el popup se bloquea o el navegador aísla el almacenamiento,
      // reintentamos con redirección en vez de dejar al usuario atascado.
      var code = err && err.code ? err.code : "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment" ||
          code === "auth/web-storage-unsupported" || code === "auth/internal-error") {
        auth.signInWithRedirect(provider).catch(function (err2) {
          console.error(err2);
          showAuthError(err2);
        });
        return;
      }
      showAuthError(err);
    });
  }

  /* ============ Notificaciones push ============ */
  // Cuando uno apunta un gasto conjunto, el otro recibe un aviso sin tener
  // que abrir la app. El envío real lo hace una función de servidor
  // (Netlify Functions, gratis) porque hace falta una clave de administrador
  // de Firebase que nunca debe estar en el código del navegador — el cliente
  // solo pide permiso, guarda su "token" (la dirección a la que mandar avisos
  // a ESTE dispositivo) y, tras guardar un gasto, le dice al servidor "avisa
  // a mi pareja", sin saber ni poder ver el token de nadie más.

  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && !!(window.firebase && firebase.messaging);
  }

  function savePushToken(token) {
    return db.collection("push_tokens").doc(token).set({
      email: state.user.email,
      token: token,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  function updateNotificationButton() {
    var btn = $("btn-notifications");
    if (!btn) return;
    var granted = window.Notification && Notification.permission === "granted";
    btn.classList.toggle("active", granted);
    btn.title = granted ? "Notificaciones activadas" : "Activar notificaciones";
  }

  function enablePushNotifications() {
    if (!pushSupported()) {
      showToast("Tu navegador no admite notificaciones push.");
      return;
    }
    if (!window.__FIREBASE_VAPID_KEY__) {
      showToast("Notificaciones aún no configuradas del todo — falta una clave por poner.");
      return;
    }
    var btn = $("btn-notifications");
    btn.disabled = true;
    Notification.requestPermission().then(function (permission) {
      if (permission !== "granted") {
        showToast("No has dado permiso para las notificaciones.");
        throw new Error("permission-denied");
      }
      var opts = { vapidKey: window.__FIREBASE_VAPID_KEY__ };
      // Usamos NUESTRO service worker (sw.js) ya registrado, en vez de que
      // la librería registre uno propio en /firebase-messaging-sw.js — así
      // solo hay un service worker controlando la app, no dos superpuestos.
      if (state.swRegistration) opts.serviceWorkerRegistration = state.swRegistration;
      return firebase.messaging().getToken(opts);
    }).then(function (token) {
      if (!token) throw new Error("no-token");
      return savePushToken(token);
    }).then(function () {
      showToast("¡Notificaciones activadas! 🔔");
      updateNotificationButton();
    }).catch(function (err) {
      console.error(err);
    }).finally(function () {
      btn.disabled = false;
    });
  }

  function initPushNotifications() {
    var btn = $("btn-notifications");
    if (!btn) return;
    if (!pushSupported()) { btn.hidden = true; return; }
    btn.addEventListener("click", function () {
      if (window.Notification && Notification.permission === "granted") {
        showToast("Ya tienes las notificaciones activadas en este dispositivo.");
        return;
      }
      enablePushNotifications();
    });
    updateNotificationButton();
  }

  // Se llama justo después de guardar un gasto conjunto normal (no de un
  // viaje: ese caso, más raro, se deja para más adelante). Si esto falla no
  // pasa nada grave — el gasto ya se ha guardado bien, solo falta el aviso.
  function notifyPartnerOfExpense(payload) {
    if (isPersonalSpace() || payload.type !== "conjunto" || !state.user) return;
    state.user.getIdToken().then(function (idToken) {
      return fetch("/.netlify/functions/notify-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: idToken,
          spaceId: state.space.id,
          amount: payload.amount,
          category: payload.category,
          place: payload.place
        })
      });
    }).catch(function (err) {
      console.error("No se ha podido avisar a tu pareja", err);
    });
  }

  function signOut() {
    unsubscribeAll();
    state.space = null;
    state.spaceMembers = [];
    auth.signOut();
  }

  // ---- Login de pruebas, solo para desarrollo local ----
  // No hay ningún botón ni enlace a esto en la interfaz: es una función que
  // solo existe en window cuando la app corre en localhost, para poder
  // probar el flujo (crear espacios, préstamos, etc.) sin pasar por el
  // popup real de Google cada vez. En el sitio publicado (Netlify) esta
  // función ni siquiera se crea, así que no es una puerta trasera real.
  function isLocalDev() {
    return location.hostname === "localhost" || location.hostname === "127.0.0.1";
  }

  function devSignIn(email, password) {
    if (!isLocalDev()) return Promise.reject(new Error("Solo disponible en local"));
    email = email || "claude-test@parejas-app.local";
    password = password || "dev-test-1234";
    return auth.signInWithEmailAndPassword(email, password).catch(function (err) {
      if (err.code === "auth/user-not-found") {
        return auth.createUserWithEmailAndPassword(email, password);
      }
      throw err;
    });
  }

  function initDevLogin() {
    if (!isLocalDev()) return;
    window.__devLogin = devSignIn;
    window.__devSignOut = signOut;
    console.log("[dev] window.__devLogin(email?, password?) disponible en local.");
  }

  // Solo una de estas pantallas está visible a la vez: login, onboarding,
  // "espacio creado", o la app. Centralizarlo evita que se queden dos a la vez.
  function showScreen(id) {
    ["splash-screen", "onboarding-screen", "space-picker-screen", "invite-created-screen", "app"].forEach(function (s) {
      $(s).hidden = s !== id;
    });
  }

  function showApp(user) {
    showScreen("app");
    $("user-name").textContent = firstName(user.displayName) || "Hola";
    renderAvatars();
  }

  /* ============ Espacios: entrar, crear, unirse ============ */

  function unsubscribeAll() {
    [
      "unsubSpace", "unsubSpaceMembers", "unsubExpenses", "unsubBudgets", "unsubFixedExpenses",
      "unsubSettlements", "unsubGoals", "unsubGoalContributions", "unsubProfiles", "unsubLoans"
    ].forEach(function (key) {
      if (state[key]) { state[key](); state[key] = null; }
    });
  }

  // Cada email puede pertenecer a varios espacios (p. ej. uno en pareja y
  // otro personal). La lista de a qué espacios perteneces vive en
  // memberships/{email}/spaces/{spaceId} — un documento por espacio.
  function listUserSpaceIds(email) {
    return db.collection("memberships").doc(email).collection("spaces").get().then(function (snapshot) {
      return snapshot.docs.map(function (doc) { return doc.id; });
    });
  }

  function addMembership(email, spaceId) {
    return db.collection("memberships").doc(email).collection("spaces").doc(spaceId).set({
      spaceId: spaceId,
      joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // Antes de que un mismo correo pudiera tener varios espacios, la
  // pertenencia se guardaba en un único documento memberships/{email} con
  // un campo spaceId. Si alguien ya tenía uno así, lo migramos sin más a la
  // subcolección nueva en vez de dejarlo "huérfano" y mandarlo a crear otro.
  function migrateLegacyMembership(email) {
    return db.collection("memberships").doc(email).get().then(function (doc) {
      if (!doc.exists || !doc.data().spaceId) return null;
      var spaceId = doc.data().spaceId;
      return addMembership(email, spaceId).then(function () { return spaceId; });
    });
  }

  function resolveUserSpace(email) {
    listUserSpaceIds(email).then(function (spaceIds) {
      if (spaceIds.length === 1) {
        enterSpace(spaceIds[0]);
        return;
      }
      if (spaceIds.length > 1) {
        openSpacePicker(spaceIds);
        return;
      }
      return migrateLegacyMembership(email).then(function (legacySpaceId) {
        if (legacySpaceId) {
          enterSpace(legacySpaceId);
          return;
        }
        var params = new URLSearchParams(window.location.search);
        var inviteCode = params.get("invite");
        if (inviteCode) {
          joinSpaceByCode(inviteCode.trim().toUpperCase(), true);
        } else {
          showScreen("onboarding-screen");
        }
      });
    }).catch(function (err) {
      console.error(err);
      showScreen("onboarding-screen");
    });
  }

  // Pantalla de "¿cuál abrimos?" cuando el email tiene 2+ espacios. También
  // se reabre desde el botón 🔀 dentro de la app para cambiar de espacio.
  function openSpacePicker(spaceIds) {
    Promise.all(spaceIds.map(function (id) {
      return db.collection("spaces").doc(id).get().then(function (doc) {
        return doc.exists ? { id: doc.id, type: doc.data().type || "pareja", name: doc.data().name || "" } : null;
      });
    })).then(function (spaces) {
      state.userSpaces = spaces.filter(Boolean);
      renderSpacePicker();
      $("btn-cancel-space-picker").hidden = !state.space;
      showScreen("space-picker-screen");
    }).catch(function (err) {
      console.error(err);
      showToast("No se han podido cargar tus espacios.");
    });
  }

  function renderSpacePicker() {
    var wrap = $("space-picker-list");
    wrap.innerHTML = "";
    state.userSpaces.forEach(function (space) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "space-picker-item";
      var isPareja = space.type === "pareja";
      // Si le has puesto nombre, ese manda y el tipo pasa a ser el subtítulo:
      // con varios espacios del mismo tipo, "Espacio en pareja" repetido no
      // distingue nada (era justo el problema que había con tres espacios).
      var defaultTitle = isPareja ? "Espacio en pareja" : "Espacio personal";
      var typeLabel = isPareja ? "Compartido con tu pareja" : "Solo para ti";
      btn.innerHTML =
        '<span class="space-picker-emoji">' + (isPareja ? "🤝" : "🙋") + '</span>' +
        '<span class="space-picker-body">' +
        '<span class="space-picker-title">' + escapeHtml(space.name || defaultTitle) + '</span>' +
        '<span class="space-picker-sub">' + typeLabel + '</span>' +
        '</span>';
      btn.addEventListener("click", function () { enterSpace(space.id); });
      wrap.appendChild(btn);
    });
  }

  function enterSpace(spaceId) {
    if (!spaceId) {
      console.error("enterSpace() llamado sin spaceId");
      showToast("Algo ha ido mal entrando en el espacio. Recarga la página.");
      showScreen("onboarding-screen");
      return;
    }
    unsubscribeAll();
    showApp(state.user);
    subscribeSpace(spaceId);
    subscribeExpenses(spaceId);
    subscribeBudgets(spaceId);
    subscribeFixedExpenses(spaceId);
    subscribeSettlements(spaceId);
    subscribeGoals(spaceId);
    subscribeGoalContributions(spaceId);
    subscribeProfiles(spaceId);
    subscribeLoans(spaceId);
  }

  function subscribeSpace(spaceId) {
    state.unsubSpace = db.collection("spaces").doc(spaceId).onSnapshot(function (doc) {
      if (!doc.exists) return;
      var data = doc.data();
      var previousType = state.space && state.space.type;
      var type = data.type === "personal" ? "personal" : "pareja";
      state.space = { id: doc.id, memberEmails: data.memberEmails || [], inviteCode: data.inviteCode || "", type: type, name: data.name || "" };
      // La primera vez que sabemos el tipo (o si cambia), nos aseguramos de
      // estar en una pestaña válida para ese tipo de espacio.
      if (previousType !== type) {
        var validTabs = type === "personal" ? ["personal", "prestamos", "ahorros"] : ["conjunto", "personal", "deudas", "ahorros"];
        if (validTabs.indexOf(state.mainTab) === -1) {
          state.mainTab = type === "personal" ? "personal" : "conjunto";
        }
      }
      updatePartnersFromSpace();
      render();
    }, function (err) { console.error(err); });

    state.unsubSpaceMembers = db.collection("spaces").doc(spaceId).collection("members").onSnapshot(function (snapshot) {
      state.spaceMembers = snapshot.docs.map(function (doc) { return doc.data(); });
      updatePartnersFromSpace();
      render();
    }, function (err) { console.error(err); });
  }

  function writeMemberInfo(spaceId, user) {
    return db.collection("spaces").doc(spaceId).collection("members").doc(user.email).set({
      email: user.email,
      label: firstName(user.displayName),
      uid: user.uid,
      joinedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  // Nombre propio elegido a mano. Se guarda en el mismo campo "label" que ya
  // usaba PARTNERS, así que al cambiarlo se actualiza solo en todas partes:
  // gastos, deudas, presupuestos, historial de aportaciones...
  function setMyDisplayName(name) {
    return db.collection("spaces").doc(state.space.id).collection("members").doc(state.user.email).set({
      email: state.user.email,
      label: name
    }, { merge: true });
  }

  function setSpaceName(name) {
    return db.collection("spaces").doc(state.space.id).update({ name: name });
  }

  // El nombre que se ve arriba: el elegido a mano si existe, y si no el de
  // Google como antes.
  function myDisplayName() {
    if (!state.user) return "Hola";
    var mine = state.spaceMembers.find(function (m) { return m.email === state.user.email; });
    if (mine && mine.label) return mine.label;
    return firstName(state.user.displayName) || "Hola";
  }

  function createSpace(type) {
    var user = state.user;
    var spaceRef = db.collection("spaces").doc();
    var isPareja = type !== "personal";
    var code = randomCode(6);

    var nameInput = $("input-new-space-name");
    var chosenName = nameInput ? nameInput.value.trim().slice(0, 30) : "";

    var data = {
      memberEmails: [user.email],
      type: isPareja ? "pareja" : "personal",
      name: chosenName,
      createdBy: user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (isPareja) {
      data.inviteCode = code;
      data.inviteActive = true;
    }

    return spaceRef.set(data).then(function () {
      var writes = [writeMemberInfo(spaceRef.id, user), addMembership(user.email, spaceRef.id)];
      if (isPareja) writes.push(db.collection("invites").doc(code).set({ spaceId: spaceRef.id }));
      return Promise.all(writes);
    }).then(function () {
      if (isPareja) {
        showInviteCreatedScreen(spaceRef.id, code);
      } else {
        enterSpace(spaceRef.id);
      }
    });
  }

  function joinSpaceByCode(code, silentOnError) {
    var errEl = $("onboarding-error");
    if (errEl) errEl.hidden = true;
    if (!code) {
      if (errEl) { errEl.textContent = "Pon el código de invitación."; errEl.hidden = false; }
      return;
    }
    var user = state.user;

    db.collection("invites").doc(code).get().then(function (inviteDoc) {
      if (!inviteDoc.exists) throw new Error("codigo-invalido");
      var spaceId = inviteDoc.data().spaceId;
      var spaceRef = db.collection("spaces").doc(spaceId);

      return spaceRef.get().then(function (spaceDoc) {
        if (!spaceDoc.exists) throw new Error("codigo-invalido");
        var memberEmails = spaceDoc.data().memberEmails || [];
        if (memberEmails.indexOf(user.email) !== -1) {
          // ya eras miembro (p. ej. recargaste la página) — entra sin más.
          return addMembership(user.email, spaceId).then(function () {
            enterSpace(spaceId);
          });
        }
        return spaceRef.update({
          memberEmails: firebase.firestore.FieldValue.arrayUnion(user.email)
        }).then(function () {
          return Promise.all([
            writeMemberInfo(spaceId, user),
            addMembership(user.email, spaceId)
          ]);
        }).then(function () {
          enterSpace(spaceId);
          showToast("¡Os habéis unido al mismo espacio! 🎉");
        });
      });
    }).catch(function (err) {
      console.error(err);
      if (silentOnError) {
        showScreen("onboarding-screen");
        return;
      }
      if (errEl) {
        errEl.textContent = "Ese código no existe o ya no es válido.";
        errEl.hidden = false;
      }
    });
  }

  function showInviteCreatedScreen(spaceId, code) {
    // Guardamos el id aquí porque state.space todavía no existe en este punto
    // (subscribeSpace() no se ha llamado hasta que se pulsa "Continuar") — sin
    // esto, "Continuar" entraba con espacio vacío y la app se quedaba muerta.
    state.pendingSpaceId = spaceId;
    var link = window.location.origin + window.location.pathname + "?invite=" + code;
    $("invite-code-display").textContent = code;
    $("invite-link-display").textContent = link;
    showScreen("invite-created-screen");
  }

  function initOnboarding() {
    function bindCreateButton(id, type) {
      $(id).addEventListener("click", function (ev) {
        ev.target.disabled = true;
        createSpace(type).catch(function (err) {
          console.error(err);
          showToast("No se ha podido crear el espacio. Inténtalo otra vez.");
        }).finally(function () { ev.target.disabled = false; });
      });
    }
    bindCreateButton("btn-create-space-pareja", "pareja");
    bindCreateButton("btn-create-space-personal", "personal");

    $("form-join-space").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var code = $("input-join-code").value.trim().toUpperCase();
      joinSpaceByCode(code, false);
    });

    $("btn-continue-to-app").addEventListener("click", function () {
      enterSpace(state.pendingSpaceId);
    });

    function goToOnboardingFrom(returnTo) {
      state.onboardingReturnTo = returnTo; // "picker" | "app" | null
      $("btn-back-to-picker").hidden = !returnTo;
      showScreen("onboarding-screen");
    }

    $("btn-back-to-picker").addEventListener("click", function () {
      if (state.onboardingReturnTo === "picker" && state.userSpaces.length > 0) {
        renderSpacePicker();
        showScreen("space-picker-screen");
      } else if (state.onboardingReturnTo === "app" && state.space) {
        showScreen("app");
      } else {
        showScreen("splash-screen");
      }
    });

    $("btn-add-another-space").addEventListener("click", function () {
      goToOnboardingFrom("picker");
    });

    $("btn-cancel-space-picker").addEventListener("click", function () {
      if (state.space) showScreen("app");
    });

    $("btn-change-space").addEventListener("click", function () {
      if (!state.user) return;
      listUserSpaceIds(state.user.email).then(function (spaceIds) {
        if (spaceIds.length <= 1) {
          showToast("Todavía no tienes otro espacio. Crea uno nuevo.");
          goToOnboardingFrom("app");
          return;
        }
        openSpacePicker(spaceIds);
      }).catch(function (err) {
        console.error(err);
        showToast("No se han podido cargar tus espacios.");
      });
    });

    function copyInviteLink(linkText) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(linkText).then(function () {
          showToast("¡Enlace copiado! 📋");
        }).catch(function () {
          showToast("No se ha podido copiar. Cópialo a mano.");
        });
      } else {
        showToast("No se ha podido copiar. Cópialo a mano.");
      }
    }

    $("btn-copy-invite").addEventListener("click", function () {
      copyInviteLink($("invite-link-display").textContent);
    });

    $("btn-show-invite").addEventListener("click", function () {
      if (!state.space) return;
      var link = window.location.origin + window.location.pathname + "?invite=" + state.space.inviteCode;
      $("invite-view-code").textContent = state.space.inviteCode;
      $("invite-view-link").textContent = link;
      $("invite-view-dialog").hidden = false;
    });
    $("btn-copy-invite-2").addEventListener("click", function () {
      copyInviteLink($("invite-view-link").textContent);
    });
    $("invite-view-close").addEventListener("click", function () { $("invite-view-dialog").hidden = true; });
    $("invite-view-dialog").querySelector("[data-invite-cancel]").addEventListener("click", function () {
      $("invite-view-dialog").hidden = true;
    });
  }

  /* ============ Firestore: gastos ============ */

  function subscribeExpenses(spaceId) {
    state.unsubExpenses = db.collection("expenses")
      .where("spaceId", "==", spaceId)
      .limit(500)
      .onSnapshot(function (snapshot) {
        state.allExpenses = snapshot.docs.map(function (doc) {
          var data = doc.data();
          var createdAt = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : new Date();
          var expenseDate = data.expenseDate && data.expenseDate.toDate ? data.expenseDate.toDate() : createdAt;
          return {
            id: doc.id,
            amount: data.amount || 0,
            category: data.category || "otros",
            type: data.type === "individual" ? "individual" : "conjunto",
            place: data.place || "",
            note: data.note || "",
            lat: typeof data.lat === "number" ? data.lat : null,
            lng: typeof data.lng === "number" ? data.lng : null,
            uid: data.uid,
            email: data.email || "",
            displayName: data.displayName || "",
            photoURL: data.photoURL || "",
            payerEmail: data.payerEmail || data.email || "",
            affectsDebt: data.affectsDebt !== false,
            tripGoalId: data.tripGoalId || null,
            date: expenseDate
          };
        }).sort(function (a, b) { return b.date - a.date; });
        render();
      }, function (err) {
        console.error(err);
        showToast("No se han podido cargar los gastos.");
      });
  }

  function expenseFields(payload) {
    return {
      amount: payload.amount,
      category: payload.category,
      type: payload.type,
      affectsDebt: payload.affectsDebt,
      place: payload.place,
      note: payload.note,
      lat: payload.lat,
      lng: payload.lng,
      payerEmail: payload.payerEmail,
      expenseDate: payload.expenseDate,
      tripGoalId: payload.tripGoalId || null
    };
  }

  function addExpense(payload) {
    var fields = expenseFields(payload);
    fields.spaceId = state.space.id;
    fields.uid = state.user.uid;
    fields.email = state.user.email || "";
    fields.displayName = state.user.displayName || "";
    fields.photoURL = state.user.photoURL || "";
    fields.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    return db.collection("expenses").add(fields);
  }

  function updateExpense(id, payload) {
    return db.collection("expenses").doc(id).update(expenseFields(payload));
  }

  function deleteExpense(id) {
    return db.collection("expenses").doc(id).delete();
  }

  /* ============ Firestore: presupuestos ============ */

  function subscribeBudgets(spaceId) {
    state.unsubBudgets = db.collection("budgets").where("spaceId", "==", spaceId).onSnapshot(function (snapshot) {
      state.budgets = snapshot.docs.map(function (doc) { return doc.data(); });
      render();
    }, function (err) {
      console.error(err);
    });
  }

  function budgetDocId(email, mKey) {
    return email + "_" + mKey;
  }

  function setBudget(email, mKey, amount) {
    return db.collection("budgets").doc(budgetDocId(email, mKey)).set({
      spaceId: state.space.id,
      email: email,
      monthKey: mKey,
      amount: amount,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  function getBudgetAmount(email, mKey) {
    var found = state.budgets.find(function (b) { return b.email === email && b.monthKey === mKey; });
    return found ? Number(found.amount) || 0 : 0;
  }

  /* ============ Firestore: avatares ============ */

  function subscribeProfiles(spaceId) {
    state.unsubProfiles = db.collection("profiles").where("spaceId", "==", spaceId).onSnapshot(function (snapshot) {
      state.profiles = snapshot.docs.map(function (doc) { return doc.data(); });
      renderAvatars();
    }, function (err) { console.error(err); });
  }

  function setAvatar(email, emoji) {
    return db.collection("profiles").doc(email).set({
      spaceId: state.space.id,
      email: email,
      avatar: emoji,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  function getAvatar(email) {
    var found = state.profiles.find(function (p) { return p.email === email; });
    return (found && found.avatar) || "🙂";
  }

  function renderAvatars() {
    if (state.user) $("user-avatar-emoji").textContent = getAvatar(state.user.email);
    safe(renderExpenseList, "renderExpenseList");
  }

  // Se llama en cada render porque el nombre elegido a mano llega de Firestore
  // (asíncrono), después de que showApp() haya puesto el de Google.
  function renderUserName() {
    var el = $("user-name");
    if (el) el.textContent = myDisplayName();
    // Debajo del nombre se muestra en qué espacio estás — útil de verdad
    // cuando tienes varios. Si no le has puesto nombre, se queda el saludo
    // de siempre para que no haya un hueco vacío.
    var spaceEl = $("space-name-label");
    if (spaceEl) {
      var name = state.space && state.space.name;
      spaceEl.textContent = name || "¡hola! 👋";
      spaceEl.hidden = false;
    }
  }

  /* ============ Firestore: gastos fijos mensuales ============ */
  // Cosas recurrentes que se restan cada mes automáticamente (coche, ahorros,
  // dentista...) sin tener que volver a apuntarlas — se guardan una vez y
  // aplican a todos los meses hasta que se editen o se borren.

  function subscribeFixedExpenses(spaceId) {
    state.unsubFixedExpenses = db.collection("fixed_expenses").where("spaceId", "==", spaceId).onSnapshot(function (snapshot) {
      state.fixedExpenses = snapshot.docs.map(function (doc) {
        var data = doc.data();
        return {
          id: doc.id,
          email: data.email,
          label: data.label || "",
          amount: data.amount || 0,
          category: data.category === "ahorro" ? "ahorro" : "gasto"
        };
      });
      render();
    }, function (err) { console.error(err); });
  }

  function addFixedExpense(email, label, amount, category) {
    return db.collection("fixed_expenses").add({
      spaceId: state.space.id,
      email: email,
      label: label,
      amount: amount,
      category: category === "ahorro" ? "ahorro" : "gasto",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  function deleteFixedExpense(id) {
    return db.collection("fixed_expenses").doc(id).delete();
  }

  // Las cuotas de préstamo marcadas como "contar en gastos fijos" NO se
  // duplican en la colección fixed_expenses: se derivan del préstamo al
  // vuelo. Así solo hay una fuente de verdad — si editas la cuota o borras
  // el préstamo, el gasto fijo se actualiza o desaparece solo, sin quedar
  // copias huérfanas que descuadren el balance del mes.
  function loanFixedEntries(email) {
    return state.loans
      .filter(function (l) {
        if (!l.addToMonthly || l.monthlyPayment <= 0) return false;
        // Los préstamos antiguos no tenían email: se asumen del usuario.
        return !l.email || l.email === email;
      })
      .map(function (l) {
        return {
          id: "loan:" + l.id,
          email: email,
          label: l.name,
          amount: l.monthlyPayment,
          category: "gasto",
          fromLoan: true,
          loanId: l.id
        };
      });
  }

  // Igual que con los préstamos: ahorrar para una meta con fecha se puede
  // contar como gasto fijo mensual, calculado al vuelo (nunca se duplica en
  // fixed_expenses). Si la meta es compartida se reparte a la mitad entre
  // los dos; si no, va entera a quien la creó.
  function goalFixedEntries(email) {
    var entries = [];
    state.goals.forEach(function (g) {
      if (!g.addToMonthly || !g.targetDate) return;
      var monthly = goalMonthlyNeed(g);
      if (monthly <= 0) return;

      if (g.shared && !isPersonalSpace()) {
        var realPartners = PARTNERS.filter(function (p) { return p.email; });
        if (realPartners.some(function (p) { return p.email === email; })) {
          entries.push({
            id: "goal:" + g.id, email: email, label: g.name + " (mitad)",
            amount: Math.round((monthly / 2) * 100) / 100, category: "ahorro", fromGoal: true, goalId: g.id
          });
        }
      } else if (!g.email || g.email === email) {
        entries.push({
          id: "goal:" + g.id, email: email, label: g.name,
          amount: Math.round(monthly * 100) / 100, category: "ahorro", fromGoal: true, goalId: g.id
        });
      }
    });
    return entries;
  }

  function fixedExpensesFor(email) {
    var own = state.fixedExpenses.filter(function (f) { return f.email === email; });
    return own.concat(loanFixedEntries(email)).concat(goalFixedEntries(email));
  }

  function fixedExpensesTotal(email, category) {
    return fixedExpensesFor(email)
      .filter(function (f) { return !category || f.category === category; })
      .reduce(function (sum, f) { return sum + f.amount; }, 0);
  }

  /* ============ Firestore: deudas / pagos ============ */

  function subscribeSettlements(spaceId) {
    state.unsubSettlements = db.collection("settlements")
      .where("spaceId", "==", spaceId)
      .limit(200)
      .onSnapshot(function (snapshot) {
        state.settlements = snapshot.docs.map(function (doc) {
          var data = doc.data();
          var d = data.date && data.date.toDate ? data.date.toDate() : new Date();
          return { id: doc.id, payerEmail: data.payerEmail, amount: data.amount || 0, note: data.note || "", date: d };
        }).sort(function (a, b) { return b.date - a.date; });
        render();
      }, function (err) { console.error(err); });
  }

  function addSettlement(payerEmail, amount, note) {
    return db.collection("settlements").add({
      spaceId: state.space.id,
      payerEmail: payerEmail,
      amount: amount,
      note: note,
      date: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: state.user.email || ""
    });
  }

  /* ============ Firestore: metas de ahorro ============ */
  // Metas propias en vez de los dos fondos fijos de antes ("Viajes"/"Casa"):
  // cada una tiene nombre, un importe objetivo, y opcionalmente una fecha
  // (para el viaje de diciembre, cuándo empieza) y, si es de tipo viaje, un
  // desglose de hotel/transporte como ayuda para decidir el importe.

  function subscribeGoals(spaceId) {
    state.unsubGoals = db.collection("goals").where("spaceId", "==", spaceId).onSnapshot(function (snapshot) {
      state.goals = snapshot.docs.map(function (doc) {
        var data = doc.data();
        var targetDate = data.targetDate && data.targetDate.toDate ? data.targetDate.toDate() : null;
        return {
          id: doc.id,
          name: data.name || "Meta",
          category: data.category === "viaje" ? "viaje" : "general",
          targetAmount: Number(data.targetAmount) || 0,
          targetDate: targetDate,
          hotelCost: Number(data.hotelCost) || 0,
          transportCost: Number(data.transportCost) || 0,
          shared: data.shared !== false,
          addToMonthly: !!data.addToMonthly,
          email: data.email || "",
          tripActive: !!data.tripActive,
          tripBudget: Number(data.tripBudget) || 0,
          tripStartedAt: data.tripStartedAt && data.tripStartedAt.toDate ? data.tripStartedAt.toDate() : null,
          tripEndedAt: data.tripEndedAt && data.tripEndedAt.toDate ? data.tripEndedAt.toDate() : null
        };
      }).sort(function (a, b) {
        if (a.targetDate && b.targetDate) return a.targetDate - b.targetDate;
        return a.targetDate ? -1 : (b.targetDate ? 1 : 0);
      });
      render();
    }, function (err) { console.error(err); });
  }

  function goalFields(payload) {
    return {
      name: payload.name,
      category: payload.category,
      targetAmount: payload.targetAmount,
      targetDate: payload.targetDate,
      hotelCost: payload.hotelCost,
      transportCost: payload.transportCost,
      shared: payload.shared,
      addToMonthly: payload.addToMonthly
    };
  }

  function addGoal(payload) {
    var fields = goalFields(payload);
    fields.spaceId = state.space.id;
    fields.email = state.user.email || "";
    fields.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    return db.collection("goals").add(fields);
  }

  function updateGoal(id, payload) {
    return db.collection("goals").doc(id).update(goalFields(payload));
  }

  function deleteGoal(id) {
    return db.collection("goals").doc(id).delete();
  }

  // Solo puede haber un viaje activo a la vez por espacio — así el aviso
  // fijo y el interruptor del formulario de gasto no tienen que elegir entre
  // varios. Empezar otro antes de terminar el actual está bloqueado en la UI.
  function activeTrip() {
    return state.goals.find(function (g) { return g.tripActive; }) || null;
  }

  // El presupuesto real del viaje es lo que YA se ha ahorrado, no el objetivo
  // aspiracional: si ibais a 230€ pero solo hay 180€ ahorrados, el bote real
  // son 180€. Se fija en este momento para que aportaciones posteriores
  // (p. ej. si el ahorro automático sigue corriendo) no muevan la meta a
  // mitad de viaje.
  function startTrip(goalId) {
    var goal = state.goals.find(function (g) { return g.id === goalId; });
    if (!goal) return Promise.reject(new Error("meta no encontrada"));
    var budget = getGoalTotal(goalId);
    return db.collection("goals").doc(goalId).update({
      tripActive: true,
      tripBudget: budget,
      tripStartedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  function tripExpenses(goalId) {
    return state.allExpenses.filter(function (e) { return e.tripGoalId === goalId; });
  }

  function tripSpent(goalId) {
    return tripExpenses(goalId).reduce(function (sum, e) { return sum + e.amount; }, 0);
  }

  // Una meta-viaje se usa una sola vez: al terminar queda marcada como
  // cerrada para siempre (tripEndedAt) y se apaga el ahorro mensual — así no
  // hay que ponerse a "retirar" contablemente lo gastado si alguien la
  // reabriera por error. Para el siguiente viaje se crea una meta nueva.
  // Si sobró dinero del bote, se pregunta a qué otra meta se manda
  // (destinationGoalId) en vez de decidirlo la app; puede ser null para
  // dejarlo tal cual, sin mandarlo a ningún sitio.
  function endTrip(goalId, leftover, destinationGoalId) {
    var ops = [db.collection("goals").doc(goalId).update({
      tripActive: false,
      addToMonthly: false,
      tripEndedAt: firebase.firestore.FieldValue.serverTimestamp()
    })];
    if (leftover > 0.01 && destinationGoalId) {
      ops.push(addGoalContribution(destinationGoalId, Math.round(leftover * 100) / 100, "Sobrante del viaje"));
    }
    return Promise.all(ops);
  }

  function subscribeGoalContributions(spaceId) {
    state.unsubGoalContributions = db.collection("goal_contributions")
      .where("spaceId", "==", spaceId)
      .limit(400)
      .onSnapshot(function (snapshot) {
        state.goalContributions = snapshot.docs.map(function (doc) {
          var data = doc.data();
          var d = data.date && data.date.toDate ? data.date.toDate() : new Date();
          return {
            id: doc.id,
            goalId: data.goalId,
            amount: data.amount || 0,
            note: data.note || "",
            displayName: data.displayName || "",
            date: d
          };
        }).sort(function (a, b) { return b.date - a.date; });
        render();
      }, function (err) { console.error(err); });
  }

  function addGoalContribution(goalId, amount, note) {
    return db.collection("goal_contributions").add({
      spaceId: state.space.id,
      goalId: goalId,
      amount: amount,
      note: note,
      email: state.user.email || "",
      displayName: state.user.displayName || "",
      date: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  function getGoalTotal(goalId) {
    return state.goalContributions
      .filter(function (c) { return c.goalId === goalId; })
      .reduce(function (sum, c) { return sum + c.amount; }, 0);
  }

  // Cuota mensual necesaria para llegar al objetivo a tiempo, repartiendo lo
  // que falta entre los meses que quedan hasta la fecha (mínimo 1 mes, para
  // no dividir por cero si la fecha es este mismo mes o ya pasó).
  function monthsUntil(date) {
    var now = new Date();
    var months = (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
    return Math.max(1, months);
  }

  function goalMonthlyNeed(goal) {
    if (!goal.targetDate) return 0;
    var remaining = goal.targetAmount - getGoalTotal(goal.id);
    if (remaining <= 0) return 0;
    return remaining / monthsUntil(goal.targetDate);
  }

  /* ============ Firestore: préstamos (uso personal) ============ */

  function subscribeLoans(spaceId) {
    state.unsubLoans = db.collection("loans").where("spaceId", "==", spaceId).onSnapshot(function (snapshot) {
      state.loans = snapshot.docs.map(function (doc) {
        var data = doc.data();
        return {
          id: doc.id,
          name: data.name || "Préstamo",
          principal: Number(data.principal) || 0,
          originalPrincipal: Number(data.originalPrincipal) || 0,
          annualRate: Number(data.annualRate) || 0,
          monthlyPayment: Number(data.monthlyPayment) || 0,
          termMonths: Number(data.termMonths) || 0,
          paidInstallments: Number(data.paidInstallments) || 0,
          addToMonthly: data.addToMonthly !== false,
          email: data.email || ""
        };
      });
      render();
    }, function (err) { console.error(err); });
  }

  function loanFields(payload) {
    return {
      name: payload.name,
      principal: payload.principal,
      originalPrincipal: payload.originalPrincipal || 0,
      annualRate: payload.annualRate,
      monthlyPayment: payload.monthlyPayment,
      termMonths: payload.termMonths,
      paidInstallments: payload.paidInstallments,
      addToMonthly: payload.addToMonthly
    };
  }

  function addLoan(payload) {
    var fields = loanFields(payload);
    fields.spaceId = state.space.id;
    fields.email = state.user.email || "";
    fields.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    return db.collection("loans").add(fields);
  }

  function updateLoan(id, payload) {
    return db.collection("loans").doc(id).update(loanFields(payload));
  }

  function deleteLoan(id) {
    return db.collection("loans").doc(id).delete();
  }

  // Simulación mes a mes (no la fórmula cerrada) para que sea robusta ante
  // cualquier combinación de datos: si la cuota no llega a cubrir ni los
  // intereses, la deuda nunca bajaría — result.impossible avisa de eso en
  // vez de dejar el bucle corriendo para siempre. Tope de 1200 meses (100
  // años) como red de seguridad.
  var LOAN_MAX_MONTHS = 1200;

  function simulateLoan(principal, annualRatePct, monthlyPayment, extraPerMonth) {
    var monthlyRate = (annualRatePct / 100) / 12;
    var payment = monthlyPayment + (extraPerMonth || 0);
    var balance = principal;
    var months = 0;
    var totalInterest = 0;

    if (balance <= 0) return { months: 0, totalInterest: 0, totalPaid: 0, impossible: false };
    if (payment <= balance * monthlyRate) {
      return { months: null, totalInterest: null, totalPaid: null, impossible: true };
    }

    while (balance > 0.005 && months < LOAN_MAX_MONTHS) {
      var interest = balance * monthlyRate;
      var principalPaid = Math.min(payment - interest, balance);
      balance -= principalPaid;
      totalInterest += interest;
      months += 1;
    }

    return { months: months, totalInterest: totalInterest, totalPaid: principal + totalInterest, impossible: months >= LOAN_MAX_MONTHS && balance > 0.005 };
  }

  // Cuota que toca pagar para liquidar el préstamo en un plazo dado (la
  // fórmula clásica de amortización francesa). Solo se usa cuando alguien
  // sabe el plazo que firmó pero no recuerda la cuota exacta.
  function paymentForTerm(principal, annualRatePct, months) {
    if (!principal || !months || months <= 0) return 0;
    var i = (annualRatePct / 100) / 12;
    if (i <= 0) return principal / months;
    return (principal * i) / (1 - Math.pow(1 + i, -months));
  }

  // Saldo pendiente tras k cuotas de un préstamo de amortización francesa
  // (cuota fija): fórmula cerrada, la misma que usa cualquier banco. Con esto,
  // si sabes cuánto pediste, el plazo, el TIN y cuántas cuotas llevas, no
  // necesitas mirar tu app del banco para saber lo que te queda.
  function remainingBalance(originalPrincipal, annualRatePct, termMonths, paidInstallments) {
    var k = Math.min(paidInstallments, termMonths);
    var i = (annualRatePct / 100) / 12;
    if (i <= 0) return originalPrincipal * (1 - k / termMonths);
    var growth = Math.pow(1 + i, termMonths);
    var growthPaid = Math.pow(1 + i, k);
    return originalPrincipal * (growth - growthPaid) / (growth - 1);
  }

  function fmtMonths(months) {
    if (months == null) return "—";
    var years = Math.floor(months / 12);
    var rest = months % 12;
    if (years === 0) return rest + (rest === 1 ? " mes" : " meses");
    if (rest === 0) return years + (years === 1 ? " año" : " años");
    return years + (years === 1 ? " año" : " años") + " y " + rest + (rest === 1 ? " mes" : " meses");
  }

  // Los gastos de un viaje activo, mientras no superen el bote ahorrado, no
  // deben aparecer en NINGÚN cálculo normal (mes, deuda, accesos rápidos...):
  // es dinero que ya estaba apartado, no gasto nuevo del mes. El exceso sobre
  // el presupuesto sí se guarda como un gasto conjunto normal (ver
  // saveExpenseRespectingTripBudget) y por eso ese sí pasa este filtro.
  function visibleExpenses() {
    return state.allExpenses.filter(function (e) { return !e.tripGoalId; });
  }

  function debtExpenses() {
    return visibleExpenses().filter(function (e) { return e.type === "conjunto" && e.affectsDebt; });
  }

  function computeDebtHalf() {
    var totals = {};
    PARTNERS.forEach(function (p) { totals[p.email] = 0; });
    debtExpenses().forEach(function (e) {
      if (totals.hasOwnProperty(e.payerEmail)) totals[e.payerEmail] += e.amount;
    });
    var diff = totals[PARTNERS[0].email] - totals[PARTNERS[1].email];
    var half = diff / 2;
    state.settlements.forEach(function (s) {
      if (s.payerEmail === PARTNERS[0].email) half += s.amount;
      else if (s.payerEmail === PARTNERS[1].email) half -= s.amount;
    });
    return Math.round(half * 100) / 100;
  }

  /* ============ Rendering ============ */

  function expensesOfMonth() {
    var ref = currentMonthDate();
    return visibleExpenses().filter(function (e) { return isSameMonth(e.date, ref); });
  }

  function currentExpenseType() {
    return state.mainTab === "personal" ? "individual" : "conjunto";
  }

  function viewExpensesOfMonth() {
    var type = currentExpenseType();
    return expensesOfMonth().filter(function (e) { return e.type === type; });
  }

  function render() {
    if (!state.space) return;
    safe(renderMainPanels, "renderMainPanels");
    safe(renderMonthLabel, "renderMonthLabel");
    safe(renderTotal, "renderTotal");
    safe(renderQuickAdd, "renderQuickAdd");
    safe(renderChart, "renderChart");
    safe(renderTrendChart, "renderTrendChart");
    safe(renderTopPlaces, "renderTopPlaces");
    safe(renderExpenseList, "renderExpenseList");
    safe(renderMap, "renderMap");
    safe(renderBudgets, "renderBudgets");
    safe(renderDeudasPanel, "renderDeudasPanel");
    safe(renderGoals, "renderGoals");
    safe(renderLoans, "renderLoans");
    safe(renderInsights, "renderInsights");
    safe(renderFinancialPlan, "renderFinancialPlan");
    safe(renderTripBanner, "renderTripBanner");
    safe(renderUserName, "renderUserName");
  }

  function renderMainPanels() {
    var type = state.space.type === "personal" ? "personal" : "pareja";
    $("btn-show-invite").hidden = type === "personal";

    document.querySelectorAll(".main-tab-btn").forEach(function (btn) {
      var restrict = btn.dataset.spaceType;
      btn.hidden = !!restrict && restrict !== type;
      btn.classList.toggle("active", btn.dataset.maintab === state.mainTab);
    });

    var isGastos = state.mainTab === "conjunto" || state.mainTab === "personal";
    $("panel-gastos").classList.toggle("active", isGastos);
    $("panel-deudas").classList.toggle("active", state.mainTab === "deudas");
    $("panel-prestamos").classList.toggle("active", state.mainTab === "prestamos");
    $("panel-ahorros").classList.toggle("active", state.mainTab === "ahorros");
    $("fab-add").hidden = state.mainTab === "ahorros" || state.mainTab === "prestamos";

    var hello = $("personal-hello");
    if (state.mainTab === "personal" && state.user) {
      hello.hidden = false;
      $("personal-hello-name").textContent = firstName(state.user.displayName);
    } else {
      hello.hidden = true;
    }
  }

  function renderMonthLabel() {
    var d = currentMonthDate();
    var label = MESES[d.getMonth()] + " " + d.getFullYear();
    $("month-label").textContent = label;
    $("month-next").disabled = state.monthOffset >= 0;
  }

  function renderTotal() {
    var list = viewExpensesOfMonth();
    var total = list.reduce(function (sum, e) { return sum + e.amount; }, 0);
    $("total-amount").textContent = fmtMoney(total);
    $("card-total-label").textContent = state.mainTab === "personal" ? "Total personal este mes" : "Total compartido este mes";

    var byPerson = {};
    list.forEach(function (e) {
      var key = partnerLabel(e.payerEmail);
      byPerson[key] = (byPerson[key] || 0) + e.amount;
    });
    var wrap = $("total-by-person");
    wrap.innerHTML = "";
    Object.keys(byPerson).forEach(function (name) {
      var span = document.createElement("span");
      span.textContent = name + ": " + fmtMoney(byPerson[name]);
      wrap.appendChild(span);
    });
  }

  /* ============ Accesos rápidos ============ */
  // Lo que de verdad hace que se abandone una app de gastos es que apuntar
  // cansa. Aquí buscamos los gastos que ya se han repetido (mismo importe,
  // categoría y sitio) y los ofrecemos como botones de un solo toque, para
  // que un café o la compra de siempre sea un gesto y no un formulario.
  var QUICK_ADD_MAX = 6;
  var QUICK_ADD_MIN_REPEATS = 2;
  var QUICK_ADD_DAYS = 120;

  function computeQuickAdds() {
    var type = currentExpenseType();
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - QUICK_ADD_DAYS);

    var groups = {};
    visibleExpenses().forEach(function (e) {
      if (e.type !== type || e.date < cutoff) return;
      var place = (e.place || "").trim();
      var key = e.category + "|" + e.amount.toFixed(2) + "|" + place.toLowerCase();
      if (!groups[key]) {
        groups[key] = { count: 0, amount: e.amount, category: e.category, place: place, lat: null, lng: null, lastDate: e.date };
      }
      var g = groups[key];
      g.count += 1;
      // Guardamos las coordenadas del más reciente: así al repetir el gasto
      // el punto sigue apareciendo en el mapa sin tener que dar permiso otra vez.
      if (e.date >= g.lastDate) {
        g.lastDate = e.date;
        if (e.lat != null && e.lng != null) { g.lat = e.lat; g.lng = e.lng; }
      }
    });

    return Object.keys(groups)
      .map(function (k) { return groups[k]; })
      .filter(function (g) { return g.count >= QUICK_ADD_MIN_REPEATS; })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return b.lastDate - a.lastDate;
      })
      .slice(0, QUICK_ADD_MAX);
  }

  function quickAddExpense(item) {
    return addExpense({
      amount: item.amount,
      category: item.category,
      type: currentExpenseType(),
      affectsDebt: true,
      payerEmail: state.user ? state.user.email : "",
      place: item.place,
      note: "",
      lat: item.lat,
      lng: item.lng,
      expenseDate: new Date()
    });
  }

  function renderQuickAdd() {
    var card = $("quick-add-card");
    if (!card) return;

    var isGastos = state.mainTab === "conjunto" || state.mainTab === "personal";
    if (!isGastos) { card.hidden = true; return; }

    var items = computeQuickAdds();
    card.hidden = items.length === 0;
    if (card.hidden) return;

    var wrap = $("quick-add-list");
    wrap.innerHTML = "";

    items.forEach(function (item) {
      var cat = CATEGORY_BY_KEY[item.category] || CATEGORY_BY_KEY.otros;
      var label = item.place || cat.label;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quick-add-chip";
      btn.innerHTML =
        '<span class="qa-emoji">' + cat.emoji + '</span>' +
        '<span class="qa-body"><span class="qa-label">' + escapeHtml(label) + '</span>' +
        '<span class="qa-amount">' + fmtMoney(item.amount) + '</span></span>';

      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        btn.disabled = true;
        quickAddExpense(item).then(function (ref) {
          showToast(label + " · " + fmtMoney(item.amount) + " apuntado", "Deshacer", function () {
            deleteExpense(ref.id).then(function () {
              showToast("Deshecho.");
            }).catch(function (err) {
              console.error(err);
              showToast("No se ha podido deshacer.");
            });
          });
        }).catch(function (err) {
          console.error(err);
          showToast("No se ha podido apuntar. Inténtalo otra vez.");
        }).finally(function () {
          btn.disabled = false;
        });
      });

      wrap.appendChild(btn);
    });
  }

  function renderChart() {
    var list = viewExpensesOfMonth();
    var totals = {};
    CATEGORIES.forEach(function (c) { totals[c.key] = 0; });
    list.forEach(function (e) { totals[e.category] = (totals[e.category] || 0) + e.amount; });

    var hasData = list.length > 0;
    $("chart-empty").hidden = hasData;

    var labels = [], data = [], colors = [];
    CATEGORIES.forEach(function (c) {
      if (totals[c.key] > 0) {
        labels.push(c.emoji + " " + c.label);
        data.push(totals[c.key]);
        colors.push(c.color);
      }
    });

    var ctx = $("category-chart").getContext("2d");
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    if (!hasData || typeof Chart === "undefined") return;

    state.chart = new Chart(ctx, {
      type: "doughnut",
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 3, borderColor: "#fff" }] },
      options: {
        cutout: "62%",
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (item) { return item.label + ": " + fmtMoney(item.raw); } } } },
        animation: { duration: 500 }
      }
    });

    var legend = $("category-legend");
    legend.innerHTML = "";
    CATEGORIES.forEach(function (c) {
      if (totals[c.key] <= 0) return;
      var li = document.createElement("li");
      li.innerHTML = '<span class="dot" style="background:' + c.color + '"></span>' + c.emoji + " " + c.label + " · " + fmtMoney(totals[c.key]);
      legend.appendChild(li);
    });
  }

  function renderTrendChart() {
    var canvas = $("trend-chart");
    if (!canvas || typeof Chart === "undefined") return;

    var type = currentExpenseType();
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      months.push(d);
    }
    var totals = months.map(function (m) {
      return state.allExpenses
        .filter(function (e) { return e.type === type && isSameMonth(e.date, m); })
        .reduce(function (sum, e) { return sum + e.amount; }, 0);
    });
    var labels = months.map(function (m) {
      return MESES[m.getMonth()].slice(0, 3) + " " + String(m.getFullYear()).slice(2);
    });

    var ctx = canvas.getContext("2d");
    if (state.trendChart) { state.trendChart.destroy(); state.trendChart = null; }

    state.trendChart = new Chart(ctx, {
      type: "bar",
      data: { labels: labels, datasets: [{ data: totals, backgroundColor: "#6C5CE7", borderRadius: 8, maxBarThickness: 36 }] },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (item) { return fmtMoney(item.raw); } } }
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: function (v) { return v + "€"; } } }
        },
        animation: { duration: 400 }
      }
    });
  }

  function renderTopPlaces() {
    var list = viewExpensesOfMonth();
    var byPlace = {};
    list.forEach(function (e) {
      if (!e.place) return;
      if (!byPlace[e.place]) byPlace[e.place] = { total: 0, count: 0, category: e.category };
      byPlace[e.place].total += e.amount;
      byPlace[e.place].count += 1;
    });
    var entries = Object.keys(byPlace).map(function (name) {
      return { name: name, total: byPlace[name].total, count: byPlace[name].count, category: byPlace[name].category };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 8);

    var ul = $("top-places");
    ul.innerHTML = "";
    if (entries.length === 0) {
      ul.innerHTML = '<li class="empty-hint">Aún no hay sitios registrados.</li>';
      return;
    }
    entries.forEach(function (e) {
      var cat = CATEGORY_BY_KEY[e.category] || CATEGORIES[5];
      var li = document.createElement("li");
      li.innerHTML =
        '<span class="li-icon" style="background:' + cat.color + '22">' + cat.emoji + '</span>' +
        '<span class="li-body"><span class="li-title">' + escapeHtml(e.name) + '</span>' +
        '<span class="li-sub">' + e.count + (e.count === 1 ? " gasto" : " gastos") + '</span></span>' +
        '<span class="li-amount">' + fmtMoney(e.total) + '</span>';
      ul.appendChild(li);
    });
  }

  function renderExpenseList() {
    var list = viewExpensesOfMonth();
    var ul = $("expense-list");
    ul.innerHTML = "";
    if (list.length === 0) {
      ul.innerHTML = '<li class="empty-hint">Aún no hay gastos este mes.</li>';
      return;
    }
    list.forEach(function (e) {
      var cat = CATEGORY_BY_KEY[e.category] || CATEGORIES[5];
      var li = document.createElement("li");
      li.dataset.id = e.id;
      var sub = partnerLabel(e.payerEmail) + " · " + fmtDate(e.date) + (e.place ? " · " + escapeHtml(e.place) : "");
      li.innerHTML =
        '<span class="li-icon" style="background:' + cat.color + '22">' + cat.emoji + '</span>' +
        '<span class="li-avatar" title="' + escapeHtml(partnerLabel(e.payerEmail)) + '">' + getAvatar(e.payerEmail) + '</span>' +
        '<span class="li-body"><span class="li-title">' + (escapeHtml(e.note) || cat.label) + '</span>' +
        '<span class="li-sub">' + sub + '</span></span>' +
        '<span class="li-amount">' + fmtMoney(e.amount) + '</span>' +
        '<span class="li-actions">' +
        '<button type="button" class="li-action-btn" data-action="edit" title="Editar">✏️</button>' +
        '<button type="button" class="li-action-btn" data-action="delete" title="Eliminar">🗑️</button>' +
        '</span>';
      ul.appendChild(li);
    });
  }

  function initExpenseListActions() {
    $("expense-list").addEventListener("click", function (ev) {
      var btn = ev.target.closest(".li-action-btn");
      if (!btn) return;
      var li = ev.target.closest("li");
      var id = li && li.dataset.id;
      if (!id) return;
      var expense = state.allExpenses.find(function (e) { return e.id === id; });
      if (!expense) return;

      if (btn.dataset.action === "delete") {
        showConfirm("¿Eliminar este gasto de " + fmtMoney(expense.amount) + "?").then(function (ok) {
          if (!ok) return;
          deleteExpense(id).then(function () {
            showToast("Gasto eliminado.");
          }).catch(function (err) {
            console.error(err);
            showToast("No se ha podido eliminar.");
          });
        });
      } else if (btn.dataset.action === "edit") {
        openModalForEdit(expense);
      }
    });
  }

  function mapPoints() {
    return viewExpensesOfMonth().filter(function (e) { return e.lat != null && e.lng != null; });
  }

  // Enlace a Google Maps sin clave de API ni facturación: es el formato de
  // URL público que Google documenta, así que abre la app de Google Maps del
  // móvil (con indicaciones, fotos, reseñas...) sin que nos cueste nada ni
  // tengamos que meter tarjeta en Google Cloud.
  function googleMapsUrl(lat, lng) {
    return "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lng;
  }

  // Vuelve a encajar el mapa en los puntos reales. Se llama tanto al pintar
  // como cada vez que se abre la pestaña Mapa — así, si alguien arrastra el
  // mapa sin querer (p. ej. al hacer scroll de la página con el dedo encima),
  // se auto-corrige la próxima vez que lo mires en vez de quedarse perdido.
  function fitMapToPoints() {
    if (!state.map) return;
    var points = mapPoints();
    if (points.length === 0) {
      state.map.setView([40.4168, -3.7038], 5);
      return;
    }
    var bounds = L.latLngBounds(points.map(function (e) { return [e.lat, e.lng]; }));
    state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }

  function renderMap() {
    if (typeof L === "undefined") return;
    var mapEl = $("map");
    if (!mapEl) return;

    if (!state.map) {
      state.map = L.map("map", { scrollWheelZoom: false }).setView([40.4168, -3.7038], 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19
      }).addTo(state.map);
      state.mapMarkersLayer = L.layerGroup().addTo(state.map);
    }

    state.mapMarkersLayer.clearLayers();
    var points = mapPoints();

    points.forEach(function (e) {
      var cat = CATEGORY_BY_KEY[e.category] || CATEGORIES[5];
      var marker = L.circleMarker([e.lat, e.lng], {
        radius: 10,
        color: "#fff",
        weight: 2,
        fillColor: cat.color,
        fillOpacity: 0.9
      });
      marker.bindPopup(
        "<strong>" + cat.emoji + " " + (escapeHtml(e.place) || cat.label) + "</strong><br>" +
        fmtMoney(e.amount) + " · " + fmtDate(e.date) +
        '<br><a class="popup-gmaps-link" href="' + googleMapsUrl(e.lat, e.lng) + '" target="_blank" rel="noopener">Abrir en Google Maps ↗</a>'
      );
      marker.on("click", function () { marker.openPopup(); });
      marker.addTo(state.mapMarkersLayer);
    });

    fitMapToPoints();

    setTimeout(function () { if (state.map) state.map.invalidateSize(); }, 200);
  }

  function renderDeudasPanel() {
    if (state.mainTab !== "deudas") return;

    var half = computeDebtHalf();
    var textEl = $("debt-text");
    if (Math.abs(half) < 0.01) {
      textEl.textContent = "Estáis en paz 🎉";
      textEl.className = "debt-text settled";
    } else if (half > 0) {
      textEl.textContent = PARTNERS[1].label + " le debe " + fmtMoney(half) + " a " + PARTNERS[0].label;
      textEl.className = "debt-text owed";
    } else {
      textEl.textContent = PARTNERS[0].label + " le debe " + fmtMoney(-half) + " a " + PARTNERS[1].label;
      textEl.className = "debt-text owed";
    }

    var totals = {};
    PARTNERS.forEach(function (p) { totals[p.email] = 0; });
    debtExpenses().forEach(function (e) {
      if (totals.hasOwnProperty(e.payerEmail)) totals[e.payerEmail] += e.amount;
    });
    $("debt-paid-summary").textContent =
      PARTNERS[0].label + " ha pagado " + fmtMoney(totals[PARTNERS[0].email]) + " que cuenta para la deuda · " +
      PARTNERS[1].label + " ha pagado " + fmtMoney(totals[PARTNERS[1].email]) + " que cuenta para la deuda";

    $("btn-settle-up").hidden = Math.abs(half) < 0.01;

    var ul = $("settlement-list");
    ul.innerHTML = "";
    if (state.settlements.length === 0) {
      ul.innerHTML = '<li class="empty-hint">Todavía no habéis saldado cuentas.</li>';
      return;
    }
    state.settlements.forEach(function (s) {
      var li = document.createElement("li");
      li.innerHTML =
        '<span class="li-icon" style="background:var(--line)">✅</span>' +
        '<span class="li-body"><span class="li-title">' + escapeHtml(partnerLabel(s.payerEmail)) + ' pagó a ' + escapeHtml(partnerLabel(otherPartnerEmail(s.payerEmail))) + '</span>' +
        '<span class="li-sub">' + fmtDate(s.date) + '</span></span>' +
        '<span class="li-amount">' + fmtMoney(s.amount) + '</span>';
      ul.appendChild(li);
    });
  }

  /* ============ Modal de meta ============ */

  function initGoalCategoryPicker() {
    var wrap = $("goal-category-picker");
    wrap.innerHTML = "";
    GOAL_CATEGORIES.forEach(function (c) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (c.key === state.selectedGoalCategory ? " selected" : "");
      btn.dataset.key = c.key;
      btn.innerHTML = '<span class="emoji">' + c.emoji + '</span>' + c.label;
      btn.addEventListener("click", function () {
        state.selectedGoalCategory = c.key;
        wrap.querySelectorAll(".type-chip").forEach(function (el) {
          el.classList.toggle("selected", el.dataset.key === c.key);
        });
        updateGoalTripFieldsVisibility();
      });
      wrap.appendChild(btn);
    });
  }

  function updateGoalTripFieldsVisibility() {
    $("goal-trip-fields").hidden = state.selectedGoalCategory !== "viaje";
  }

  function initGoalSharedPicker() {
    var wrap = $("goal-shared-picker");
    wrap.innerHTML = "";
    [{ key: true, label: "Sí, a la mitad" }, { key: false, label: "No, solo yo" }].forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (opt.key === state.selectedGoalShared ? " selected" : "");
      btn.dataset.key = String(opt.key);
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        state.selectedGoalShared = opt.key;
        wrap.querySelectorAll(".type-chip").forEach(function (el) {
          el.classList.toggle("selected", el.dataset.key === String(opt.key));
        });
      });
      wrap.appendChild(btn);
    });
    // En un espacio personal no hay con quién compartirla.
    $("goal-shared-field").hidden = isPersonalSpace();
  }

  function initGoalMonthlyPicker() {
    var wrap = $("goal-monthly-picker");
    wrap.innerHTML = "";
    [{ key: true, label: "Sí, réstalo" }, { key: false, label: "No" }].forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (opt.key === state.selectedGoalAddToMonthly ? " selected" : "");
      btn.dataset.key = String(opt.key);
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        state.selectedGoalAddToMonthly = opt.key;
        wrap.querySelectorAll(".type-chip").forEach(function (el) {
          el.classList.toggle("selected", el.dataset.key === String(opt.key));
        });
      });
      wrap.appendChild(btn);
    });
  }

  function dateInputToDate(value) {
    if (!value) return null;
    var parts = value.split("-");
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function dateToDateInput(d) {
    if (!d) return "";
    var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function openGoalModalForCreate() {
    state.editingGoalId = null;
    $("form-goal").reset();
    state.selectedGoalCategory = "viaje";
    state.selectedGoalShared = !isPersonalSpace();
    state.selectedGoalAddToMonthly = true;
    initGoalCategoryPicker();
    initGoalSharedPicker();
    initGoalMonthlyPicker();
    updateGoalTripFieldsVisibility();
    $("modal-goal-title").textContent = "Nueva meta";
    $("btn-save-goal").textContent = "Guardar meta";
    $("modal-goal").hidden = false;
    setTimeout(function () { $("input-goal-name").focus(); }, 250);
  }

  function openGoalModalForEdit(g) {
    state.editingGoalId = g.id;
    $("input-goal-name").value = g.name;
    $("input-goal-date").value = dateToDateInput(g.targetDate);
    $("input-goal-hotel").value = g.hotelCost || "";
    $("input-goal-transport").value = g.transportCost || "";
    $("input-goal-amount").value = g.targetAmount || "";
    state.selectedGoalCategory = g.category;
    state.selectedGoalShared = g.shared;
    state.selectedGoalAddToMonthly = g.addToMonthly;
    initGoalCategoryPicker();
    initGoalSharedPicker();
    initGoalMonthlyPicker();
    updateGoalTripFieldsVisibility();
    $("modal-goal-title").textContent = "Editar meta";
    $("btn-save-goal").textContent = "Guardar cambios";
    $("modal-goal").hidden = false;
  }

  function closeGoalModal() {
    $("modal-goal").hidden = true;
    state.editingGoalId = null;
  }

  function initGoalModal() {
    $("btn-add-goal").addEventListener("click", openGoalModalForCreate);
    document.querySelectorAll("[data-close-goal]").forEach(function (el) {
      el.addEventListener("click", closeGoalModal);
    });

    $("form-goal").addEventListener("submit", function (ev) {
      ev.preventDefault();

      var hotelCost = Math.round((parseFloat($("input-goal-hotel").value) || 0) * 100) / 100;
      var transportCost = Math.round((parseFloat($("input-goal-transport").value) || 0) * 100) / 100;
      var targetAmount = Math.round((parseFloat($("input-goal-amount").value) || 0) * 100) / 100;

      // Sin importe puesto pero con hotel/transporte: se suman como sugerencia.
      var amountFromBreakdown = false;
      if (targetAmount <= 0 && (hotelCost > 0 || transportCost > 0)) {
        targetAmount = Math.round((hotelCost + transportCost) * 100) / 100;
        amountFromBreakdown = true;
      }

      var name = $("input-goal-name").value.trim();
      if (!name) { showToast("Ponle un nombre a la meta."); return; }

      var payload = {
        name: name,
        category: state.selectedGoalCategory,
        targetAmount: targetAmount,
        targetDate: dateInputToDate($("input-goal-date").value),
        hotelCost: hotelCost,
        transportCost: transportCost,
        shared: isPersonalSpace() ? false : state.selectedGoalShared,
        addToMonthly: state.selectedGoalAddToMonthly
      };

      if (payload.addToMonthly && !payload.targetDate) {
        showToast("Para restarlo de tus gastos fijos necesitamos una fecha, si no no sabemos en cuántos meses repartirlo.");
        return;
      }

      var isEditing = !!state.editingGoalId;
      var saveBtn = $("btn-save-goal");
      saveBtn.disabled = true;
      var op = isEditing ? updateGoal(state.editingGoalId, payload) : addGoal(payload);
      op.then(function () {
        closeGoalModal();
        showToast(amountFromBreakdown
          ? "Objetivo calculado: " + fmtMoney(payload.targetAmount)
          : (isEditing ? "¡Cambios guardados! 🎉" : "¡Meta creada! 🎉"));
      }).catch(function (err) {
        console.error(err);
        showToast("No se ha podido guardar. Inténtalo otra vez.");
      }).finally(function () {
        saveBtn.disabled = false;
      });
    });
  }

  /* ============ Modal: terminar viaje ============ */

  var endTripContext = { goalId: null, leftover: 0, destinationId: null };

  function openEndTripModal(goal) {
    var spent = tripSpent(goal.id);
    var leftover = Math.round(Math.max(0, goal.tripBudget - spent) * 100) / 100;
    endTripContext = { goalId: goal.id, leftover: leftover, destinationId: null };

    $("end-trip-summary").textContent = leftover > 0.01
      ? "Habéis gastado " + fmtMoney(spent) + " de los " + fmtMoney(goal.tripBudget) + " del bote. Sobran " + fmtMoney(leftover) + "."
      : "Habéis gastado " + fmtMoney(spent) + " de los " + fmtMoney(goal.tripBudget) + " del bote.";

    var otherGoals = state.goals.filter(function (g) { return g.id !== goal.id; });
    var block = $("end-trip-leftover-block");
    block.hidden = leftover <= 0.01 || otherGoals.length === 0;

    if (!block.hidden) {
      var list = $("end-trip-destination-list");
      list.innerHTML = "";
      otherGoals.forEach(function (g) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "space-picker-item";
        btn.innerHTML = '<span class="space-picker-emoji">' + (g.category === "viaje" ? "✈️" : "🎯") + '</span>' +
          '<span class="space-picker-body"><span class="space-picker-title">' + escapeHtml(g.name) + '</span></span>';
        btn.addEventListener("click", function () {
          endTripContext.destinationId = g.id;
          list.querySelectorAll(".space-picker-item").forEach(function (el) { el.classList.remove("selected"); });
          btn.classList.add("selected");
        });
        list.appendChild(btn);
      });
    }

    $("end-trip-dialog").hidden = false;
  }

  function closeEndTripModal() {
    $("end-trip-dialog").hidden = true;
  }

  function initEndTripDialog() {
    $("end-trip-cancel").addEventListener("click", closeEndTripModal);
    $("end-trip-dialog").querySelector("[data-end-trip-cancel]").addEventListener("click", closeEndTripModal);

    $("end-trip-confirm").addEventListener("click", function () {
      if (!endTripContext.goalId) return;
      var btn = $("end-trip-confirm");
      btn.disabled = true;
      endTrip(endTripContext.goalId, endTripContext.leftover, endTripContext.destinationId).then(function () {
        closeEndTripModal();
        showToast(endTripContext.destinationId ? "¡Viaje terminado! Sobrante enviado. 🎉" : "¡Viaje terminado! 🎉");
      }).catch(function (err) {
        console.error(err);
        showToast("No se ha podido terminar el viaje.");
      }).finally(function () {
        btn.disabled = false;
      });
    });
  }

  /* ============ Aviso fijo de viaje activo ============ */

  function renderTripBanner() {
    var banner = $("trip-banner");
    if (!banner) return;
    var trip = state.space ? activeTrip() : null;
    banner.hidden = !trip;
    if (!trip) return;
    var spent = tripSpent(trip.id);
    $("trip-banner-text").textContent = trip.name + " · " + fmtMoney(spent) + " de " + fmtMoney(trip.tripBudget);
  }

  function initTripBanner() {
    $("btn-end-trip").addEventListener("click", function () {
      var trip = activeTrip();
      if (trip) openEndTripModal(trip);
    });
  }

  function fmtGoalDate(d) {
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  }

  function daysUntil(date) {
    var ms = date - new Date();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }

  function renderGoals() {
    if (state.mainTab !== "ahorros") return;
    var wrap = $("goals-list");
    wrap.innerHTML = "";

    if (state.goals.length === 0) {
      wrap.innerHTML = '<p class="empty-hint">Todavía no has creado ninguna meta.</p>';
      return;
    }

    state.goals.forEach(function (g) {
      var total = getGoalTotal(g.id);
      var goal = g.targetAmount;
      var pct = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;
      var history = state.goalContributions.filter(function (c) { return c.goalId === g.id; }).slice(0, 6);
      var cat = GOAL_CATEGORIES.find(function (c) { return c.key === g.category; }) || GOAL_CATEGORIES[1];
      var monthlyNeed = g.addToMonthly ? goalMonthlyNeed(g) : 0;

      var countdown = "";
      if (g.targetDate) {
        var days = daysUntil(g.targetDate);
        countdown = days > 0
          ? "Empieza el " + fmtGoalDate(g.targetDate) + " · faltan " + days + (days === 1 ? " día" : " días")
          : (days === 0 ? "¡Es hoy! 🎉" : "Ya pasó (" + fmtGoalDate(g.targetDate) + ")");
      }

      var breakdown = "";
      if (g.category === "viaje" && (g.hotelCost > 0 || g.transportCost > 0)) {
        breakdown = '<p class="goal-breakdown">' +
          (g.hotelCost > 0 ? '🏨 Hotel: ' + fmtMoney(g.hotelCost) + '  ' : '') +
          (g.transportCost > 0 ? '✈️ Transporte: ' + fmtMoney(g.transportCost) : '') +
          '</p>';
      }

      // Botón/estado del modo viaje: no empezado, en curso, o ya terminado.
      var tripBlock = "";
      if (g.category === "viaje") {
        if (g.tripActive) {
          var spent = tripSpent(g.id);
          var tpct = g.tripBudget > 0 ? Math.min(100, Math.round((spent / g.tripBudget) * 100)) : 0;
          tripBlock = '<div class="trip-status-block">' +
            '<p class="trip-status-title">✈️ Viaje en curso</p>' +
            '<div class="fund-progress-track"><div class="fund-progress-fill ' + (spent > g.tripBudget ? "over" : "") + '" style="width:' + tpct + '%"></div></div>' +
            '<p class="fund-goal-text">Gastado ' + fmtMoney(spent) + ' de ' + fmtMoney(g.tripBudget) +
            (spent > g.tripBudget ? ' — el exceso ya se ha repartido como gasto conjunto' : '') + '</p>' +
            '<button type="button" class="btn-secondary goal-end-trip" data-id="' + g.id + '">Terminar viaje</button>' +
            '</div>';
        } else if (g.tripEndedAt) {
          tripBlock = '<p class="trip-status-title done">✅ Viaje terminado · gastasteis ' + fmtMoney(tripSpent(g.id)) + ' de ' + fmtMoney(g.tripBudget) + '</p>';
        } else {
          var blockedByOther = activeTrip() && activeTrip().id !== g.id;
          tripBlock = '<button type="button" class="btn-secondary goal-start-trip" data-id="' + g.id + '"' +
            (blockedByOther ? ' disabled title="Termina primero el otro viaje que tienes en curso"' : '') + '>✈️ Empezar viaje</button>';
        }
      }

      var card = document.createElement("section");
      card.className = "card fund-card";
      card.innerHTML =
        '<div class="fund-header">' +
        '<span class="fund-emoji">' + cat.emoji + '</span><span class="fund-name">' + escapeHtml(g.name) + '</span>' +
        '<div class="loan-card-actions">' +
        '<button type="button" class="li-action-btn goal-edit" data-id="' + g.id + '" title="Editar">✏️</button>' +
        '<button type="button" class="li-action-btn goal-delete" data-id="' + g.id + '" title="Eliminar">🗑️</button>' +
        '</div></div>' +
        (countdown ? '<p class="goal-countdown">' + countdown + '</p>' : '') +
        '<div class="fund-total">' + fmtMoney(total) + '</div>' +
        (goal > 0
          ? '<div class="fund-progress-track"><div class="fund-progress-fill" style="width:' + pct + '%"></div></div>' +
            '<p class="fund-goal-text">' + (total >= goal ? "¡Objetivo conseguido! 🎉" : "Os faltan " + fmtMoney(goal - total) + " para llegar a " + fmtMoney(goal)) + '</p>'
          : '<p class="fund-goal-text">Todavía sin importe objetivo.</p>') +
        breakdown +
        tripBlock +
        (monthlyNeed > 0
          ? '<p class="goal-monthly-note">🔒 Ahorrando ' + fmtMoney(g.shared ? monthlyNeed / 2 : monthlyNeed) +
            (g.shared ? '/mes cada uno' : '/mes') + ' en tus gastos fijos para llegar a tiempo.</p>'
          : (g.addToMonthly && !g.targetDate ? '<p class="goal-monthly-note warn">Ponle una fecha para calcular cuánto ahorrar cada mes.</p>' : '')) +
        '<form class="fund-contribute-form" data-goal="' + g.id + '">' +
        '<input type="number" min="0" step="0.01" class="fund-amount-input" placeholder="Cantidad" required>' +
        '<button type="submit">+ Aportar</button></form>' +
        '<ul class="fund-history">' +
        (history.length === 0
          ? '<li class="empty-hint">Todavía no hay aportaciones.</li>'
          : history.map(function (c) {
              return '<li><span><span class="fh-who">' + escapeHtml(firstName(c.displayName)) + '</span><span class="fh-when">' + fmtDate(c.date) + '</span></span><span class="fh-amount">+' + fmtMoney(c.amount) + '</span></li>';
            }).join("")) +
        '</ul>';
      wrap.appendChild(card);
    });

    wrap.querySelectorAll(".fund-contribute-form").forEach(function (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var input = form.querySelector(".fund-amount-input");
        var amount = parseFloat(input.value);
        if (!amount || amount <= 0) { showToast("Pon una cantidad válida."); return; }
        addGoalContribution(form.dataset.goal, Math.round(amount * 100) / 100, "").then(function () {
          showToast("¡Aportación guardada! 🎉");
        }).catch(function (err) {
          console.error(err);
          showToast("No se ha podido guardar la aportación.");
        });
      });
    });

    wrap.querySelectorAll(".goal-delete").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showConfirm("¿Eliminar esta meta? No se borrarán las aportaciones ya hechas, pero dejarán de contar hacia ningún objetivo.").then(function (ok) {
          if (!ok) return;
          deleteGoal(btn.dataset.id).catch(function (err) {
            console.error(err);
            showToast("No se ha podido eliminar.");
          });
        });
      });
    });

    wrap.querySelectorAll(".goal-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var goalItem = state.goals.find(function (g) { return g.id === btn.dataset.id; });
        if (goalItem) openGoalModalForEdit(goalItem);
      });
    });

    wrap.querySelectorAll(".goal-start-trip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var goalItem = state.goals.find(function (g) { return g.id === btn.dataset.id; });
        if (!goalItem) return;
        var budget = getGoalTotal(goalItem.id);
        showConfirm("El presupuesto del viaje serán los " + fmtMoney(budget) + " que ya tenéis ahorrados aquí. ¿Empezar el viaje?").then(function (ok) {
          if (!ok) return;
          startTrip(goalItem.id).then(function () {
            showToast("¡Buen viaje! ✈️");
          }).catch(function (err) {
            console.error(err);
            showToast("No se ha podido empezar el viaje.");
          });
        });
      });
    });

    wrap.querySelectorAll(".goal-end-trip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var goalItem = state.goals.find(function (g) { return g.id === btn.dataset.id; });
        if (goalItem) openEndTripModal(goalItem);
      });
    });
  }

  /* ============ Análisis del mes ============ */
  // Recomendaciones calculadas con VUESTROS propios datos: comparamos el mes
  // actual con vuestra media de meses anteriores y buscamos patrones (la
  // categoría que se ha disparado, los gastos pequeños que suman sin que se
  // noten, el ritmo del mes...). No hay nada de inteligencia artificial ni
  // consejos genéricos: si no hay datos suficientes para afirmar algo, ese
  // consejo simplemente no se muestra.

  var INSIGHT_MAX = 4;
  var HISTORY_MONTHS = 3;

  function expensesOfMonthOffset(offset) {
    var d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return visibleExpenses().filter(function (e) { return isSameMonth(e.date, d); });
  }

  function totalByCategory(list) {
    var totals = {};
    list.forEach(function (e) { totals[e.category] = (totals[e.category] || 0) + e.amount; });
    return totals;
  }

  // Media por categoría de los meses anteriores con actividad. Solo cuentan
  // los meses en los que hubo algún gasto: si acabas de empezar a usar la
  // app, un mes vacío no debe hundir la media y disparar falsas alarmas.
  function categoryAverages() {
    var sums = {}, monthsCounted = 0;
    for (var back = 1; back <= HISTORY_MONTHS; back++) {
      var list = expensesOfMonthOffset(state.monthOffset - back);
      if (!list.length) continue;
      monthsCounted++;
      var totals = totalByCategory(list);
      Object.keys(totals).forEach(function (k) { sums[k] = (sums[k] || 0) + totals[k]; });
    }
    if (!monthsCounted) return null;
    var avg = {};
    Object.keys(sums).forEach(function (k) { avg[k] = sums[k] / monthsCounted; });
    return { averages: avg, months: monthsCounted };
  }

  /* ============ Plan financiero ============ */
  // Con al menos 1-2 meses de gasto individual real, calculamos cuánto tienes
  // comprometido de fijo (préstamos + ahorro para metas + gastos fijos) y
  // cuánto te gastas de media en lo variable, para poder simular "¿y si
  // recorto X€ al mes?" — incluido el efecto real en tus préstamos, no una
  // cifra genérica.

  function personalExpensesOfMonthOffset(offset, email) {
    return expensesOfMonthOffset(offset).filter(function (e) {
      return e.type === "individual" && e.payerEmail === email;
    });
  }

  function personalCategoryAverages(email) {
    var sums = {}, monthsCounted = 0;
    for (var back = 1; back <= HISTORY_MONTHS; back++) {
      var list = personalExpensesOfMonthOffset(state.monthOffset - back, email);
      if (!list.length) continue;
      monthsCounted++;
      var totals = totalByCategory(list);
      Object.keys(totals).forEach(function (k) { sums[k] = (sums[k] || 0) + totals[k]; });
    }
    if (!monthsCounted) return null;
    var avg = {}, total = 0;
    Object.keys(sums).forEach(function (k) { avg[k] = sums[k] / monthsCounted; total += avg[k]; });
    return { averages: avg, months: monthsCounted, total: total };
  }

  function buildFinancialPlan(email) {
    var history = personalCategoryAverages(email);
    if (!history) return null;

    var fixedGasto = fixedExpensesTotal(email, "gasto");
    var fixedAhorro = fixedExpensesTotal(email, "ahorro");
    var budget = getBudgetAmount(email, monthKey(currentMonthDate()));
    var margin = budget > 0 ? budget - fixedGasto - fixedAhorro - history.total : null;

    var categories = Object.keys(history.averages)
      .map(function (k) {
        var cat = CATEGORY_BY_KEY[k] || CATEGORY_BY_KEY.otros;
        return { key: k, label: cat.label, emoji: cat.emoji, amount: history.averages[k] };
      })
      .filter(function (c) { return c.amount >= 5; })
      .sort(function (a, b) { return b.amount - a.amount; })
      .slice(0, 3);

    return {
      months: history.months,
      fixedGasto: fixedGasto,
      fixedAhorro: fixedAhorro,
      variableTotal: history.total,
      budget: budget,
      margin: margin,
      categories: categories
    };
  }

  function renderFinancialPlan() {
    var card = $("financial-plan-card");
    if (!card) return;
    if (state.mainTab !== "personal" || !state.user) { card.hidden = true; return; }

    var plan = buildFinancialPlan(state.user.email);
    if (!plan) {
      card.hidden = false;
      $("financial-plan-body").innerHTML =
        '<p class="empty-hint">Necesitamos ver 1 o 2 meses de gasto individual real para hacer el plan. Vuelve cuando lleves un tiempo apuntando aquí.</p>';
      return;
    }
    card.hidden = false;

    var fixedTotal = plan.fixedGasto + plan.fixedAhorro;
    var marginLine = "";
    if (plan.budget > 0) {
      marginLine = plan.margin >= 0
        ? '<p class="plan-line plan-ok">Si mantienes este ritmo, te sobran ' + fmtMoney(plan.margin) + '/mes.</p>'
        : '<p class="plan-line plan-warn">⚠️ A este ritmo gastas ' + fmtMoney(-plan.margin) + ' más al mes de lo que entra.</p>';
    }

    var categoriesHtml = plan.categories.length
      ? '<div class="plan-categories">' + plan.categories.map(function (c) {
          return '<span class="plan-cat-chip">' + c.emoji + ' ' + c.label + ' · ' + fmtMoney(c.amount) + '/mes</span>';
        }).join("") + '</div>'
      : '';

    $("financial-plan-body").innerHTML =
      '<p class="plan-line">🔒 Fijo comprometido: <strong>' + fmtMoney(fixedTotal) + '/mes</strong> <span class="plan-sub">(préstamos, ahorro para metas y gastos fijos)</span></p>' +
      '<p class="plan-line">📊 Gasto variable medio: <strong>' + fmtMoney(plan.variableTotal) + '/mes</strong> <span class="plan-sub">(media de ' + plan.months + (plan.months === 1 ? ' mes' : ' meses') + ')</span></p>' +
      marginLine +
      (plan.months === 1 ? '<p class="plan-sub">Con otro mes más de datos el plan será más fiable.</p>' : '') +
      (categoriesHtml ? '<p class="field-label" style="margin-top:14px;">Dónde más se puede recortar</p>' + categoriesHtml : '') +
      '<label class="field-label" for="plan-cut-input" style="margin-top:14px;">¿Cuánto quieres recortar al mes?</label>' +
      '<div class="amount-input-wrap"><input id="plan-cut-input" type="number" min="0" step="5" placeholder="0" value="0"><span class="amount-suffix">€</span></div>' +
      '<div id="plan-simulator-result" class="plan-simulator-result"></div>';

    var input = $("plan-cut-input");
    var resultEl = $("plan-simulator-result");

    function updateSimulation() {
      var cut = parseFloat(input.value) || 0;
      if (cut <= 0) { resultEl.innerHTML = ""; return; }

      var lines = [
        '<p class="plan-line">En 6 meses tendrías <strong>' + fmtMoney(cut * 6) + '</strong> ahorrados; en 12 meses, <strong>' + fmtMoney(cut * 12) + '</strong>.</p>'
      ];

      state.loans.forEach(function (loan) {
        var current = simulateLoan(loan.principal, loan.annualRate, loan.monthlyPayment, 0);
        var withCut = simulateLoan(loan.principal, loan.annualRate, loan.monthlyPayment, cut);
        if (current.impossible || withCut.impossible) return;
        var monthsSaved = current.months - withCut.months;
        if (monthsSaved <= 0) return;
        lines.push('<p class="plan-line">Metiendo eso en "' + escapeHtml(loan.name) + '": lo terminarías ' + fmtMonths(monthsSaved) +
          ' antes, ahorrando ' + fmtMoney(current.totalInterest - withCut.totalInterest) + ' de intereses.</p>');
      });

      resultEl.innerHTML = lines.join("");
    }

    input.addEventListener("input", updateSimulation);
  }

  function buildInsights() {
    var list = expensesOfMonth();
    if (!list.length) return [];

    var insights = [];
    var total = list.reduce(function (s, e) { return s + e.amount; }, 0);
    var thisMonth = totalByCategory(list);
    var history = categoryAverages();

    // 1. Categorías que se han disparado respecto a vuestra media.
    if (history) {
      var risen = Object.keys(thisMonth).map(function (key) {
        var avg = history.averages[key] || 0;
        return { key: key, now: thisMonth[key], avg: avg, diff: thisMonth[key] - avg };
      }).filter(function (r) {
        return r.avg > 0 && r.now > r.avg * 1.25 && r.diff >= 10;
      }).sort(function (a, b) { return b.diff - a.diff; });

      risen.slice(0, 2).forEach(function (r) {
        var cat = CATEGORY_BY_KEY[r.key] || CATEGORY_BY_KEY.otros;
        var pct = Math.round((r.now / r.avg - 1) * 100);
        // Se dice con cuántos meses se compara: con un solo mes de histórico
        // no se debe insinuar que hay una media sólida detrás.
        var basis = history.months === 1
          ? "el mes anterior fue " + fmtMoney(r.avg)
          : "tu media de los últimos " + history.months + " meses es " + fmtMoney(r.avg);
        insights.push({
          emoji: cat.emoji,
          tone: "warn",
          title: cat.label + ": " + pct + "% más de lo normal",
          text: "Llevas " + fmtMoney(r.now) + " y " + basis +
            ". Volviendo a eso te ahorrarías " + fmtMoney(r.diff) + "."
        });
      });
    }

    // 2. Los gastos pequeños que no se notan pero suman.
    var smallGroups = {};
    list.filter(function (e) { return e.amount <= 10; }).forEach(function (e) {
      var key = (e.place || "").trim().toLowerCase() || e.category;
      if (!smallGroups[key]) {
        smallGroups[key] = { label: (e.place || "").trim() || (CATEGORY_BY_KEY[e.category] || CATEGORY_BY_KEY.otros).label, count: 0, total: 0, category: e.category };
      }
      smallGroups[key].count += 1;
      smallGroups[key].total += e.amount;
    });
    var topSmall = Object.keys(smallGroups).map(function (k) { return smallGroups[k]; })
      .filter(function (g) { return g.count >= 5 && g.total >= 15; })
      .sort(function (a, b) { return b.total - a.total; })[0];
    if (topSmall) {
      var catSmall = CATEGORY_BY_KEY[topSmall.category] || CATEGORY_BY_KEY.otros;
      insights.push({
        emoji: catSmall.emoji,
        tone: "info",
        title: topSmall.count + " veces en " + topSmall.label + " = " + fmtMoney(topSmall.total),
        text: "De poco en poco (" + fmtMoney(topSmall.total / topSmall.count) + " de media). Son los que menos se notan y más suman al final del mes."
      });
    }

    // 3. En qué se va la mayor parte.
    var biggestKey = Object.keys(thisMonth).sort(function (a, b) { return thisMonth[b] - thisMonth[a]; })[0];
    if (biggestKey && total > 0) {
      var share = Math.round((thisMonth[biggestKey] / total) * 100);
      if (share >= 35) {
        var catBig = CATEGORY_BY_KEY[biggestKey] || CATEGORY_BY_KEY.otros;
        insights.push({
          emoji: catBig.emoji,
          tone: "info",
          title: catBig.label + " se lleva el " + share + "% de tu gasto",
          text: fmtMoney(thisMonth[biggestKey]) + " de " + fmtMoney(total) + ". Si quieres recortar, es donde cada euro cuenta más."
        });
      }
    }

    // 4. Ritmo: a este paso, cómo acabará el mes. Solo en el mes en curso y
    // pasados unos días, porque con 2 días la proyección es una lotería.
    if (state.monthOffset === 0) {
      var today = new Date();
      var dayOfMonth = today.getDate();
      var daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      if (dayOfMonth >= 5 && dayOfMonth < daysInMonth) {
        var projected = (total / dayOfMonth) * daysInMonth;
        var extra = projected - total;
        insights.push({
          emoji: "📈",
          tone: "info",
          title: "A este ritmo acabarás el mes en " + fmtMoney(projected),
          text: "Llevas " + fmtMoney(total) + " en " + dayOfMonth + " días (" + fmtMoney(total / dayOfMonth) +
            "/día). Quedan " + (daysInMonth - dayOfMonth) + " días, unos " + fmtMoney(extra) + " más si sigues igual."
        });
      }
    }

    // 5. El mordisco más grande del mes.
    var biggest = list.reduce(function (a, b) { return b.amount > a.amount ? b : a; });
    if (biggest.amount >= total * 0.25 && list.length >= 3) {
      var catOne = CATEGORY_BY_KEY[biggest.category] || CATEGORY_BY_KEY.otros;
      insights.push({
        emoji: "🎯",
        tone: "info",
        title: "Un solo gasto se llevó " + fmtMoney(biggest.amount),
        text: (biggest.place ? escapeHtml(biggest.place) + " · " : "") + catOne.label +
          ", el " + Math.round((biggest.amount / total) * 100) + "% del mes. Un gasto puntual grande no es un problema de hábitos."
      });
    }

    return insights.slice(0, INSIGHT_MAX);
  }

  function renderInsights() {
    var card = $("insights-card");
    if (!card) return;

    var isGastos = state.mainTab === "conjunto" || state.mainTab === "personal";
    if (!isGastos) { card.hidden = true; return; }

    var insights = buildInsights();
    card.hidden = insights.length === 0;
    if (card.hidden) return;

    var wrap = $("insights-list");
    wrap.innerHTML = "";
    insights.forEach(function (ins) {
      var row = document.createElement("div");
      row.className = "insight" + (ins.tone === "warn" ? " insight-warn" : "");
      row.innerHTML =
        '<span class="insight-emoji">' + ins.emoji + '</span>' +
        '<span class="insight-body">' +
        '<span class="insight-title">' + ins.title + '</span>' +
        '<span class="insight-text">' + ins.text + '</span>' +
        '</span>';
      wrap.appendChild(row);
    });
  }

  function renderLoans() {
    if (state.mainTab !== "prestamos") return;
    var wrap = $("loans-list");
    wrap.innerHTML = "";

    if (state.loans.length === 0) {
      wrap.innerHTML = '<p class="empty-hint">Todavía no has añadido ningún préstamo.</p>';
      return;
    }

    state.loans.forEach(function (loan) {
      var current = simulateLoan(loan.principal, loan.annualRate, loan.monthlyPayment, 0);

      // Progreso: si sabemos el plazo firmado, "llevas X de Y". Si no, lo
      // estimamos sumando las pagadas a las que quedan por simulación.
      var totalInstallments = loan.termMonths > 0
        ? loan.termMonths
        : (current.impossible ? 0 : loan.paidInstallments + current.months);
      var paid = Math.min(loan.paidInstallments, totalInstallments || loan.paidInstallments);
      var pct = totalInstallments > 0 ? Math.min(100, Math.round((paid / totalInstallments) * 100)) : 0;
      var remainingByContract = totalInstallments > 0 ? Math.max(0, totalInstallments - paid) : null;
      var paidSoFar = paid * loan.monthlyPayment;

      var progressBlock = "";
      if (totalInstallments > 0) {
        progressBlock =
          '<div class="loan-progress-track"><div class="loan-progress-fill" style="width:' + pct + '%"></div></div>' +
          '<p class="loan-progress-text">Llevas <strong>' + paid + ' de ' + totalInstallments + '</strong> cuotas (' + pct + '%)' +
          (paidSoFar > 0 ? ' · ya has pagado ' + fmtMoney(paidSoFar) : '') + '</p>';
      }

      var card = document.createElement("section");
      card.className = "loan-card";
      card.innerHTML =
        '<div class="loan-card-header">' +
        '<span class="loan-card-name">' + escapeHtml(loan.name) + '</span>' +
        '<div class="loan-card-actions">' +
        '<button type="button" class="li-action-btn loan-edit" data-id="' + loan.id + '" title="Editar">✏️</button>' +
        '<button type="button" class="li-action-btn loan-delete" data-id="' + loan.id + '" title="Eliminar">🗑️</button>' +
        '</div></div>' +
        progressBlock +
        '<div class="loan-stats">' +
        (loan.originalPrincipal > 0 ? '<span class="loan-stat">Pediste: ' + fmtMoney(loan.originalPrincipal) + '</span>' : '') +
        '<span class="loan-stat">Pendiente: ' + fmtMoney(loan.principal) + '</span>' +
        '<span class="loan-stat">TIN: ' + loan.annualRate.toFixed(2).replace(".", ",") + '%</span>' +
        '<span class="loan-stat">Cuota: ' + fmtMoney(loan.monthlyPayment) + '/mes</span>' +
        (loan.termMonths > 0 ? '<span class="loan-stat">Plazo: ' + fmtMonths(loan.termMonths) + '</span>' : '') +
        (loan.addToMonthly ? '<span class="loan-stat loan-stat-linked">🏦 En tus gastos fijos</span>' : '') +
        '</div>' +
        (current.impossible
          ? '<p class="loan-payoff warn">⚠️ Con esta cuota nunca terminarías de pagarlo — no llega a cubrir los intereses.</p>'
          : '<p class="loan-payoff">Terminas en ' + fmtMonths(current.months) + ' · pagarás ' + fmtMoney(current.totalInterest) + ' de intereses en total</p>') +
        (remainingByContract != null && !current.impossible && Math.abs(remainingByContract - current.months) > 2
          ? '<p class="loan-note">Por contrato te quedarían ' + fmtMonths(remainingByContract) + '. La diferencia suele ser porque la cantidad pendiente es aproximada.</p>'
          : '') +
        '<div class="loan-simulate">' +
        '<label>¿Y si pagas</label>' +
        '<input type="number" min="0" step="10" class="loan-extra-input" placeholder="0" value="0">' +
        '<label>€ más al mes?</label>' +
        '</div>' +
        '<p class="loan-simulate-result"></p>';
      wrap.appendChild(card);

      var resultEl = card.querySelector(".loan-simulate-result");
      var extraInput = card.querySelector(".loan-extra-input");

      function updateSimulation() {
        var extra = parseFloat(extraInput.value) || 0;
        if (extra <= 0) { resultEl.textContent = ""; resultEl.classList.remove("warn"); return; }
        var withExtra = simulateLoan(loan.principal, loan.annualRate, loan.monthlyPayment, extra);
        if (withExtra.impossible) {
          resultEl.textContent = "Sigue sin cubrir los intereses.";
          resultEl.classList.add("warn");
          return;
        }
        resultEl.classList.remove("warn");
        if (current.impossible) {
          resultEl.textContent = "Terminarías en " + fmtMonths(withExtra.months) + ", pagando " + fmtMoney(withExtra.totalInterest) + " de intereses.";
          return;
        }
        var monthsSaved = current.months - withExtra.months;
        var interestSaved = current.totalInterest - withExtra.totalInterest;
        resultEl.textContent = monthsSaved > 0
          ? "Terminarías " + fmtMonths(monthsSaved) + " antes y te ahorrarías " + fmtMoney(interestSaved) + " de intereses."
          : "Terminarías en " + fmtMonths(withExtra.months) + ".";
      }

      extraInput.addEventListener("input", updateSimulation);
    });

    wrap.querySelectorAll(".loan-delete").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showConfirm("¿Eliminar este préstamo?").then(function (ok) {
          if (!ok) return;
          deleteLoan(btn.dataset.id).catch(function (err) {
            console.error(err);
            showToast("No se ha podido eliminar.");
          });
        });
      });
    });

    wrap.querySelectorAll(".loan-edit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var loan = state.loans.find(function (l) { return l.id === btn.dataset.id; });
        if (loan) openLoanModalForEdit(loan);
      });
    });
  }

  // Plazo: la gente dice "es a 7 años" pero también "a 18 meses", así que se
  // elige la unidad en vez de forzar una conversión mental.
  function initLoanTermUnitPicker() {
    var wrap = $("loan-term-unit-picker");
    wrap.innerHTML = "";
    [{ key: "years", label: "años" }, { key: "months", label: "meses" }].forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (opt.key === state.selectedLoanTermUnit ? " selected" : "");
      btn.dataset.key = opt.key;
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        state.selectedLoanTermUnit = opt.key;
        $("loan-term-suffix").textContent = opt.label;
        wrap.querySelectorAll(".type-chip").forEach(function (el) {
          el.classList.toggle("selected", el.dataset.key === opt.key);
        });
      });
      wrap.appendChild(btn);
    });
    $("loan-term-suffix").textContent = state.selectedLoanTermUnit === "months" ? "meses" : "años";
  }

  function initLoanMonthlyPicker() {
    var wrap = $("loan-monthly-picker");
    wrap.innerHTML = "";
    [{ key: true, label: "Sí, réstala" }, { key: false, label: "No" }].forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (opt.key === state.selectedLoanAddToMonthly ? " selected" : "");
      btn.dataset.key = String(opt.key);
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        state.selectedLoanAddToMonthly = opt.key;
        wrap.querySelectorAll(".type-chip").forEach(function (el) {
          el.classList.toggle("selected", el.dataset.key === String(opt.key));
        });
      });
      wrap.appendChild(btn);
    });
  }

  function openLoanModalForCreate() {
    state.editingLoanId = null;
    $("form-loan").reset();
    state.selectedLoanTermUnit = "years";
    state.selectedLoanAddToMonthly = true;
    initLoanTermUnitPicker();
    initLoanMonthlyPicker();
    $("modal-loan-title").textContent = "Nuevo préstamo";
    $("btn-save-loan").textContent = "Guardar préstamo";
    $("modal-loan").hidden = false;
    setTimeout(function () { $("input-loan-name").focus(); }, 250);
  }

  function openLoanModalForEdit(loan) {
    state.editingLoanId = loan.id;
    $("input-loan-name").value = loan.name;
    $("input-loan-original").value = loan.originalPrincipal || "";
    $("input-loan-principal").value = loan.principal;
    $("input-loan-rate").value = loan.annualRate;
    $("input-loan-payment").value = loan.monthlyPayment;
    $("input-loan-paid").value = loan.paidInstallments || "";
    // Se muestra en años si el plazo es un número exacto de años; si no, en meses.
    if (loan.termMonths > 0 && loan.termMonths % 12 === 0) {
      state.selectedLoanTermUnit = "years";
      $("input-loan-term").value = loan.termMonths / 12;
    } else {
      state.selectedLoanTermUnit = loan.termMonths > 0 ? "months" : "years";
      $("input-loan-term").value = loan.termMonths || "";
    }
    state.selectedLoanAddToMonthly = loan.addToMonthly;
    initLoanTermUnitPicker();
    initLoanMonthlyPicker();
    $("modal-loan-title").textContent = "Editar préstamo";
    $("btn-save-loan").textContent = "Guardar cambios";
    $("modal-loan").hidden = false;
  }

  function closeLoanModal() {
    $("modal-loan").hidden = true;
    state.editingLoanId = null;
  }

  function initLoans() {
    $("btn-add-loan").addEventListener("click", openLoanModalForCreate);
    document.querySelectorAll("[data-close-loan]").forEach(function (el) {
      el.addEventListener("click", closeLoanModal);
    });

    $("form-loan").addEventListener("submit", function (ev) {
      ev.preventDefault();

      var termRaw = parseInt($("input-loan-term").value, 10) || 0;
      var termMonths = termRaw > 0
        ? (state.selectedLoanTermUnit === "months" ? termRaw : termRaw * 12)
        : 0;

      var payload = {
        name: $("input-loan-name").value.trim(),
        originalPrincipal: Math.round((parseFloat($("input-loan-original").value) || 0) * 100) / 100,
        principal: Math.round((parseFloat($("input-loan-principal").value) || 0) * 100) / 100,
        annualRate: Math.round((parseFloat($("input-loan-rate").value) || 0) * 100) / 100,
        monthlyPayment: Math.round((parseFloat($("input-loan-payment").value) || 0) * 100) / 100,
        termMonths: termMonths,
        paidInstallments: Math.max(0, parseInt($("input-loan-paid").value, 10) || 0),
        addToMonthly: state.selectedLoanAddToMonthly !== false
      };

      if (payload.termMonths > 0 && payload.paidInstallments >= payload.termMonths) {
        showToast("Las cuotas pagadas no pueden llegar al plazo total.");
        return;
      }

      // Si escriben "cuánto pediste" pero no "cuánto queda", lo calculamos con
      // la fórmula de amortización — así no hace falta mirar el saldo en la
      // app del banco. Si SÍ ponen la pendiente a mano, esa manda siempre:
      // puede haber amortizaciones anticipadas o (en una hipoteca variable)
      // cambios de TIN que la fórmula teórica no puede adivinar.
      var pendienteCalculada = false;
      if (payload.principal <= 0 && payload.originalPrincipal > 0) {
        if (payload.termMonths <= 0) {
          showToast("Para calcular lo pendiente necesitamos el plazo del préstamo.");
          return;
        }
        payload.principal = Math.round(
          remainingBalance(payload.originalPrincipal, payload.annualRate, payload.termMonths, payload.paidInstallments) * 100
        ) / 100;
        pendienteCalculada = true;
      }

      if (!payload.name || payload.principal <= 0) {
        showToast("Pon al menos el nombre, y la cantidad pendiente o cuánto pediste al principio.");
        return;
      }

      // Si no saben la cuota pero sí el plazo, la calculamos por ellos.
      // Ojo: lo que se amortiza es la cantidad PENDIENTE, y esa se paga en los
      // meses que QUEDAN (plazo menos cuotas ya pagadas), no en el plazo
      // entero. Usar el plazo completo daba una cuota bastante más baja de la
      // real y luego el resto de cifras no cuadraban entre sí.
      var cuotaCalculada = false;
      if (payload.monthlyPayment <= 0) {
        if (termMonths <= 0) {
          showToast("Pon la cuota mensual o el plazo, para poder calcular.");
          return;
        }
        var monthsLeft = termMonths - payload.paidInstallments;
        payload.monthlyPayment = Math.round(paymentForTerm(payload.principal, payload.annualRate, monthsLeft) * 100) / 100;
        cuotaCalculada = true;
      }
      var isEditing = !!state.editingLoanId;
      var saveBtn = $("btn-save-loan");
      saveBtn.disabled = true;
      var op = isEditing ? updateLoan(state.editingLoanId, payload) : addLoan(payload);
      op.then(function () {
        closeLoanModal();
        var calcMsgs = [];
        if (pendienteCalculada) calcMsgs.push("pendiente " + fmtMoney(payload.principal));
        if (cuotaCalculada) calcMsgs.push("cuota " + fmtMoney(payload.monthlyPayment) + "/mes");
        showToast(calcMsgs.length
          ? "Calculado: " + calcMsgs.join(" · ")
          : (isEditing ? "¡Cambios guardados! 🎉" : "¡Préstamo añadido! 🎉"));
      }).catch(function (err) {
        console.error(err);
        showToast("No se ha podido guardar. Inténtalo otra vez.");
      }).finally(function () {
        saveBtn.disabled = false;
      });
    });
  }

  function renderBudgets() {
    var card = $("budgets-card");
    if (!card) return;
    card.hidden = state.mainTab !== "personal";
    if (card.hidden) return;

    var mKey = monthKey(currentMonthDate());
    var monthExpenses = expensesOfMonth();

    var wrap = $("budgets-list");
    wrap.innerHTML = "";

    // En Personal cada uno solo ve su propia fila — lo del otro no aparece
    // aquí (privacidad); en Conjunto no hay "personal" que ocultar.
    var visiblePartners = state.user
      ? PARTNERS.filter(function (p) { return p.email === state.user.email; })
      : PARTNERS;

    visiblePartners.forEach(function (p) {
      var paidByPerson = monthExpenses.filter(function (e) { return e.payerEmail === p.email; });
      var conjuntoSpent = paidByPerson.filter(function (e) { return e.type === "conjunto"; }).reduce(function (s, e) { return s + e.amount; }, 0);
      var individualSpent = paidByPerson.filter(function (e) { return e.type === "individual"; }).reduce(function (s, e) { return s + e.amount; }, 0);
      var spent = conjuntoSpent + individualSpent;
      var budget = getBudgetAmount(p.email, mKey);
      var fixedList = fixedExpensesFor(p.email);
      var fixedGastoTotal = fixedExpensesTotal(p.email, "gasto");
      var fixedAhorroTotal = fixedExpensesTotal(p.email, "ahorro");
      var remaining = budget - spent - fixedGastoTotal - fixedAhorroTotal;

      var row = document.createElement("div");
      row.className = "budget-row";
      row.innerHTML =
        '<span class="budget-row-name">' + escapeHtml(p.label) + '</span>' +
        '<span class="budget-row-input-wrap"><label>Empieza el mes con</label>' +
        '<input type="number" step="1" min="0" class="budget-input" data-email="' + p.email + '" value="' + (budget || "") + '" placeholder="0">€</span>' +
        '<span class="budget-remaining ' + (remaining < 0 ? "negative" : "positive") + '">' +
        (remaining < 0 ? "se ha pasado " + fmtMoney(-remaining) : "le quedan " + fmtMoney(remaining)) +
        '</span>' +
        '<div class="budget-stats">' +
        '<span class="budget-stat">Conjunto: ' + fmtMoney(conjuntoSpent) + '</span>' +
        '<span class="budget-stat">Solo: ' + fmtMoney(individualSpent) + '</span>' +
        '<span class="budget-stat">💸 Gastos fijos: ' + fmtMoney(fixedGastoTotal) + '</span>' +
        '<span class="budget-stat">🐷 Ahorro: ' + fmtMoney(fixedAhorroTotal) + '</span>' +
        '</div>' +
        '<div class="fixed-expenses-block">' +
        '<span class="li-sub">Gastos fijos del mes (se restan siempre, no hace falta repetirlos):</span>' +
        '<ul class="fixed-expenses-list">' +
        (fixedList.length === 0
          ? '<li class="empty-hint">Ninguno todavía.</li>'
          : fixedList.map(function (f) {
              // Las cuotas de préstamo y el ahorro para metas vienen de sus
              // propios apartados, así que aquí no se borran: se muestran
              // marcadas y sin la ✕.
              var linked = f.fromLoan || f.fromGoal;
              var icon = f.fromLoan ? "🏦" : (f.fromGoal ? "🎯" : (f.category === "ahorro" ? "🐷" : "💸"));
              var origin = f.fromLoan ? "cuota del préstamo" : (f.fromGoal ? "ahorro para la meta" : "");
              var lockTitle = f.fromLoan ? "Se gestiona en Préstamos" : "Se gestiona en Metas";
              return '<li' + (linked ? ' class="fe-from-loan"' : '') + '>' +
                '<span class="fe-cat-icon">' + icon + '</span>' +
                '<span class="fe-label">' + escapeHtml(f.label) +
                (linked ? '<span class="fe-origin">' + origin + '</span>' : '') +
                '</span>' +
                '<span class="fe-amount">' + fmtMoney(f.amount) + '</span>' +
                (linked ? '<span class="fe-lock" title="' + lockTitle + '">🔒</span>' : '<button type="button" class="fe-del" data-id="' + f.id + '" title="Eliminar">✕</button>') +
                '</li>';
            }).join("")) +
        '</ul>' +
        '<div class="fe-category-picker" data-selected="gasto">' +
        '<button type="button" class="fe-cat-btn selected" data-cat="gasto">💸 Gasto</button>' +
        '<button type="button" class="fe-cat-btn" data-cat="ahorro">🐷 Ahorro</button>' +
        '</div>' +
        '<form class="fixed-expense-form" data-email="' + p.email + '">' +
        '<input type="text" class="fe-input-label" placeholder="Ej. Coche" required>' +
        '<input type="number" class="fe-input-amount" min="0" step="0.01" placeholder="€" required>' +
        '<button type="submit">+ Añadir</button>' +
        '</form>' +
        '</div>';
      wrap.appendChild(row);
    });

    wrap.querySelectorAll(".fe-cat-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var picker = btn.closest(".fe-category-picker");
        picker.dataset.selected = btn.dataset.cat;
        picker.querySelectorAll(".fe-cat-btn").forEach(function (b) {
          b.classList.toggle("selected", b.dataset.cat === btn.dataset.cat);
        });
      });
    });

    wrap.querySelectorAll(".fe-del").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showConfirm("¿Eliminar este gasto fijo?").then(function (ok) {
          if (!ok) return;
          deleteFixedExpense(btn.dataset.id).catch(function (err) {
            console.error(err);
            showToast("No se ha podido eliminar.");
          });
        });
      });
    });

    wrap.querySelectorAll(".fixed-expense-form").forEach(function (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var label = form.querySelector(".fe-input-label").value.trim();
        var amount = parseFloat(form.querySelector(".fe-input-amount").value);
        if (!label || !amount || amount <= 0) { showToast("Pon un nombre y un importe válido."); return; }
        var picker = form.previousElementSibling;
        var category = (picker && picker.classList.contains("fe-category-picker")) ? picker.dataset.selected : "gasto";
        addFixedExpense(form.dataset.email, label, Math.round(amount * 100) / 100, category).then(function () {
          showToast("¡Gasto fijo añadido! 🎉");
        }).catch(function (err) {
          console.error(err);
          showToast("No se ha podido añadir.");
        });
      });
    });

    wrap.querySelectorAll(".budget-input").forEach(function (input) {
      input.addEventListener("change", function () {
        var amount = parseFloat(input.value) || 0;
        setBudget(input.dataset.email, mKey, amount).catch(function (err) {
          console.error(err);
          showToast("No se ha podido guardar el presupuesto.");
        });
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ============ Exportar CSV ============ */

  function csvCell(value) {
    var s = value == null ? "" : String(value);
    if (/[";\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv() {
    var list = viewExpensesOfMonth().slice().sort(function (a, b) { return a.date - b.date; });
    var rows = [["Fecha", "Tipo", "Categoría", "Quién paga", "Sitio", "Nota", "Importe (€)"]];
    list.forEach(function (e) {
      var cat = CATEGORY_BY_KEY[e.category] || CATEGORIES[5];
      rows.push([
        e.date.toLocaleDateString("es-ES") + " " + e.date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
        e.type === "conjunto" ? "Conjunto" : "Individual",
        cat.label,
        partnerLabel(e.payerEmail),
        e.place,
        e.note,
        e.amount.toFixed(2).replace(".", ",")
      ]);
    });
    var csv = rows.map(function (r) { return r.map(csvCell).join(";"); }).join("\r\n");
    var blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var mKey = monthKey(currentMonthDate());
    var a = document.createElement("a");
    a.href = url;
    a.download = "gastos-pareja-" + state.mainTab + "-" + mKey + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function initExportCsv() {
    $("btn-export-csv").addEventListener("click", exportCsv);
  }

  /* ============ Importar extracto del banco ============ */
  // Cada banco exporta el CSV con sus propias columnas y su propio formato de
  // número/fecha, así que no hay un solo parser que valga para todos: se
  // detecta el delimitador y se ADIVINA qué columna es cuál, pero siempre se
  // le enseña al usuario esa suposición antes de importar nada, por si hay
  // que corregirla. Los gastos se guardan con su fecha real (puede ser de
  // hace un año) para poder cargar todo el histórico de golpe.

  var importContext = { rows: null, headers: null, mapping: null, type: "individual", recurringGroups: [], parsed: [] };

  // Parser de CSV a mano: sin librería, pero soporta comillas y detecta si el
  // separador es "," o ";" (los bancos españoles casi siempre usan ";").
  function parseCsvText(text) {
    text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var lines = text.split("\n").filter(function (l) { return l.trim() !== ""; });
    if (!lines.length) return { headers: [], rows: [] };

    var commaCount = (lines[0].match(/,/g) || []).length;
    var semiCount = (lines[0].match(/;/g) || []).length;
    var delimiter = semiCount >= commaCount ? ";" : ",";

    function parseLine(line) {
      var cells = [], cur = "", inQuotes = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
          } else { cur += ch; }
        } else if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          cells.push(cur); cur = "";
        } else {
          cur += ch;
        }
      }
      cells.push(cur);
      return cells.map(function (c) { return c.trim(); });
    }

    var headers = parseLine(lines[0]);
    var rows = lines.slice(1).map(parseLine);
    return { headers: headers, rows: rows };
  }

  // Admite "1.234,56" (España), "1234.56" (genérico) y "-12,50". Se asume que
  // los importes negativos son gastos; los positivos (ingresos) se descartan
  // más adelante, ya que esto es un registro de gastos, no de todo el movimiento.
  function parseAmountFlexible(str) {
    if (str == null) return null;
    var s = String(str).trim().replace(/[€\s]/g, "");
    if (!s) return null;
    var negative = /^-/.test(s) || /^\(.*\)$/.test(s);
    s = s.replace(/^[-+]/, "").replace(/[()]/g, "");
    if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1) {
      s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (s.indexOf(",") !== -1) {
      s = s.replace(",", ".");
    }
    var n = parseFloat(s);
    if (isNaN(n)) return null;
    return negative ? -n : n;
  }

  // Admite dd/mm/yyyy, dd-mm-yyyy y yyyy-mm-dd (con / o -).
  function parseDateFlexible(str) {
    if (!str) return null;
    var s = String(str).trim();
    var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return null;
  }

  // Se calcula en orden (fecha, luego importe, luego concepto) y cada
  // columna ya asignada queda excluida de las siguientes búsquedas — si no,
  // "valor" encuentra antes la columna "F. Valor" (fecha) que "Importe",
  // porque para el banco "valor" también significa fecha valor, no dinero.
  function guessColumnMapping(headers) {
    var lower = headers.map(function (h) { return h.toLowerCase(); });
    var used = {};

    function find(keywordGroups) {
      for (var g = 0; g < keywordGroups.length; g++) {
        for (var i = 0; i < lower.length; i++) {
          if (used[i]) continue;
          if (lower[i].indexOf(keywordGroups[g]) !== -1) return i;
        }
      }
      return -1;
    }

    var dateIdx = find(["fecha valor", "f. valor", "f valor", "fecha operacion", "fecha operación", "fecha"]);
    if (dateIdx !== -1) used[dateIdx] = true;

    var amountIdx = find(["importe", "cantidad", "monto", "valor"]);
    if (amountIdx !== -1) used[amountIdx] = true;

    var conceptIdx = find(["concepto", "descripcion", "descripción", "detalle", "observaciones"]);

    function firstFree(preferred) {
      if (preferred !== -1 && !used[preferred]) return preferred;
      for (var i = 0; i < headers.length; i++) { if (!used[i]) return i; }
      return 0;
    }

    return {
      date: dateIdx !== -1 ? dateIdx : firstFree(0),
      amount: amountIdx !== -1 ? amountIdx : firstFree(1),
      concept: conceptIdx !== -1 ? conceptIdx : firstFree(2)
    };
  }

  var IMPORT_CATEGORY_KEYWORDS = [
    { key: "comida", words: ["mercadona", "carrefour", "lidl", "dia %", "supermercado", "restaurante", "bar ", "cafeteria", "cafetería", "eroski", "alcampo", "glovo", "just eat", "uber eats"] },
    { key: "transporte", words: ["renfe", "uber", "cabify", "taxi", "gasolina", "repsol", "cepsa", "bp ", "shell", "metro", "emt", "parking", "peaje", "iberia", "vueling", "ryanair"] },
    { key: "ocio", words: ["netflix", "spotify", "hbo", "disney", "cine", "prime video", "steam", "playstation", "gimnasio", "gym"] },
    { key: "casa", words: ["alquiler", "hipoteca", "endesa", "iberdrola", "naturgy", "movistar", "vodafone", "orange", "agua", "comunidad de propietarios"] },
    { key: "salud", words: ["farmacia", "seguro medico", "seguro médico", "clinica", "clínica", "dentista"] }
  ];

  function guessCategory(concept) {
    var text = (concept || "").toLowerCase();
    for (var i = 0; i < IMPORT_CATEGORY_KEYWORDS.length; i++) {
      var group = IMPORT_CATEGORY_KEYWORDS[i];
      for (var w = 0; w < group.words.length; w++) {
        if (text.indexOf(group.words[w]) !== -1) return group.key;
      }
    }
    return "otros";
  }

  // Para agrupar "mismo gasto, distinto mes" hay que limpiar el concepto de
  // números de referencia, fechas y códigos que cambian cada vez aunque sea
  // el mismo comercio (p. ej. "PAGO TARJETA 4321 REF88213 15/07").
  function normalizeConcept(concept) {
    return (concept || "")
      .toLowerCase()
      .replace(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/g, "")
      .replace(/\b\d{4,}\b/g, "")
      .replace(/[^a-z0-9áéíóúñ ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function median(numbers) {
    var sorted = numbers.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Se marca como "posible fijo" cuando el mismo concepto aparece en 2+ meses
  // distintos con un importe parecido (dentro de un ±15%) — así una suscripción
  // que sube de precio de un mes a otro no deja de detectarse.
  function detectRecurring(parsedRows) {
    var groups = {};
    parsedRows.forEach(function (r) {
      var key = normalizeConcept(r.concept);
      if (!key) return;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    return Object.keys(groups).map(function (key) {
      var items = groups[key];
      var months = {};
      items.forEach(function (r) { months[monthKey(r.date)] = true; });
      var monthCount = Object.keys(months).length;
      if (monthCount < 2) return null;
      var amounts = items.map(function (r) { return r.amount; });
      var avg = amounts.reduce(function (s, a) { return s + a; }, 0) / amounts.length;
      var consistent = amounts.every(function (a) { return Math.abs(a - avg) <= avg * 0.15 + 0.5; });
      if (!consistent) return null;
      return {
        key: key,
        label: items[0].concept,
        monthCount: monthCount,
        suggestedAmount: Math.round(median(amounts) * 100) / 100,
        category: items[0].category,
        items: items,
        addAsFixed: false
      };
    }).filter(Boolean).sort(function (a, b) { return b.monthCount - a.monthCount; });
  }

  function initImportTypePicker() {
    var wrap = $("import-type-picker");
    wrap.innerHTML = "";
    TYPES.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (t.key === importContext.type ? " selected" : "");
      btn.dataset.key = t.key;
      btn.innerHTML = '<span class="emoji">' + t.emoji + '</span>' + t.label;
      btn.addEventListener("click", function () {
        importContext.type = t.key;
        wrap.querySelectorAll(".type-chip").forEach(function (el) { el.classList.toggle("selected", el.dataset.key === t.key); });
      });
      wrap.appendChild(btn);
    });
    $("import-type-field").hidden = isPersonalSpace();
    if (isPersonalSpace()) importContext.type = "individual";
  }

  function resetImportModal() {
    importContext = { rows: null, headers: null, mapping: null, type: isPersonalSpace() ? "individual" : "conjunto", recurringGroups: [], parsed: [] };
    $("input-import-file").value = "";
    $("import-file-error").hidden = true;
    $("import-step-file").hidden = false;
    $("import-step-mapping").hidden = true;
    $("import-step-review").hidden = true;
    $("import-step-actions").hidden = true;
    initImportTypePicker();
  }

  function openImportModal() {
    resetImportModal();
    $("modal-import").hidden = false;
  }

  function closeImportModal() {
    $("modal-import").hidden = true;
  }

  function showMappingStep() {
    var selects = [["import-map-date", "date"], ["import-map-amount", "amount"], ["import-map-concept", "concept"]];
    selects.forEach(function (pair) {
      var sel = $(pair[0]);
      sel.innerHTML = "";
      importContext.headers.forEach(function (h, i) {
        var opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = h || "(columna " + (i + 1) + ")";
        if (i === importContext.mapping[pair[1]]) opt.selected = true;
        sel.appendChild(opt);
      });
    });
    $("import-step-file").hidden = true;
    $("import-step-mapping").hidden = false;
  }

  function buildParsedRows() {
    var mapping = {
      date: parseInt($("import-map-date").value, 10),
      amount: parseInt($("import-map-amount").value, 10),
      concept: parseInt($("import-map-concept").value, 10)
    };
    importContext.mapping = mapping;

    var parsed = [];
    importContext.rows.forEach(function (row) {
      var date = parseDateFlexible(row[mapping.date]);
      var amount = parseAmountFlexible(row[mapping.amount]);
      var concept = (row[mapping.concept] || "").trim();
      if (!date || amount == null || amount >= 0) return; // solo gastos (importe negativo)
      parsed.push({ date: date, amount: Math.round(Math.abs(amount) * 100) / 100, concept: concept, category: guessCategory(concept), include: true });
    });
    parsed.sort(function (a, b) { return a.date - b.date; });
    return parsed;
  }

  function showReviewStep() {
    var parsed = buildParsedRows();
    if (!parsed.length) {
      $("import-mapping-error").textContent = "No hemos encontrado ningún gasto (importe negativo) con esas columnas. Revisa la selección.";
      $("import-mapping-error").hidden = false;
      return;
    }
    $("import-mapping-error").hidden = true;
    importContext.parsed = parsed;
    importContext.recurringGroups = detectRecurring(parsed);

    var recurringBlock = $("import-recurring-block");
    recurringBlock.hidden = importContext.recurringGroups.length === 0;
    if (!recurringBlock.hidden) {
      var list = $("import-recurring-list");
      list.innerHTML = "";
      importContext.recurringGroups.forEach(function (g, idx) {
        var cat = CATEGORY_BY_KEY[g.category] || CATEGORY_BY_KEY.otros;
        var row = document.createElement("div");
        row.className = "import-recurring-item";
        row.innerHTML =
          '<span class="import-recurring-info"><span class="import-recurring-label">' + cat.emoji + ' ' + escapeHtml(g.label) + '</span>' +
          '<span class="import-recurring-sub">' + g.monthCount + ' meses · ' + fmtMoney(g.suggestedAmount) + '/mes</span></span>' +
          '<label class="import-recurring-toggle"><input type="checkbox" data-idx="' + idx + '"> Gasto fijo</label>';
        row.querySelector("input").addEventListener("change", function (ev) {
          importContext.recurringGroups[idx].addAsFixed = ev.target.checked;
        });
        list.appendChild(row);
      });
    }

    $("import-review-count").textContent = "Gastos a importar (" + parsed.length + ")";
    var previewList = $("import-preview-list");
    previewList.innerHTML = "";
    parsed.forEach(function (r, idx) {
      var cat = CATEGORY_BY_KEY[r.category] || CATEGORY_BY_KEY.otros;
      var li = document.createElement("li");
      li.className = "import-preview-item";
      li.innerHTML =
        '<input type="checkbox" class="import-row-check" data-idx="' + idx + '" checked>' +
        '<span class="import-row-body"><span class="import-row-concept">' + escapeHtml(r.concept || "(sin concepto)") + '</span>' +
        '<span class="import-row-sub">' + fmtDate(r.date) + ' · ' + cat.emoji + ' ' + cat.label + '</span></span>' +
        '<span class="import-row-amount">' + fmtMoney(r.amount) + '</span>';
      li.querySelector(".import-row-check").addEventListener("change", function (ev) {
        importContext.parsed[idx].include = ev.target.checked;
      });
      previewList.appendChild(li);
    });

    $("import-step-mapping").hidden = true;
    $("import-step-review").hidden = false;
    $("import-step-actions").hidden = false;
  }

  function confirmImport() {
    var toImport = importContext.parsed.filter(function (r) { return r.include; });
    if (!toImport.length && !importContext.recurringGroups.some(function (g) { return g.addAsFixed; })) {
      showToast("No hay nada seleccionado para importar.");
      return;
    }

    var btn = $("btn-import-confirm");
    btn.disabled = true;
    btn.textContent = "Importando...";

    var batch = db.batch();
    var spaceId = state.space.id;
    var email = state.user.email || "";
    var displayName = state.user.displayName || "";

    toImport.forEach(function (r) {
      var ref = db.collection("expenses").doc();
      batch.set(ref, {
        spaceId: spaceId,
        amount: r.amount,
        category: r.category,
        type: importContext.type,
        affectsDebt: true,
        place: "",
        note: "Importado del banco: " + (r.concept || ""),
        lat: null,
        lng: null,
        uid: state.user.uid,
        email: email,
        displayName: displayName,
        photoURL: state.user.photoURL || "",
        payerEmail: email,
        expenseDate: r.date,
        tripGoalId: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    importContext.recurringGroups.filter(function (g) { return g.addAsFixed; }).forEach(function (g) {
      var ref = db.collection("fixed_expenses").doc();
      batch.set(ref, {
        spaceId: spaceId,
        email: email,
        label: g.label,
        amount: g.suggestedAmount,
        category: "gasto",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    batch.commit().then(function () {
      var fixedCount = importContext.recurringGroups.filter(function (g) { return g.addAsFixed; }).length;
      closeImportModal();
      showToast("¡Importados " + toImport.length + " gastos" + (fixedCount ? " y " + fixedCount + " gasto" + (fixedCount > 1 ? "s" : "") + " fijo" + (fixedCount > 1 ? "s" : "") : "") + "! 🎉");
    }).catch(function (err) {
      console.error(err);
      showToast("No se ha podido importar. Inténtalo otra vez.");
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = "Importar";
    });
  }

  function initImportModal() {
    $("btn-import-csv").addEventListener("click", openImportModal);
    document.querySelectorAll("[data-close-import]").forEach(function (el) {
      el.addEventListener("click", closeImportModal);
    });

    $("input-import-file").addEventListener("change", function (ev) {
      var file = ev.target.files[0];
      if (!file) return;
      var errEl = $("import-file-error");
      errEl.hidden = true;

      var reader = new FileReader();
      reader.onload = function () {
        var parsedCsv = parseCsvText(String(reader.result));
        if (!parsedCsv.rows.length) {
          errEl.textContent = "No hemos podido leer ninguna fila de ese archivo.";
          errEl.hidden = false;
          return;
        }
        importContext.headers = parsedCsv.headers;
        importContext.rows = parsedCsv.rows;
        importContext.mapping = guessColumnMapping(parsedCsv.headers);
        showMappingStep();
      };
      reader.onerror = function () {
        errEl.textContent = "No se ha podido leer el archivo.";
        errEl.hidden = false;
      };
      reader.readAsText(file, "UTF-8");
    });

    $("btn-import-preview").addEventListener("click", showReviewStep);
    $("btn-import-confirm").addEventListener("click", confirmImport);
  }

  /* ============ Main tabs (Conjunto / Personal / Deudas / Ahorros) ============ */

  function initMainTabs() {
    document.querySelectorAll(".main-tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.mainTab = btn.dataset.maintab;
        render();
      });
    });
  }

  /* ============ Deudas: añadir gasto compartido / saldar cuentas ============ */
  // "+ Añadir gasto compartido" abre el mismo formulario que un gasto conjunto
  // normal (mismo reparto al 50%) — así nunca se registra aquí un importe sin
  // repartir. "Marcar como saldado" calcula el importe exacto para dejar el
  // balance a cero, sin que nadie tenga que escribir una cantidad a mano.

  function initAddSharedButton() {
    $("btn-add-shared").addEventListener("click", openModal);
  }

  function initSettleUpButton() {
    $("btn-settle-up").addEventListener("click", function () {
      var half = computeDebtHalf();
      if (Math.abs(half) < 0.01) return;
      var payerEmail = half > 0 ? PARTNERS[1].email : PARTNERS[0].email;
      var amount = Math.abs(half);
      showConfirm(partnerLabel(payerEmail) + " le pagará " + fmtMoney(amount) + " a " + partnerLabel(half > 0 ? PARTNERS[0].email : PARTNERS[1].email) + ". ¿Marcar como saldado?").then(function (ok) {
        if (!ok) return;
        addSettlement(payerEmail, amount, "Saldado").then(function () {
          showToast("¡Cuentas saldadas! 🎉");
        }).catch(function (err) {
          console.error(err);
          showToast("No se ha podido registrar.");
        });
      });
    });
  }

  /* ============ Tabs ============ */

  function initTabs() {
    var btns = document.querySelectorAll(".tab-btn");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        btns.forEach(function (b) { b.classList.remove("active"); });
        document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
        btn.classList.add("active");
        $("tab-" + btn.dataset.tab).classList.add("active");
        if (btn.dataset.tab === "mapa") {
          setTimeout(function () {
            if (state.map) { state.map.invalidateSize(); fitMapToPoints(); }
          }, 50);
        }
      });
    });
  }

  function initMapRecenterButton() {
    $("btn-recenter-map").addEventListener("click", fitMapToPoints);
  }

  function initMonthSwitcher() {
    $("month-prev").addEventListener("click", function () { state.monthOffset -= 1; render(); });
    $("month-next").addEventListener("click", function () {
      if (state.monthOffset < 0) { state.monthOffset += 1; render(); }
    });
    // Antes esto era un <input type="month">: el desplegable nativo era feo,
    // distinto en cada navegador y solo se abría desde el icono. Ahora toda la
    // fecha es un botón que abre nuestro calendario.
    $("month-label-btn").addEventListener("click", openCalendar);
  }

  /* ============ Calendario del mes ============ */
  // Vista de calendario con el gasto de cada día a golpe de vista: el color
  // dice cuánto se gastó ese día comparado con un día normal vuestro, y los
  // puntos si fue conjunto, solo, o ambos.

  var WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

  // Un día "normal" es la MEDIANA de los días con gasto, no la media: así un
  // solo día desmadrado (un viaje, una mudanza) no distorsiona la escala y
  // hace que todo lo demás parezca barato.
  function medianOf(numbers) {
    if (!numbers.length) return 0;
    var sorted = numbers.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Agrupa los gastos del mes por día. Usa TODOS los gastos del mes (no solo
  // los de la pestaña activa) porque el calendario es una vista de conjunto.
  function dailyBreakdown() {
    var byDay = {};
    expensesOfMonth().forEach(function (e) {
      var day = e.date.getDate();
      if (!byDay[day]) byDay[day] = { total: 0, count: 0, conjunto: 0, individual: 0 };
      var d = byDay[day];
      d.total += e.amount;
      d.count += 1;
      if (e.type === "conjunto") d.conjunto += e.amount;
      else d.individual += e.amount;
    });
    return byDay;
  }

  function spendLevel(total, normalDay) {
    if (!total) return "";
    if (normalDay <= 0) return "level-low";
    if (total <= normalDay) return "level-low";
    if (total <= normalDay * 2) return "level-mid";
    return "level-high";
  }

  function openCalendar() {
    renderCalendar();
    $("calendar-dialog").hidden = false;
  }

  function closeCalendar() {
    $("calendar-dialog").hidden = true;
    $("calendar-day-detail").hidden = true;
  }

  function renderCalendar() {
    if (!state.space) return;
    var ref = currentMonthDate();
    var year = ref.getFullYear(), month = ref.getMonth();

    $("cal-title").textContent = MESES[month] + " " + year;
    $("cal-next").disabled = state.monthOffset >= 0;
    $("calendar-legend-types").hidden = isPersonalSpace();

    var byDay = dailyBreakdown();
    var normalDay = medianOf(Object.keys(byDay).map(function (k) { return byDay[k].total; }));

    var daysInMonth = new Date(year, month + 1, 0).getDate();
    // getDay() pone el domingo a 0; en España la semana empieza en lunes.
    var leading = (new Date(year, month, 1).getDay() + 6) % 7;

    var today = new Date();
    var isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    var grid = $("calendar-grid");
    grid.innerHTML = "";

    for (var i = 0; i < leading; i++) {
      var filler = document.createElement("span");
      filler.className = "cal-day cal-day-empty";
      grid.appendChild(filler);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var info = byDay[day];
      var total = info ? info.total : 0;
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cal-day " + spendLevel(total, normalDay);
      if (isCurrentMonth && today.getDate() === day) cell.classList.add("is-today");
      if (!info) cell.classList.add("cal-day-quiet");
      cell.dataset.day = String(day);

      var dots = "";
      if (info && info.conjunto > 0) dots += '<span class="cal-dot conjunto"></span>';
      if (info && info.individual > 0) dots += '<span class="cal-dot solo"></span>';

      cell.innerHTML =
        '<span class="cal-day-num">' + day + '</span>' +
        '<span class="cal-dots">' + dots + '</span>';

      cell.addEventListener("click", (function (d, dayInfo) {
        return function () { showCalendarDayDetail(d, dayInfo, year, month); };
      })(day, info));

      grid.appendChild(cell);
    }
  }

  function showCalendarDayDetail(day, info, year, month) {
    var box = $("calendar-day-detail");
    var weekday = WEEKDAY_NAMES[(new Date(year, month, day).getDay() + 6) % 7];
    var heading = weekday + " " + day + " de " + MESES[month];

    if (!info) {
      box.innerHTML = '<strong>' + heading + '</strong><span class="cal-detail-sub">Sin gastos este día 🌱</span>';
      box.hidden = false;
      return;
    }

    var parts = [];
    if (info.conjunto > 0) parts.push('<span class="cal-detail-chip"><span class="cal-dot conjunto"></span>Conjunto ' + fmtMoney(info.conjunto) + '</span>');
    if (info.individual > 0) parts.push('<span class="cal-detail-chip"><span class="cal-dot solo"></span>Solo ' + fmtMoney(info.individual) + '</span>');

    box.innerHTML =
      '<strong>' + heading + '</strong>' +
      '<span class="cal-detail-total">' + fmtMoney(info.total) + '</span>' +
      '<span class="cal-detail-sub">' + info.count + (info.count === 1 ? ' gasto' : ' gastos') + '</span>' +
      '<span class="cal-detail-chips">' + parts.join("") + '</span>';
    box.hidden = false;
  }

  function initCalendar() {
    $("cal-prev").addEventListener("click", function () {
      state.monthOffset -= 1;
      $("calendar-day-detail").hidden = true;
      render();
      renderCalendar();
    });
    $("cal-next").addEventListener("click", function () {
      if (state.monthOffset >= 0) return;
      state.monthOffset += 1;
      $("calendar-day-detail").hidden = true;
      render();
      renderCalendar();
    });
    $("cal-close").addEventListener("click", closeCalendar);
    $("cal-close-x").addEventListener("click", closeCalendar);
    $("calendar-dialog").querySelector("[data-calendar-close]").addEventListener("click", closeCalendar);
  }

  /* ============ Add-expense modal ============ */

  function initCategoryPicker() {
    var wrap = $("category-picker");
    wrap.innerHTML = "";
    CATEGORIES.forEach(function (c) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-chip" + (c.key === state.selectedCategory ? " selected" : "");
      btn.dataset.key = c.key;
      btn.innerHTML = '<span class="emoji">' + c.emoji + '</span>' + c.label;
      btn.addEventListener("click", function () {
        state.selectedCategory = c.key;
        wrap.querySelectorAll(".category-chip").forEach(function (el) {
          var active = el.dataset.key === c.key;
          el.classList.toggle("selected", active);
          el.style.borderColor = active ? c.color : "";
          el.style.background = active ? c.color + "1a" : "";
        });
      });
      wrap.appendChild(btn);
    });
  }

  function initPayerPicker() {
    var wrap = $("payer-picker");
    wrap.innerHTML = "";
    PARTNERS.filter(function (p) { return p.email; }).forEach(function (p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (p.email === state.selectedPayer ? " selected" : "");
      btn.dataset.email = p.email;
      btn.textContent = p.label;
      btn.addEventListener("click", function () {
        state.selectedPayer = p.email;
        wrap.querySelectorAll(".type-chip").forEach(function (el) {
          el.classList.toggle("selected", el.dataset.email === p.email);
        });
      });
      wrap.appendChild(btn);
    });
  }

  function initTypePicker() {
    var wrap = $("type-picker");
    wrap.innerHTML = "";
    TYPES.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (t.key === state.selectedType ? " selected" : "");
      btn.dataset.key = t.key;
      btn.innerHTML = '<span class="emoji">' + t.emoji + '</span>' + t.label;
      btn.addEventListener("click", function () {
        state.selectedType = t.key;
        wrap.querySelectorAll(".type-chip").forEach(function (el) {
          el.classList.toggle("selected", el.dataset.key === t.key);
        });
        updateAffectsDebtVisibility();
      });
      wrap.appendChild(btn);
    });
  }

  function updateAffectsDebtVisibility() {
    $("affects-debt-field").hidden = state.selectedType !== "conjunto";
  }

  function initAffectsDebtPicker() {
    var wrap = $("affects-debt-picker");
    wrap.innerHTML = "";
    [{ key: true, label: "Sí, se descuenta" }, { key: false, label: "No, no se descuenta" }].forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (opt.key === state.selectedAffectsDebt ? " selected" : "");
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        state.selectedAffectsDebt = opt.key;
        wrap.querySelectorAll(".type-chip").forEach(function (el, i) {
          el.classList.toggle("selected", i === (opt.key ? 0 : 1));
        });
      });
      wrap.appendChild(btn);
    });
  }

  // Mientras hay un viaje activo, por defecto se asume que todo lo que se
  // apunta es del viaje (para eso está activado) — pero se puede desmarcar
  // si es algo suelto que no tiene que ver (una suscripción que se cobra
  // esos días, por ejemplo).
  function updateTripExpenseVisibility() {
    var trip = activeTrip();
    var field = $("trip-expense-field");
    if (!trip) { field.hidden = true; return; }
    field.hidden = false;
    $("trip-expense-label").textContent = "¿Es del viaje a " + trip.name.replace(/^Viaje a /i, "") + "?";
  }

  function initTripExpensePicker() {
    var wrap = $("trip-expense-picker");
    wrap.innerHTML = "";
    [{ key: true, label: "Sí" }, { key: false, label: "No, es aparte" }].forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (opt.key === state.selectedIsTripExpense ? " selected" : "");
      btn.dataset.key = String(opt.key);
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        state.selectedIsTripExpense = opt.key;
        wrap.querySelectorAll(".type-chip").forEach(function (el) {
          el.classList.toggle("selected", el.dataset.key === String(opt.key));
        });
      });
      wrap.appendChild(btn);
    });
  }

  // Guarda un gasto respetando el presupuesto del viaje: si cabe entero en lo
  // que queda del bote, se guarda como "del viaje" (no aparece en las
  // cuentas normales del mes). Si no cabe del todo, se PARTE en dos gastos
  // reales: la parte que sí cabía (viaje) y la que sobra (gasto conjunto
  // normal, con su reparto de deudas de siempre). Así nunca hay que adivinar
  // luego "a partir de qué gasto exacto nos pasamos del presupuesto".
  function withTripFields(payload, tripGoalId, extraNote) {
    var copy = {};
    for (var key in payload) { if (payload.hasOwnProperty(key)) copy[key] = payload[key]; }
    copy.tripGoalId = tripGoalId;
    if (!tripGoalId) { copy.type = "conjunto"; copy.affectsDebt = true; }
    if (extraNote) copy.note = (copy.note ? copy.note + " " : "") + extraNote;
    return copy;
  }

  function saveExpenseAsTrip(payload, trip) {
    var roomLeft = Math.max(0, trip.tripBudget - tripSpent(trip.id));
    var amount = payload.amount;

    if (roomLeft <= 0) {
      return addExpense(withTripFields(payload, null));
    }
    if (amount <= roomLeft) {
      return addExpense(withTripFields(payload, trip.id));
    }

    var tripPart = withTripFields(payload, trip.id);
    tripPart.amount = Math.round(roomLeft * 100) / 100;
    var overPart = withTripFields(payload, null, "(exceso del presupuesto del viaje)");
    overPart.amount = Math.round((amount - roomLeft) * 100) / 100;

    return Promise.all([addExpense(tripPart), addExpense(overPart)]);
  }

  function nowForDateInput() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function isPersonalSpace() {
    return !!(state.space && state.space.type === "personal");
  }

  // En un espacio personal solo hay una persona, así que no tiene sentido
  // elegir "¿quién paga?" ni "¿conjunto o individual?" — se fuerza siempre
  // a individual/tú mismo y se ocultan esos campos.
  function updateSoloFieldsVisibility() {
    var solo = isPersonalSpace();
    $("payer-field").hidden = solo;
    $("type-field").hidden = solo;
    if (solo) $("affects-debt-field").hidden = true;
  }

  function openModal() {
    state.editingExpenseId = null;
    state.locatedCoords = null;
    $("form-add").reset();
    $("locate-status").textContent = "";
    hidePlaceSuggestions();
    $("input-date").value = nowForDateInput();
    state.selectedCategory = CATEGORIES[0].key;
    state.selectedType = isPersonalSpace() ? "individual" : currentExpenseType();
    state.selectedAffectsDebt = true;
    state.selectedIsTripExpense = true;
    state.selectedPayer = state.user ? state.user.email : (PARTNERS[0] ? PARTNERS[0].email : "");
    $("modal-title").textContent = "Nuevo gasto";
    $("btn-save").textContent = "Guardar gasto";
    initCategoryPicker();
    initTypePicker();
    initAffectsDebtPicker();
    updateAffectsDebtVisibility();
    updateSoloFieldsVisibility();
    initTripExpensePicker();
    updateTripExpenseVisibility();
    initPayerPicker();
    $("modal-add").hidden = false;
    setTimeout(function () { $("input-amount").focus(); }, 250);
  }

  function openModalForEdit(expense) {
    state.editingExpenseId = expense.id;
    state.locatedCoords = (expense.lat != null && expense.lng != null) ? { lat: expense.lat, lng: expense.lng } : null;
    $("form-add").reset();
    $("input-amount").value = expense.amount;
    $("input-place").value = expense.place;
    $("input-note").value = expense.note;
    var d = new Date(expense.date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $("input-date").value = d.toISOString().slice(0, 16);
    $("locate-status").textContent = state.locatedCoords ? "📍 Ubicación guardada" : "";
    hidePlaceSuggestions();
    state.selectedCategory = expense.category;
    state.selectedType = expense.type;
    state.selectedAffectsDebt = expense.affectsDebt !== false;
    state.selectedPayer = expense.payerEmail || (state.user ? state.user.email : (PARTNERS[0] ? PARTNERS[0].email : ""));
    $("modal-title").textContent = "Editar gasto";
    $("btn-save").textContent = "Guardar cambios";
    initCategoryPicker();
    initTypePicker();
    initAffectsDebtPicker();
    updateAffectsDebtVisibility();
    updateSoloFieldsVisibility();
    // El reparto automático con el presupuesto del viaje solo se aplica al
    // crear un gasto nuevo, no al editar uno ya guardado.
    $("trip-expense-field").hidden = true;
    initPayerPicker();
    $("modal-add").hidden = false;
    setTimeout(function () { $("input-amount").focus(); }, 250);
  }

  function closeModal() {
    $("modal-add").hidden = true;
    state.editingExpenseId = null;
    hidePlaceSuggestions();
  }

  /* ============ Tu perfil: nombre, avatar y nombre del espacio ============ */

  // Con quién has iniciado sesión. Útil de verdad si tienes varias cuentas de
  // Google en el mismo navegador: así ves de un vistazo si estás en la que
  // tocaba antes de apuntar algo en el espacio equivocado.
  function renderProfileAccount() {
    if (!state.user) return;
    $("profile-account-avatar").textContent = getAvatar(state.user.email);
    $("profile-account-name").textContent = myDisplayName();
    $("profile-account-email").textContent = state.user.email;
  }

  // Los miembros del espacio con su nombre y correo. No es un problema de
  // privacidad: solo se ve dentro de un espacio al que os habéis invitado
  // mutuamente, y las reglas de Firestore impiden leerlo desde fuera.
  function renderSpaceMembers() {
    var block = $("space-members-block");
    var list = $("space-members-list");
    if (!block || !list) return;

    if (!state.space) { block.hidden = true; return; }
    var emails = state.space.memberEmails || [];
    // En un espacio personal solo estás tú: la lista no aporta nada.
    if (isPersonalSpace() || emails.length < 2) { block.hidden = true; return; }

    block.hidden = false;
    list.innerHTML = "";
    emails.forEach(function (email) {
      var info = state.spaceMembers.find(function (m) { return m.email === email; });
      var label = (info && info.label) || firstName(email.split("@")[0]);
      var isMe = state.user && email === state.user.email;
      var row = document.createElement("div");
      row.className = "space-member-row";
      row.innerHTML =
        '<span class="space-member-avatar">' + getAvatar(email) + '</span>' +
        '<span class="space-member-info">' +
        '<span class="space-member-name">' + escapeHtml(label) + (isMe ? ' <span class="space-member-you">(tú)</span>' : '') + '</span>' +
        '<span class="space-member-email">' + escapeHtml(email) + '</span>' +
        '</span>';
      list.appendChild(row);
    });
  }

  /* ============ Copiar gastos fijos de otro espacio ============ */
  // Los espacios están aislados a propósito (lo de Sofía no se mezcla con lo
  // tuyo), pero eso obliga a reescribir a mano cosas que son iguales en los
  // dos — el gimnasio, el coche... Esto los copia, sin moverlos: siguen
  // estando también en el espacio de origen.

  var importFixedContext = { fromSpaceId: null, items: [] };

  function openImportFixedModal() {
    importFixedContext = { fromSpaceId: null, items: [] };
    $("import-fixed-step-space").hidden = false;
    $("import-fixed-step-pick").hidden = true;
    $("import-fixed-empty").hidden = true;
    $("import-fixed-space-list").innerHTML = '<p class="empty-hint">Buscando...</p>';
    $("modal-import-fixed").hidden = false;

    listUserSpaceIds(state.user.email).then(function (ids) {
      var others = ids.filter(function (id) { return id !== state.space.id; });
      if (!others.length) {
        $("import-fixed-space-list").innerHTML = "";
        $("import-fixed-empty").hidden = false;
        return;
      }
      // Solo se ofrecen los espacios que de verdad tienen gastos fijos: dar a
      // elegir uno vacío para luego decir "no hay nada" sería marear.
      return Promise.all(others.map(function (id) {
        return Promise.all([
          db.collection("spaces").doc(id).get(),
          db.collection("fixed_expenses").where("spaceId", "==", id).get()
        ]).then(function (r) {
          if (!r[0].exists || r[1].empty) return null;
          var d = r[0].data();
          return {
            id: id,
            name: d.name || (d.type === "personal" ? "Espacio personal" : "Espacio en pareja"),
            type: d.type || "pareja",
            count: r[1].size
          };
        }).catch(function () { return null; });
      })).then(function (spaces) {
        var valid = spaces.filter(Boolean);
        var wrap = $("import-fixed-space-list");
        wrap.innerHTML = "";
        if (!valid.length) { $("import-fixed-empty").hidden = false; return; }
        valid.forEach(function (sp) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "space-picker-item";
          btn.innerHTML =
            '<span class="space-picker-emoji">' + (sp.type === "personal" ? "🙋" : "🤝") + '</span>' +
            '<span class="space-picker-body">' +
            '<span class="space-picker-title">' + escapeHtml(sp.name) + '</span>' +
            '<span class="space-picker-sub">' + sp.count + (sp.count === 1 ? ' gasto fijo' : ' gastos fijos') + '</span>' +
            '</span>';
          btn.addEventListener("click", function () { loadFixedFromSpace(sp.id); });
          wrap.appendChild(btn);
        });
      });
    }).catch(function (err) {
      console.error(err);
      $("import-fixed-space-list").innerHTML = '<p class="empty-hint">No se han podido cargar tus espacios.</p>';
    });
  }

  function loadFixedFromSpace(spaceId) {
    importFixedContext.fromSpaceId = spaceId;
    db.collection("fixed_expenses").where("spaceId", "==", spaceId).get().then(function (snap) {
      // Lo que ya existe aquí con el mismo nombre se marca para no duplicar.
      var existingLabels = state.fixedExpenses
        .filter(function (f) { return f.email === state.user.email; })
        .map(function (f) { return (f.label || "").toLowerCase().trim(); });

      importFixedContext.items = snap.docs.map(function (d) {
        var x = d.data();
        var label = x.label || "";
        return {
          label: label,
          amount: Number(x.amount) || 0,
          category: x.category === "ahorro" ? "ahorro" : "gasto",
          alreadyHere: existingLabels.indexOf(label.toLowerCase().trim()) !== -1,
          include: existingLabels.indexOf(label.toLowerCase().trim()) === -1
        };
      });

      var wrap = $("import-fixed-list");
      wrap.innerHTML = "";
      importFixedContext.items.forEach(function (item, idx) {
        var row = document.createElement("label");
        row.className = "import-fixed-row" + (item.alreadyHere ? " already" : "");
        row.innerHTML =
          '<input type="checkbox" data-idx="' + idx + '"' + (item.include ? " checked" : "") + '>' +
          '<span class="import-fixed-icon">' + (item.category === "ahorro" ? "🐷" : "💸") + '</span>' +
          '<span class="import-fixed-body">' +
          '<span class="import-fixed-label">' + escapeHtml(item.label) + '</span>' +
          (item.alreadyHere ? '<span class="import-fixed-sub">ya lo tienes aquí</span>' : '') +
          '</span>' +
          '<span class="import-fixed-amount">' + fmtMoney(item.amount) + '</span>';
        row.querySelector("input").addEventListener("change", function (ev) {
          importFixedContext.items[idx].include = ev.target.checked;
        });
        wrap.appendChild(row);
      });

      $("import-fixed-step-space").hidden = true;
      $("import-fixed-step-pick").hidden = false;
    }).catch(function (err) {
      console.error(err);
      showToast("No se han podido cargar los gastos fijos.");
    });
  }

  function confirmImportFixed() {
    var chosen = importFixedContext.items.filter(function (i) { return i.include; });
    if (!chosen.length) { showToast("No has marcado ninguno."); return; }

    var btn = $("btn-confirm-import-fixed");
    btn.disabled = true;
    var batch = db.batch();
    chosen.forEach(function (item) {
      var ref = db.collection("fixed_expenses").doc();
      batch.set(ref, {
        spaceId: state.space.id,
        email: state.user.email,
        label: item.label,
        amount: item.amount,
        category: item.category,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    batch.commit().then(function () {
      $("modal-import-fixed").hidden = true;
      showToast("¡Copiados " + chosen.length + " gasto" + (chosen.length > 1 ? "s" : "") + " fijo" + (chosen.length > 1 ? "s" : "") + "! 🎉");
    }).catch(function (err) {
      console.error(err);
      showToast("No se han podido copiar.");
    }).finally(function () {
      btn.disabled = false;
    });
  }

  function initImportFixedModal() {
    $("btn-open-import-fixed").addEventListener("click", function () {
      $("avatar-picker").hidden = true;
      openImportFixedModal();
    });
    document.querySelectorAll("[data-close-import-fixed]").forEach(function (el) {
      el.addEventListener("click", function () { $("modal-import-fixed").hidden = true; });
    });
    $("btn-confirm-import-fixed").addEventListener("click", confirmImportFixed);
  }

  function initAvatarPicker() {
    var grid = $("avatar-grid");
    grid.innerHTML = "";
    AVATAR_EMOJIS.forEach(function (emoji) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "avatar-choice";
      btn.textContent = emoji;
      btn.addEventListener("click", function () {
        if (!state.user) return;
        // Ya NO se cierra el modal al elegir avatar: ahora también hay
        // nombres que editar aquí, y cerrarlo de golpe obligaba a volver a
        // abrirlo para cambiar lo demás.
        grid.querySelectorAll(".avatar-choice").forEach(function (el) {
          el.classList.toggle("selected", el === btn);
        });
        setAvatar(state.user.email, emoji).catch(function (err) {
          console.error(err);
          showToast("No se ha podido guardar el avatar.");
        });
      });
      grid.appendChild(btn);
    });

    $("user-avatar-btn").addEventListener("click", function () {
      grid.querySelectorAll(".avatar-choice").forEach(function (btn) {
        btn.classList.toggle("selected", state.user && btn.textContent === getAvatar(state.user.email));
      });
      $("input-my-name").value = myDisplayName();
      $("input-space-name").value = (state.space && state.space.name) || "";
      $("space-name-block").hidden = !state.space;
      renderProfileAccount();
      renderSpaceMembers();
      $("import-fixed-block").hidden = !state.space;
      $("avatar-picker").hidden = false;
    });

    $("btn-save-my-name").addEventListener("click", function () {
      var name = $("input-my-name").value.trim().slice(0, 20);
      if (!name) { showToast("Escribe un nombre."); return; }
      var btn = $("btn-save-my-name");
      btn.disabled = true;
      setMyDisplayName(name).then(function () {
        showToast("¡Nombre guardado! 🎉");
      }).catch(function (err) {
        console.error(err);
        showToast("No se ha podido guardar el nombre.");
      }).finally(function () { btn.disabled = false; });
    });

    $("btn-save-space-name").addEventListener("click", function () {
      if (!state.space) return;
      var name = $("input-space-name").value.trim().slice(0, 30);
      var btn = $("btn-save-space-name");
      btn.disabled = true;
      setSpaceName(name).then(function () {
        showToast(name ? "¡Espacio renombrado! 🎉" : "Nombre del espacio quitado.");
      }).catch(function (err) {
        console.error(err);
        showToast("No se ha podido guardar el nombre del espacio.");
      }).finally(function () { btn.disabled = false; });
    });

    $("avatar-cancel").addEventListener("click", function () { $("avatar-picker").hidden = true; });
    $("avatar-picker").querySelector("[data-avatar-cancel]").addEventListener("click", function () {
      $("avatar-picker").hidden = true;
    });
  }


  function initModal() {
    $("fab-add").addEventListener("click", openModal);
    document.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });

    // 📍 ya no solo captura coordenadas: pregunta a Photon qué hay alrededor y
    // te ofrece los sitios concretos, para que estando en el bar solo tengas
    // que tocar su nombre en vez de escribirlo.
    $("btn-locate").addEventListener("click", function () {
      var btn = $("btn-locate");
      var status = $("locate-status");
      if (!navigator.geolocation) {
        status.textContent = "Este dispositivo no permite geolocalización.";
        return;
      }
      btn.classList.add("loading");
      status.textContent = "Localizando...";
      hidePlaceSuggestions();
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        state.locatedCoords = { lat: lat, lng: lng };
        status.textContent = "📍 Ubicación capturada";
        nearbyPlaces(lat, lng).then(function (items) {
          btn.classList.remove("loading");
          if (!items.length) return;
          showPlaceSuggestions(items, "¿Estás en alguno de estos?");
        }).catch(function () {
          btn.classList.remove("loading");
        });
      }, function (err) {
        console.error(err);
        btn.classList.remove("loading");
        status.textContent = err.code === 1
          ? "Ubicación bloqueada. Permite el acceso en los ajustes del sitio y vuelve a intentarlo."
          : "No hemos podido acceder a tu ubicación.";
      }, { enableHighAccuracy: true, timeout: 8000 });
    });

    initPlaceAutocomplete();

    $("form-add").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var amount = parseFloat($("input-amount").value);
      if (!amount || amount <= 0) { showToast("Pon un importe válido."); return; }

      var dateValue = $("input-date").value;
      var expenseDate = dateValue ? new Date(dateValue) : new Date();

      var payload = {
        amount: Math.round(amount * 100) / 100,
        category: state.selectedCategory,
        type: state.selectedType,
        affectsDebt: state.selectedType === "conjunto" ? state.selectedAffectsDebt : true,
        payerEmail: state.selectedPayer,
        place: $("input-place").value.trim(),
        note: $("input-note").value.trim(),
        lat: state.locatedCoords ? state.locatedCoords.lat : null,
        lng: state.locatedCoords ? state.locatedCoords.lng : null,
        expenseDate: expenseDate
      };

      var isEditing = !!state.editingExpenseId;
      var trip = !isEditing ? activeTrip() : null;
      var savingAsTrip = trip && state.selectedIsTripExpense;

      var saveBtn = $("btn-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Guardando...";
      var op = isEditing
        ? updateExpense(state.editingExpenseId, payload)
        : (savingAsTrip ? saveExpenseAsTrip(payload, trip) : addExpense(payload));
      op.then(function () {
        closeModal();
        showToast(isEditing ? "¡Cambios guardados! 🎉" : "¡Gasto guardado! 🎉");
        if (!isEditing && !savingAsTrip) notifyPartnerOfExpense(payload);
      }).catch(function (err) {
        console.error(err);
        showToast("No se ha podido guardar. Inténtalo otra vez.");
      }).finally(function () {
        saveBtn.disabled = false;
        saveBtn.textContent = isEditing ? "Guardar cambios" : "Guardar gasto";
      });
    });
  }

  /* ============ Buscador de sitios (autocompletar) ============ */
  // Usamos Photon (photon.komoot.io) en vez de Nominatim porque Nominatim
  // PROHÍBE expresamente el autocompletado ("as you type") y banea por ello:
  // su motor no busca por prefijos y sus servidores son donados. Photon está
  // hecho justo para esto, es gratis y no necesita clave. Aun así pedimos con
  // cabeza (mínimo 3 letras y una pausa al teclear) porque también pide no
  // abusar; si algún día esto crece, toca alojar nuestro propio Photon.
  var PHOTON_URL = "https://photon.komoot.io";
  var PLACE_DEBOUNCE_MS = 350;
  var PLACE_MIN_CHARS = 3;

  // Etiqueta legible a partir de un resultado de Photon: arriba el nombre del
  // sitio (o la calle con su número si no tiene nombre) y debajo el contexto
  // para distinguir dos sitios que se llamen igual.
  function formatPhotonFeature(feature) {
    var p = feature.properties || {};
    var coords = (feature.geometry && feature.geometry.coordinates) || [];
    var streetLine = [p.street, p.housenumber].filter(Boolean).join(" ");
    var title = p.name || streetLine || p.city || p.county || "Sitio sin nombre";
    var contextParts = [];
    if (p.name && streetLine) contextParts.push(streetLine);
    if (p.city && p.city !== title) contextParts.push(p.city);
    if (p.state && p.state !== p.city) contextParts.push(p.state);
    return {
      title: title,
      context: contextParts.join(" · "),
      lat: coords[1],
      lng: coords[0]
    };
  }

  function parsePhotonResponse(data) {
    var features = (data && data.features) || [];
    return features
      .map(formatPhotonFeature)
      .filter(function (item) { return item.lat != null && item.lng != null; });
  }

  // Sesgo de cercanía: si ya hay gastos con coordenadas, damos por hecho que
  // os movéis por esa zona, así "Mercadona" saca el de al lado y no uno de
  // otra provincia. Sale gratis y no hace falta pedir permiso de ubicación.
  function biasCoords() {
    if (state.locatedCoords) return state.locatedCoords;
    var withCoords = state.allExpenses.filter(function (e) { return e.lat != null && e.lng != null; });
    if (!withCoords.length) return null;
    var latest = withCoords.reduce(function (a, b) { return b.date > a.date ? b : a; });
    return { lat: latest.lat, lng: latest.lng };
  }

  // Sin parámetro "lang" a propósito: Photon solo acepta default/de/en/fr
  // (con lang=es responde 400). El modo por defecto devuelve el nombre en el
  // idioma local del sitio, así que en España ya salen en castellano.
  function searchPlaces(query, signal) {
    var url = PHOTON_URL + "/api?q=" + encodeURIComponent(query) + "&limit=6";
    var bias = biasCoords();
    if (bias) url += "&lat=" + bias.lat + "&lon=" + bias.lng;
    return fetch(url, { signal: signal, headers: { "Accept": "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("photon " + r.status);
        return r.json();
      })
      .then(parsePhotonResponse);
  }

  function nearbyPlaces(lat, lng) {
    var url = PHOTON_URL + "/reverse?lat=" + lat + "&lon=" + lng + "&limit=6";
    return fetch(url, { headers: { "Accept": "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("photon " + r.status);
        return r.json();
      })
      .then(parsePhotonResponse);
  }

  function hidePlaceSuggestions() {
    $("place-suggestions").hidden = true;
    $("place-suggestions").innerHTML = "";
    $("place-suggestions-title").hidden = true;
  }

  function showPlaceSuggestions(items, titleText) {
    var ul = $("place-suggestions");
    var titleEl = $("place-suggestions-title");
    ul.innerHTML = "";

    if (titleText) {
      titleEl.textContent = titleText;
      titleEl.hidden = false;
    } else {
      titleEl.hidden = true;
    }

    items.forEach(function (item) {
      var li = document.createElement("li");
      li.innerHTML =
        '<button type="button" class="place-suggestion">' +
        '<span class="ps-title">' + escapeHtml(item.title) + '</span>' +
        (item.context ? '<span class="ps-context">' + escapeHtml(item.context) + '</span>' : '') +
        '</button>';
      li.querySelector("button").addEventListener("click", function () {
        $("input-place").value = item.title;
        state.locatedCoords = { lat: item.lat, lng: item.lng };
        $("locate-status").textContent = "📍 " + item.title;
        hidePlaceSuggestions();
      });
      ul.appendChild(li);
    });

    ul.hidden = items.length === 0;

    // La hoja del formulario hace scroll, así que las sugerencias pueden
    // quedar fuera de la vista al aparecer. Las acercamos con suavidad.
    if (!ul.hidden && ul.scrollIntoView) {
      setTimeout(function () {
        ul.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }
  }

  function initPlaceAutocomplete() {
    var input = $("input-place");
    var timer = null;
    var controller = null;

    input.addEventListener("input", function () {
      var query = input.value.trim();
      clearTimeout(timer);
      // Al escribir a mano, las coordenadas de una sugerencia anterior ya no
      // valen: si no eliges otra, se guarda solo el texto, sin punto falso.
      state.locatedCoords = null;
      $("locate-status").textContent = "";

      if (query.length < PLACE_MIN_CHARS) {
        hidePlaceSuggestions();
        return;
      }

      timer = setTimeout(function () {
        if (controller) controller.abort();
        controller = new AbortController();
        searchPlaces(query, controller.signal).then(function (items) {
          if (input.value.trim() !== query) return; // ya siguió escribiendo
          showPlaceSuggestions(items, null);
          if (!items.length) $("locate-status").textContent = "Sin resultados. Prueba a añadir la ciudad.";
        }).catch(function (err) {
          if (err.name === "AbortError") return;
          console.error(err);
          hidePlaceSuggestions();
        });
      }, PLACE_DEBOUNCE_MS);
    });
  }

  /* ============ Boot ============ */

  document.addEventListener("DOMContentLoaded", function () {
    safe(initFirebase, "initFirebase");
    safe(initDevLogin, "initDevLogin");
    safe(initPushNotifications, "initPushNotifications");
    safe(initOnboarding, "initOnboarding");
    safe(initMainTabs, "initMainTabs");
    safe(initTabs, "initTabs");
    safe(initMapRecenterButton, "initMapRecenterButton");
    safe(initExportCsv, "initExportCsv");
    safe(initImportModal, "initImportModal");
    safe(initMonthSwitcher, "initMonthSwitcher");
    safe(initCalendar, "initCalendar");
    safe(initModal, "initModal");
    safe(initAvatarPicker, "initAvatarPicker");
    safe(initImportFixedModal, "initImportFixedModal");
    safe(initExpenseListActions, "initExpenseListActions");
    safe(initAddSharedButton, "initAddSharedButton");
    safe(initSettleUpButton, "initSettleUpButton");
    safe(initLoans, "initLoans");
    safe(initGoalModal, "initGoalModal");
    safe(initEndTripDialog, "initEndTripDialog");
    safe(initTripBanner, "initTripBanner");
    safe(function () { $("btn-google").addEventListener("click", signIn); }, "bindGoogleButton");
    safe(function () { $("btn-logout").addEventListener("click", signOut); }, "bindLogoutButton");
    safe(function () {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js").then(function (reg) {
          state.swRegistration = reg;
        });
      }
    }, "registerServiceWorker");
  });
})();
