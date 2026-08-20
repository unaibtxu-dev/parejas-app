// Tests de las funciones puras nuevas de Fase 4/5: resolveDefaultSplitBp
// (reparto habitual efectivo) y recomputeSplitOnAmountChange (edición de
// importe usando splitBp, la intención porcentual guardada en el propio
// gasto -- NUNCA reconstruida desde los céntimos de economicSplit).
//
// Corrección tras revisión (ver PHASE5_INTEGRATION.md): la versión anterior
// de este archivo tenía un test ("I bis") que daba por buena una
// reconstrucción de porcentaje a partir de economicSplit que es
// matemáticamente incorrecta para importes pequeños (0,01€ 50/50 se
// materializa igual que 0,01€ 100/0 -- 1 céntimo entero, 0 el otro). Ese
// test queda eliminado; economicSplit es SOLO coste materializado, no
// contiene la intención porcentual original.
//
// Lo que NO se testea aquí porque no es pure-function (vive en app.js,
// necesita DOM/Firestore/state): materializeEconomicSplit(),
// expenseFields()/updateExpense() dejando economicSplit/splitBp intactos al
// editar campos cosméticos o payerEmail, updateSplitHint(), leaveSpace()
// borrando defaultSplitBp, y que quick-add/CSV usan el mismo default que el
// formulario manual (verificado por lectura de código, ver
// PHASE5_INTEGRATION.md).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveDefaultSplitBp,
  recomputeSplitOnAmountChange,
  amountEditBlockedByMissingSplitBp,
  enforceImmutableFieldsOnEdit,
  computeBalanceCents,
  toCents,
} = require("../debt-calc.js");

const DANI = "dani@example.com";
const LAURA = "laura@example.com";
const PARTNERS = [{ email: DANI }, { email: LAURA }];
const MEMBER_EMAILS = [DANI, LAURA];

function expense(overrides) {
  return Object.assign(
    { amount: 0, type: "conjunto", affectsDebt: true, payerEmail: DANI },
    overrides
  );
}

// ---- A/B/C/D/E: resolveDefaultSplitBp (sin cambios respecto a la ronda anterior) ----

test("A) espacio pareja con 2 miembros sin default -> 50/50", () => {
  assert.deepEqual(
    resolveDefaultSplitBp("pareja", [DANI, LAURA], null),
    { [DANI]: 5000, [LAURA]: 5000 }
  );
});

test("B) espacio pareja con default 60/40 -> se usa tal cual", () => {
  assert.deepEqual(
    resolveDefaultSplitBp("pareja", [DANI, LAURA], { [DANI]: 6000, [LAURA]: 4000 }),
    { [DANI]: 6000, [LAURA]: 4000 }
  );
});

test("C) espacio pareja con un solo miembro -> null (no se puede materializar)", () => {
  assert.equal(resolveDefaultSplitBp("pareja", [DANI], { [DANI]: 6000 }), null);
  assert.equal(resolveDefaultSplitBp("pareja", [DANI], null), null);
});

test("D) espacio personal -> null (no aplica), aunque tuviera 2 emails por error", () => {
  assert.equal(resolveDefaultSplitBp("personal", [DANI], null), null);
  assert.equal(resolveDefaultSplitBp("personal", [DANI, LAURA], { [DANI]: 6000, [LAURA]: 4000 }), null);
});

test("E) default presente pero inválido -> fallback defensivo 50/50", () => {
  assert.deepEqual(
    resolveDefaultSplitBp("pareja", [DANI, LAURA], { [DANI]: 6000, "intruso@example.com": 4000 }),
    { [DANI]: 5000, [LAURA]: 5000 }
  );
  assert.deepEqual(
    resolveDefaultSplitBp("pareja", [DANI, LAURA], { [DANI]: 7000, [LAURA]: 4000 }),
    { [DANI]: 5000, [LAURA]: 5000 }
  );
});

// ---- F: el default no afecta retroactivamente ----

test("F) un gasto ya creado con economicSplit no cambia aunque el default del espacio cambie después", () => {
  const historic = expense({ amount: 100, payerEmail: DANI, economicSplit: { [DANI]: 6000, [LAURA]: 4000 } });
  const before = computeBalanceCents([historic], [], PARTNERS);
  const newDefault = resolveDefaultSplitBp("pareja", [DANI, LAURA], { [DANI]: 5000, [LAURA]: 5000 });
  const after = computeBalanceCents([historic], [], PARTNERS);
  assert.equal(before, after);
  assert.deepEqual(newDefault, { [DANI]: 5000, [LAURA]: 5000 });
});

