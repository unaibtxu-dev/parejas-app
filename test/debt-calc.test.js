// Tests del cálculo económico actual (reparto 50/50). Node built-in test
// runner, sin dependencias nuevas: `node --test` o `npm test`.
//
// Casos B, G y H de PHASE1/decisión 6 dependen del reparto configurable
// (paidBy != economicSplit, todavía no implementado — ver
// PHASE1_MIO_NUESTRO_Y_PRIVACIDAD.md). Se dejan como especificación lista
// para activarse en la Fase 3/4, no se simulan aquí con el modelo actual.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { debtExpenses, computeDebtHalf } = require("../debt-calc.js");

const DANI = "dani@example.com";
const LAURA = "laura@example.com";
const PARTNERS = [{ email: DANI }, { email: LAURA }];

function expense(overrides) {
  return Object.assign(
    { amount: 0, type: "conjunto", affectsDebt: true, payerEmail: DANI },
    overrides
  );
}

test("A) 100€ pagados por Dani, 50/50 -> Laura debe 50 a Dani", () => {
  const expenses = [expense({ amount: 100, payerEmail: DANI })];
  assert.equal(computeDebtHalf(expenses, [], PARTNERS), 50);
});

test("C) Dani paga 100, Laura paga 60 (ambos 50/50) -> Laura debe 20 a Dani", () => {
  const expenses = [
    expense({ amount: 100, payerEmail: DANI }),
    expense({ amount: 60, payerEmail: LAURA }),
  ];
  assert.equal(computeDebtHalf(expenses, [], PARTNERS), 20);
});

test("D) caso C + settlement de 20€ de Laura a Dani -> balance queda en 0", () => {
  const expenses = [
    expense({ amount: 100, payerEmail: DANI }),
    expense({ amount: 60, payerEmail: LAURA }),
  ];
  const settlements = [{ payerEmail: LAURA, amount: 20 }];
  assert.equal(computeDebtHalf(expenses, settlements, PARTNERS), 0);
});

test("E) un gasto individual no afecta al balance compartido", () => {
  const expenses = [
    expense({ amount: 100, payerEmail: DANI }),
    expense({ amount: 999, payerEmail: LAURA, type: "individual" }),
  ];
  assert.equal(computeDebtHalf(expenses, [], PARTNERS), 50);
  assert.equal(debtExpenses(expenses).length, 1);
});

test("F) affectsDebt=false queda excluido del cálculo de deuda", () => {
  // Esto solo comprueba la mitad de la afirmación original de la decisión 6
  // ("aparece en el total del mes, no afecta a la deuda"): que no afecta a
  // la deuda, que es lo único que vive dentro de debt-calc.js. Que además
  // siga contando en el total mensual depende de expensesOfMonth() en
  // app.js, fuera de este módulo — eso necesitaría un test de integración
  // aparte, todavía no escrito, y no bloquea la Fase 3 por él.
  const expenses = [expense({ amount: 100, payerEmail: DANI, affectsDebt: false })];
  assert.equal(computeDebtHalf(expenses, [], PARTNERS), 0);
  assert.equal(debtExpenses(expenses).length, 0);
});

test("saldar de más también puede dejar balance negativo (Dani debe a Laura)", () => {
  const expenses = [expense({ amount: 100, payerEmail: DANI })];
  const settlements = [{ payerEmail: LAURA, amount: 80 }];
  // Laura ya debía 50; paga 80 -> queda debiendo -30, es decir Dani le debe 30 a Laura.
  assert.equal(computeDebtHalf(expenses, settlements, PARTNERS), -30);
});

test("redondeo: el resultado nunca pierde ni gana más de 1 céntimo (tolerancia, no exacto)", () => {
  // No he podido ejecutar `node --test` en este entorno (Node no está en el
  // PATH de esta sandbox) para verificar el literal exacto que produce
  // Math.round() en un caso límite de céntimos — por eso esta comprobación
  // usa una tolerancia en vez de un valor exacto. El caso G real de la
  // decisión 6 (que un reparto en porcentaje sume exactamente el total) sí
  // necesita un valor exacto, pero requiere el modelo de reparto de la
  // Fase 3/4, que todavía no existe.
  const expenses = [expense({ amount: 33.33, payerEmail: DANI })];
  const half = computeDebtHalf(expenses, [], PARTNERS);
  assert.ok(Math.abs(half - 16.665) <= 0.01, "half=" + half);
});

// ---- Especificación para la Fase 3/4 (todavía no implementable) ----
//
// B) 100€ pagados por Dani, reparto 60/40 (Dani soporta el 60%)
//    -> coste Dani 60, coste Laura 40, Laura debe 40 a Dani.
//    Hoy computeDebtHalf() no admite reparto distinto de 50/50 — no hay
//    parámetro de split. Cuando exista economicSplit, este caso pasa a:
//      computeEconomicBalance(
//        [{ amount: 100, payerEmail: DANI, economicSplit: { [DANI]: 60, [LAURA]: 40 } }],
//        [], PARTNERS
//      ) -> { costs: { [DANI]: 60, [LAURA]: 40 }, balance: 40 }
//
// G) 10€ con un reparto en porcentaje que produce decimales
//    -> costes de las dos personas deben sumar exactamente 10€, sin perder
//    ni ganar céntimos por el redondeo de cada parte por separado.
//
// H) la pareja cambia su reparto habitual de 50/50 a 60/40 dentro de 6 meses
//    -> los gastos ya guardados con economicSplit explícito (o con el
//    fallback 50/50 aplicado en el momento de crearse) no deben recalcularse
//    con el nuevo reparto habitual. Requiere que economicSplit se guarde en
//    el propio documento, no se derive de una configuración global mutable.
