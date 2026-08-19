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

  return {
    isDebtExpense: isDebtExpense,
    debtExpenses: debtExpenses,
    computeDebtHalf: computeDebtHalf,
    round2: round2
  };
});