// ---- H: cambiar payerEmail no debe cambiar el coste, solo quién pagó ----

test("H) cambiar solo payerEmail (economicSplit igual) cambia el balance según quién pagó, no el reparto de coste", () => {
  const splitFixed = { [DANI]: 6000, [LAURA]: 4000 };
  const paidByDani = computeBalanceCents([expense({ amount: 100, payerEmail: DANI, economicSplit: splitFixed })], [], PARTNERS);
  const paidByLaura = computeBalanceCents([expense({ amount: 100, payerEmail: LAURA, economicSplit: splitFixed })], [], PARTNERS);
  assert.equal(paidByDani, 4000);
  assert.equal(paidByLaura, -6000);
});

// ---- I1-I6: editar amount usando SIEMPRE splitBp, nunca economicSplit ----

test("I1) 100€ 60/40 (splitBp 6000/4000) -> editar a 150€ -> economicSplit 9000/6000", () => {
  const r = recomputeSplitOnAmountChange({ [DANI]: 6000, [LAURA]: 4000 }, MEMBER_EMAILS, 150, DANI);
  assert.deepEqual(r.economicSplit, { [DANI]: 9000, [LAURA]: 6000 });
  assert.deepEqual(r.splitBp, { [DANI]: 6000, [LAURA]: 4000 });
  assert.equal(r.economicSplit[DANI] + r.economicSplit[LAURA], toCents(150));
});

test("I2) 0,01€ 50/50 (splitBp 5000/5000, economicSplit materializado 1/0) -> editar a 100€ -> 5000/5000 exacto", () => {
  // La clave del caso: economicSplit={Dani:1,Laura:0} por sí solo sería
  // indistinguible de un 100/0 -- pero splitBp dice la verdad, y es lo
  // único que se usa.
  const r = recomputeSplitOnAmountChange({ [DANI]: 5000, [LAURA]: 5000 }, MEMBER_EMAILS, 100, DANI);
  assert.deepEqual(r.economicSplit, { [DANI]: 5000, [LAURA]: 5000 });
});

test("I3) 0,03€ 50/50 (splitBp 5000/5000, economicSplit con residuo 2/1) -> editar a 100€ -> 5000/5000 exacto", () => {
  const r = recomputeSplitOnAmountChange({ [DANI]: 5000, [LAURA]: 5000 }, MEMBER_EMAILS, 100, DANI);
  assert.deepEqual(r.economicSplit, { [DANI]: 5000, [LAURA]: 5000 });
});

test("I4) 0,01€ 60/40 (splitBp 6000/4000) -> editar a 100€ -> 6000/4000 exacto", () => {
  const r = recomputeSplitOnAmountChange({ [DANI]: 6000, [LAURA]: 4000 }, MEMBER_EMAILS, 100, DANI);
  assert.deepEqual(r.economicSplit, { [DANI]: 6000, [LAURA]: 4000 });
});

test("I5) gasto legacy sin economicSplit -> editar amount -> conserva semántica 50/50 (sin llamar a recomputeSplitOnAmountChange)", () => {
  // Un gasto legacy nunca entra en el bloque de recálculo de app.js (esa
  // rama exige que `originalExpense.economicSplit` ya exista) -- se deja
  // sin economicSplit, y computeBalanceCents lo sigue tratando como 50/50
  // agregado sobre el importe que sea en cada momento, incluido el nuevo.
  const editedLegacy = expense({ amount: 150 }); // amount ya "editado", sigue sin economicSplit
  assert.equal(computeBalanceCents([editedLegacy], [], PARTNERS), 7500); // 50/50 de 150€ = 7500 céntimos
});

test("I6) economicSplit presente pero splitBp ausente -> BLOQUEADO (null), sin inferir y SIN fallback 50/50", () => {
  // Corregido: la política final aprobada NO es un fallback 50/50. El
  // gasto original era, aparentemente, 60/40 (por su economicSplit), pero
  // no tiene splitBp -- una versión intermedia sin esa información. NO se
  // infiere el 60/40 desde los céntimos, y tampoco se rellena con 50/50 --
  // se devuelve null para que el caller (app.js) BLOQUEE el cambio de
  // importe. Ver PHASE5_INTEGRATION.md, caso C.
  const r = recomputeSplitOnAmountChange(null, MEMBER_EMAILS, 200, DANI);
  assert.equal(r, null);
});

