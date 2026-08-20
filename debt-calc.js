// Cálculo económico puro (reparto 50/50 actual), extraído de app.js para
// poder testearlo sin depender de `state`, Firestore ni el DOM.
//
// Mismo comportamiento exacto que las funciones equivalentes de app.js
// (debtExpenses/computeDebtHalf) — esto es una extracción, no un cambio del
// cálculo. app.js las llama pasándoles sus propios datos (ver app.js).
//
// Funciona tanto en Node (require) como en el navegador (<script> normal,
// expone window.DebtCalc) sin build ni módulos ES.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DebtCalc = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function isDebtExpense(e) {
    return e.type === "conjunto" && e.affectsDebt;
  }

  function debtExpenses(expenses) {
    return expenses.filter(isDebtExpense);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // partners: [{email}, {email}], mismo orden que PARTNERS en app.js.
  // Signo: positivo = partners[1] debe a partners[0], negativo = al revés.
  function computeDebtHalf(expenses, settlements, partners) {
    var totals = {};
    partners.forEach(function (p) { totals[p.email] = 0; });
    debtExpenses(expenses).forEach(function (e) {
      if (totals.hasOwnProperty(e.payerEmail)) totals[e.payerEmail] += e.amount;
    });
    var diff = totals[partners[0].email] - totals[partners[1].email];
    var half = diff / 2;
    settlements.forEach(function (s) {
      if (s.payerEmail === partners[0].email) half += s.amount;
      else if (s.payerEmail === partners[1].email) half -= s.amount;
    });
    return round2(half);
  }

  /* ============ Fase 3: economicSplit (paidBy sigue siendo payerEmail) ============
   *
   * Ver PHASE3_ECONOMIC_SPLIT_DESIGN.md y PHASE3_IMPLEMENTATION.md para el
   * diseño completo. Nada de esto cambia computeDebtHalf() de arriba —
   * es aditivo, computeBalanceCents() es una función nueva y separada.
   */

  function toCents(amountEuros) {
    return Math.round(amountEuros * 100);
  }

  function fromCents(cents) {
    return cents / 100;
  }

  // shares: [{email, bp}, ...] — bp = puntos base, 10000 = 100%.
  // Rechaza (null) si no suman exactamente 10000, o si payerEmail no está
  // entre las partes — nunca "arregla" un porcentaje que no cuadra.
  // La parte del pagador es siempre el resto (totalCents - las demás,
  // calculadas con floor) — así el céntimo impar de redondear un
  // porcentaje ya válido cae siempre del lado de quien paga, nunca de la
  // posición que ocupe en el array.
  function buildSplitFromPercent(totalCents, shares, payerEmail) {
    var sumBp = shares.reduce(function (s, x) { return s + x.bp; }, 0);
    if (sumBp !== 10000) return null;

    var payerShare = null;
    for (var i = 0; i < shares.length; i++) {
      if (shares[i].email === payerEmail) { payerShare = shares[i]; break; }
    }
    if (!payerShare) return null;

    var result = {}, otherTotal = 0;
    shares.forEach(function (s) {
      if (s.email === payerEmail) return;
      var cents = Math.floor(totalCents * s.bp / 10000);
      result[s.email] = cents;
      otherTotal += cents;
    });
    result[payerEmail] = totalCents - otherTotal;
    return result;
  }

  // shares: [{email, cents}, ...] ya en céntimos, tal cual los introdujo la
  // persona. Si no suman totalCents exacto, se rechaza (null) — nunca se
  // reparte el resto en su lugar, porque aquí un desajuste es un error de
  // entrada, no un residuo de redondeo.
  function buildSplitFromAmounts(totalCents, shares) {
    var sum = shares.reduce(function (s, x) { return s + x.cents; }, 0);
    if (sum !== totalCents) return null;
    var result = {};
    shares.forEach(function (s) { result[s.email] = s.cents; });
    return result;
  }

  // Reparto 50/50 explícito para materializar un economicSplit nuevo (no se
  // usa dentro de computeBalanceCents — ver el porqué en
  // PHASE3_IMPLEMENTATION.md, sección "por qué el fallback legacy no
  // reutiliza esta función").
  function defaultSplitCents(totalCents, payerEmail, otherEmail) {
    return buildSplitFromPercent(totalCents, [
      { email: payerEmail, bp: 5000 },
      { email: otherEmail, bp: 5000 }
    ], payerEmail);
  }

  function validateEconomicSplit(totalCents, split, memberEmails) {
    if (!split || typeof split !== "object") return false;
    var keys = Object.keys(split);
    if (keys.length !== memberEmails.length) return false;
    for (var i = 0; i < keys.length; i++) {
      if (memberEmails.indexOf(keys[i]) === -1) return false;
    }
    var sum = 0;
    for (var j = 0; j < keys.length; j++) {
      var v = split[keys[j]];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return false;
      sum += v;
    }
    return sum === totalCents;
  }

  function validatePayerEmail(payerEmail, memberEmails) {
    return memberEmails.indexOf(payerEmail) !== -1;
  }

  // Balance en céntimos, generalización de computeDebtHalf() que entiende
  // economicSplit. Mismo convenio de signo: positivo = partners[1] debe a
  // partners[0].
  //
  // Gastos SIN economicSplit (legacy): se acumulan en "legacyPaid" por
  // separado y se resuelven al final con diff/2 — la MISMA fórmula que
  // computeDebtHalf(), sin redondear todavía. Esto es a propósito: repartir
  // cada gasto legacy individualmente con floor/resto (como hace
  // buildSplitFromPercent) acumula un sesgo de redondeo por gasto que NO
  // coincide con "sumar todo en euros y redondear una sola vez al final" —
  // ver PHASE3_IMPLEMENTATION.md para el contraejemplo numérico que lo
  // demostró. Por eso el fallback legacy no llama a defaultSplitCents().
  //
  // Gastos CON economicSplit: se validan (si no son válidos, se lanza un
  // error — nunca se hace fallback 50/50 en silencio sobre un dato
  // corrupto) y aportan un importe ya exacto, sin ambigüedad de redondeo.
  function computeBalanceCents(expenses, settlements, partners) {
    var p0 = partners[0].email, p1 = partners[1].email;
    var memberEmails = [p0, p1];
    var legacyPaid0 = 0, legacyPaid1 = 0;
    var explicitNet0 = 0;

    debtExpenses(expenses).forEach(function (e) {
      var totalCents = toCents(e.amount);

      if (e.economicSplit == null) {
        if (e.payerEmail === p0) legacyPaid0 += totalCents;
        else if (e.payerEmail === p1) legacyPaid1 += totalCents;
        return;
      }

      if (!validateEconomicSplit(totalCents, e.economicSplit, memberEmails)) {
        throw new Error(
          "economicSplit invalido: " + JSON.stringify(e.economicSplit) +
          " no es un reparto valido para " + totalCents + " centimos entre " +
          JSON.stringify(memberEmails)
        );
      }

      var paid0Here = e.payerEmail === p0 ? totalCents : 0;
      explicitNet0 += paid0Here - e.economicSplit[p0];
    });

    var legacyHalf = (legacyPaid0 - legacyPaid1) / 2;
    var totalCentsBalance = explicitNet0 + legacyHalf;

    settlements.forEach(function (s) {
      var sCents = toCents(s.amount);
      if (s.payerEmail === p0) totalCentsBalance += sCents;
      else if (s.payerEmail === p1) totalCentsBalance -= sCents;
    });

    return Math.round(totalCentsBalance);
  }

  /* ============ Fase 4/5: reparto habitual + edición de gastos ============ */

  // Reparto habitual efectivo de un espacio, según PHASE4_DEFAULT_SPLIT_DESIGN.md:
  //   - espacio personal, o pareja con menos de 2 miembros -> null (no aplica)
  //   - defaultSplitBp presente y válido -> se usa tal cual
  //   - ausente, o presente pero inválido -> 50/50 (ausente es normal;
  //     inválido es un estado de recuperación que las reglas de Firestore
  //     deberían impedir, pero aquí no se distingue el resultado numérico)
  function resolveDefaultSplitBp(spaceType, memberEmails, defaultSplitBp) {
    if (spaceType !== "pareja") return null;
    if (!memberEmails || memberEmails.length !== 2) return null;
    if (defaultSplitBp && validateEconomicSplit(10000, defaultSplitBp, memberEmails)) {
      return defaultSplitBp;
    }
    var fallback = {};
    memberEmails.forEach(function (email) { fallback[email] = 5000; });
    return fallback;
  }

  // Al editar un gasto, si cambia `amount` y el gasto ya tenía economicSplit,
  // hay que recalcularlo para que siga sumando el nuevo total exacto --
  // dejarlo tal cual dejaría de sumar el importe correcto (rompe la garantía
  // de la Fase 3).
  //
  // CORREGIDO (tras revisión): la versión anterior reconstruía el
  // porcentaje histórico a partir de los céntimos de `economicSplit`
  // (vía una función `bpFromCents` ya retirada). Eso es matemáticamente
  // incorrecto para importes pequeños: 0,01€ repartido 50/50 se materializa
  // como {pagador:1, otro:0} -- indistinguible de un reparto 100/0. Los
  // céntimos de `economicSplit` son el COSTE MATERIALIZADO, no la
  // INTENCIÓN porcentual; no contienen suficiente información para
  // reconstruirla en general.
  //
  // Por eso esta función ya NO mira `economicSplit` en absoluto. Recibe
  // `splitBp` -- los puntos base ya guardados en el propio gasto en el
  // momento de crearlo o de la última vez que se recalculó por un cambio
  // de importe (ver PHASE5_INTEGRATION.md, "splitBp") -- y los aplica
  // directamente al nuevo importe, sin ningún paso de reconstrucción.
  //
  // CORREGIDO (política final aprobada -- ya NO hay fallback 50/50 aquí):
  //   A) sin economicSplit -- ni se llama a esta función (legacy, amount
  //      editable, se resuelve solo con la fórmula agregada de siempre).
  //   B) economicSplit + splitBp válido -- se recalcula desde splitBp.
  //   C) economicSplit + splitBp ausente/inválido -- se devuelve `null`.
  //      NO se infiere, NO se rellena con 50/50: es responsabilidad del
  //      caller (app.js) bloquear el cambio de importe en ese caso y
  //      dejar editables el resto de campos. Un fallback silencioso aquí
  //      sustituiría una intención desconocida por una inventada -- eso es
  //      exactamente la heurística que finge certeza que se quiere evitar.
  function recomputeSplitOnAmountChange(splitBp, memberEmails, newAmountEuros, payerEmail) {
    if (!splitBp || !validateEconomicSplit(10000, splitBp, memberEmails)) return null;
    var otherEmail = memberEmails.filter(function (e) { return e !== payerEmail; })[0];
    var newTotalCents = toCents(newAmountEuros);
    var economicSplit = buildSplitFromPercent(newTotalCents, [
      { email: payerEmail, bp: splitBp[payerEmail] },
      { email: otherEmail, bp: splitBp[otherEmail] }
    ], payerEmail);
    return { economicSplit: economicSplit, splitBp: splitBp };
  }

  // Decide en solitario (sin DOM ni Firestore) si el caso C debe bloquear el
  // guardado de un gasto editado: SOLO cuando cambia `amount` -- editar
  // categoría/nota/lugar/payerEmail sin tocar amount nunca bloquea, aunque
  // el gasto esté en el caso C (economicSplit sin splitBp fiable). Esto es
  // lo que hace testeable de verdad la regla, en vez de fiarse solo del
  // `payload.amount !== originalExpense.amount` inline de app.js.
  function amountEditBlockedByMissingSplitBp(originalExpense, newAmount, memberEmails) {
    if (!originalExpense || !originalExpense.economicSplit) return false;
    if (newAmount === originalExpense.amount) return false;
    var splitBp = originalExpense.splitBp;
    return !(splitBp && validateEconomicSplit(10000, splitBp, memberEmails));
  }

  // type es inmutable al editar un gasto existente -- se fuerza aquí al
  // valor original explícitamente, en vez de depender solo de que la UI
  // oculte/bloquee el selector (#type-field). Si originalExpense es null
  // (alta de un gasto nuevo), no hace nada: ahí type sigue siendo libre.
  function enforceImmutableFieldsOnEdit(payload, originalExpense) {
    if (!originalExpense) return payload;
    var result = {};
    for (var k in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) result[k] = payload[k];
    }
    result.type = originalExpense.type;
    return result;
  }

  return {
    isDebtExpense: isDebtExpense,
    debtExpenses: debtExpenses,
    computeDebtHalf: computeDebtHalf,
    round2: round2,

    toCents: toCents,
    fromCents: fromCents,
    buildSplitFromPercent: buildSplitFromPercent,
    buildSplitFromAmounts: buildSplitFromAmounts,
    defaultSplitCents: defaultSplitCents,
    resolveDefaultSplitBp: resolveDefaultSplitBp,
    recomputeSplitOnAmountChange: recomputeSplitOnAmountChange,
    amountEditBlockedByMissingSplitBp: amountEditBlockedByMissingSplitBp,
    enforceImmutableFieldsOnEdit: enforceImmutableFieldsOnEdit,
    validateEconomicSplit: validateEconomicSplit,
    validatePayerEmail: validatePayerEmail,
    computeBalanceCents: computeBalanceCents
  };
});
