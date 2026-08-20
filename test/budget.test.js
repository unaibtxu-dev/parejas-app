// Tests de las funciones puras de presupuesto añadidas a debt-calc.js tras
// feedback real de beta: gasto fijo = previsión (no se cuenta dos veces si
// hay un gasto real vinculado), proyección de fin de mes correcta, y
// "Otros" nunca sale como recomendación de recorte. node:test.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sumFixedExpenses,
  projectEndOfMonth,
  otrosIsBiggestCategory,
  payrollRemaining,
} = require("../debt-calc.js");

// ---- sumFixedExpenses: gasto fijo = previsión, no se cuenta dos veces ----

test("sumFixedExpenses suma por categoría, sin excludeIds", () => {
  const fixed = [
    { id: "a", category: "gasto", amount: 12 },
    { id: "b", category: "gasto", amount: 8 },
    { id: "c", category: "ahorro", amount: 100 },
  ];
  assert.equal(sumFixedExpenses(fixed, "gasto"), 20);
  assert.equal(sumFixedExpenses(fixed, "ahorro"), 100);
  assert.equal(sumFixedExpenses(fixed, null), 120);
});

test("sumFixedExpenses excluye los fijos con un gasto real ya vinculado este mes", () => {
  const fixed = [
    { id: "netflix", category: "gasto", amount: 12.99 },
    { id: "gimnasio", category: "gasto", amount: 30 },
  ];
  // "netflix" ya se ha pagado y vinculado a un gasto real este mes -- no se
  // vuelve a sumar aquí, o el presupuesto lo contaría dos veces.
  assert.equal(sumFixedExpenses(fixed, "gasto", ["netflix"]), 30);
  assert.equal(sumFixedExpenses(fixed, "gasto", []), 42.99);
  assert.equal(sumFixedExpenses(fixed, "gasto"), 42.99);
});

// ---- projectEndOfMonth: gastado + variable proyectado (resto de días) + fijos pendientes ----

test("projectEndOfMonth no cuenta dos veces los días ya vividos (a diferencia de total/día × días del mes)", () => {
  // 100€ en 10 días de un mes de 30 -- tasa diaria 10€/día.
  // Fórmula vieja (total/día × días del mes) habría dado 300€.
  // Nueva: 100 (ya gastado) + 10€/día × 20 días restantes = 300... en este
  // caso concreto coincide con la vieja porque no hay fijos pendientes; la
  // diferencia real se ve al añadir fijos pendientes (siguiente test).
  const r = projectEndOfMonth(100, 10, 30, 0);
  assert.equal(r, 300);
});

test("projectEndOfMonth suma los fijos pendientes, que la fórmula vieja ignoraba por completo", () => {
  const r = projectEndOfMonth(100, 10, 30, 50);
  // 100 + (100/10)*20 + 50 = 100 + 200 + 50 = 350
  assert.equal(r, 350);
});

test("projectEndOfMonth con dayOfMonth 0 o inválido no divide por cero", () => {
  assert.equal(projectEndOfMonth(100, 0, 30, 50), 150);
});

// ---- otrosIsBiggestCategory: para no recomendar recortar "Otros" y avisar cuando domina ----

test("otrosIsBiggestCategory: true cuando Otros es la categoría con más gasto", () => {
  assert.equal(otrosIsBiggestCategory({ otros: 200, ocio: 50, casa: 30 }), true);
});

test("otrosIsBiggestCategory: false cuando otra categoría pesa más que Otros", () => {
  assert.equal(otrosIsBiggestCategory({ otros: 20, ocio: 150, casa: 30 }), false);
});

test("otrosIsBiggestCategory: false si no hay gasto en Otros este periodo", () => {
  assert.equal(otrosIsBiggestCategory({ ocio: 50, casa: 30 }), false);
});

// ---- payrollRemaining: nómina MVP informativo ----

test("payrollRemaining: nómina menos gastado desde entonces", () => {
  assert.equal(payrollRemaining(1500, 400), 1100);
});

test("payrollRemaining: puede salir negativo (te has pasado)", () => {
  assert.equal(payrollRemaining(1500, 1800), -300);
});