test("I6 bis) splitBp presente pero inválido (no suma 10000) -> también BLOQUEADO (null)", () => {
  const r = recomputeSplitOnAmountChange({ [DANI]: 7000, [LAURA]: 4000 }, MEMBER_EMAILS, 200, DANI);
  assert.equal(r, null);
});

test("I ter) si amount Y payerEmail cambian a la vez, el coste sigue las personas, no las etiquetas", () => {
  const r = recomputeSplitOnAmountChange({ [DANI]: 6000, [LAURA]: 4000 }, MEMBER_EMAILS, 200, LAURA);
  assert.equal(r.economicSplit[DANI], 12000); // 60% de 200€, conservado aunque Dani ya no es quien paga
  assert.equal(r.economicSplit[LAURA], 8000);
  assert.equal(r.economicSplit[DANI] + r.economicSplit[LAURA], toCents(200));
});

// ---- amountEditBlockedByMissingSplitBp: el bloqueo del caso C es SOLO
// sobre cambios de amount, nunca sobre otros campos (categoría, nota,
// lugar, payerEmail) ----

test("J1) caso C, amount SIN cambiar -> nunca bloquea (categoría/nota/lugar/pagador editables)", () => {
  const original = expense({ amount: 100, economicSplit: { [DANI]: 6000, [LAURA]: 4000 } }); // sin splitBp: caso C
  assert.equal(amountEditBlockedByMissingSplitBp(original, 100, MEMBER_EMAILS), false);
});

test("J2) caso C, amount SÍ cambia -> bloquea", () => {
  const original = expense({ amount: 100, economicSplit: { [DANI]: 6000, [LAURA]: 4000 } }); // sin splitBp
  assert.equal(amountEditBlockedByMissingSplitBp(original, 150, MEMBER_EMAILS), true);
});

test("J3) caso C con splitBp inválido (no suma 10000) + amount cambia -> también bloquea", () => {
  const original = expense({
    amount: 100,
    economicSplit: { [DANI]: 6000, [LAURA]: 4000 },
    splitBp: { [DANI]: 7000, [LAURA]: 4000 },
  });
  assert.equal(amountEditBlockedByMissingSplitBp(original, 150, MEMBER_EMAILS), true);
});

test("J4) caso B (splitBp válido) + amount cambia -> NO bloquea", () => {
  const original = expense({
    amount: 100,
    economicSplit: { [DANI]: 6000, [LAURA]: 4000 },
    splitBp: { [DANI]: 6000, [LAURA]: 4000 },
  });
  assert.equal(amountEditBlockedByMissingSplitBp(original, 150, MEMBER_EMAILS), false);
});

test("J5) caso A (legacy, sin economicSplit) + amount cambia -> NO bloquea", () => {
  const original = expense({ amount: 100 }); // legacy, sin economicSplit
  assert.equal(amountEditBlockedByMissingSplitBp(original, 150, MEMBER_EMAILS), false);
});

test("J6) sin originalExpense (alta de gasto nuevo) -> nunca bloquea", () => {
  assert.equal(amountEditBlockedByMissingSplitBp(null, 150, MEMBER_EMAILS), false);
});

// ---- enforceImmutableFieldsOnEdit: type no puede cambiar al editar, a
// nivel de datos, no solo de UI ----

test("K1) editar gasto existente -> type se fuerza al original aunque el payload traiga otro", () => {
  const original = expense({ amount: 100, type: "conjunto" });
  const payload = { amount: 100, type: "personal", note: "cambiado" };
  const result = enforceImmutableFieldsOnEdit(payload, original);
  assert.equal(result.type, "conjunto");
  assert.equal(result.note, "cambiado"); // el resto de campos no se toca
});

test("K2) alta de gasto nuevo (originalExpense null) -> payload no se modifica", () => {
  const payload = { amount: 100, type: "personal" };
  const result = enforceImmutableFieldsOnEdit(payload, null);
  assert.equal(result, payload);
  assert.equal(result.type, "personal");
});

// ---- Punto 7: computeBalanceCents nunca debe depender de splitBp ----

test("computeBalanceCents ignora splitBp por completo, incluso si está corrupto", () => {
  const withCorruptSplitBp = expense({
    amount: 100,
    payerEmail: DANI,
    economicSplit: { [DANI]: 6000, [LAURA]: 4000 },
    splitBp: { [DANI]: 99999, [LAURA]: -50000 }, // deliberadamente inválido
  });
  // El balance debe salir exactamente igual que sin splitBp -- computeBalanceCents
  // no lo lee en ningún punto de su implementación.
  assert.equal(computeBalanceCents([withCorruptSplitBp], [], PARTNERS), 4000);
});
