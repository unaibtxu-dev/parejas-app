// Tests de Fase 3 (economicSplit) — DISEÑO, todavía no implementado.
//
// Estos tests llaman a funciones que aún no existen en debt-calc.js
// (buildSplitFromPercent, buildSplitFromAmounts, computeBalanceCents,
// validateEconomicSplit, validatePayerEmail, toCents). Es intencionado: son
// la especificación ejecutable del diseño descrito en
// PHASE3_ECONOMIC_SPLIT_DESIGN.md, escritos ANTES de implementar.
//
// Hasta que se implemente, `npm test` debe mostrar este archivo en rojo
// (fallos "is not a function") y test/debt-calc.test.js en verde. Si algo
// de debt-calc.test.js empieza a fallar también, algo se ha roto sin querer.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSplitFromPercent,
  buildSplitFromAmounts,
  computeBalanceCents,
  validateEconomicSplit,
  validatePayerEmail,
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

test("B) 100€ pagados por Dani, economicSplit 60/40 (Dani 60%) -> Laura debe 40", () => {
  const expenses = [
    expense({
      amount: 100,
      payerEmail: DANI,
      economicSplit: { [DANI]: 6000, [LAURA]: 4000 },
    }),
  ];
  assert.equal(computeBalanceCents(expenses, [], PARTNERS), 4000);
});

test("G) repartos por porcentaje: las partes siempre suman exactamente el importe original", () => {
  const cases = [
    { totalCents: 1000, payer: DANI, payerBp: 6000 }, // 10,00€ 60/40, paga Dani
    { totalCents: 999, payer: LAURA, payerBp: 5000 }, // 9,99€ 50/50 impar, paga Laura
    { totalCents: 1, payer: DANI, payerBp: 5000 }, // 0,01€, el mínimo posible
    { totalCents: 333333, payer: DANI, payerBp: 3333 }, // un tercio exacto es imposible en céntimos
    { totalCents: 700, payer: LAURA, payerBp: 3333 },
    { totalCents: 12345, payer: DANI, payerBp: 9990 }, // casi todo para el pagador
  ];
  cases.forEach(({ totalCents, payer, payerBp }) => {
    const other = payer === DANI ? LAURA : DANI;
    const split = buildSplitFromPercent(
      totalCents,
      [
        { email: payer, bp: payerBp },
        { email: other, bp: 10000 - payerBp },
      ],
      payer
    );
    assert.equal(
      split[DANI] + split[LAURA],
      totalCents,
      `caso ${JSON.stringify({ totalCents, payer, payerBp })} -> ${JSON.stringify(split)}`
    );
  });
});

test("H) coexisten un histórico 50/50 y un gasto nuevo 60/40 sin que uno afecte al otro", () => {
  const historic5050 = expense({
    amount: 100,
    payerEmail: DANI,
    economicSplit: { [DANI]: 5000, [LAURA]: 5000 },
  });
  const nuevo6040 = expense({
    amount: 100,
    payerEmail: DANI,
    economicSplit: { [DANI]: 6000, [LAURA]: 4000 },
  });

  // Cada documento por separado conserva su propio reparto...
  assert.equal(computeBalanceCents([historic5050], [], PARTNERS), 5000);
  assert.equal(computeBalanceCents([nuevo6040], [], PARTNERS), 4000);

  // ...y juntos se suman sin que el reparto de uno contamine al otro. Que la
  // pareja "cambie su reparto habitual" nunca es un input de
  // computeBalanceCents -- por eso el histórico sigue aportando 5000 exactos
  // aunque el segundo documento use un reparto distinto.
  assert.equal(computeBalanceCents([historic5050, nuevo6040], [], PARTNERS), 9000);
});

test("I) economicSplit cuya suma no coincide con amount debe rechazarse", () => {
  const ok = validateEconomicSplit(toCents(100), { [DANI]: 6000, [LAURA]: 5000 }, MEMBER_EMAILS);
  assert.equal(ok, false);
});

test("J) economicSplit con una persona ajena al espacio debe rechazarse", () => {
  const ok = validateEconomicSplit(
    toCents(100),
    { [DANI]: 6000, "intruso@example.com": 4000 },
    MEMBER_EMAILS
  );
  assert.equal(ok, false);
});

test("J bis) economicSplit válido con exactamente los miembros del espacio se acepta", () => {
  const ok = validateEconomicSplit(toCents(100), { [DANI]: 6000, [LAURA]: 4000 }, MEMBER_EMAILS);
  assert.equal(ok, true);
});

test("K) settlement con economicSplit sigue compensando correctamente", () => {
  const expenses = [
    expense({ amount: 100, payerEmail: DANI, economicSplit: { [DANI]: 6000, [LAURA]: 4000 } }),
  ];
  // Laura debe 40€ (caso B). Si paga 40€ de saldado, el balance queda a 0.
  const settlements = [{ payerEmail: LAURA, amount: 40 }];
  assert.equal(computeBalanceCents(expenses, settlements, PARTNERS), 0);
});

test("L) affectsDebt=false con economicSplit no modifica el balance", () => {
  const expenses = [
    expense({
      amount: 100,
      payerEmail: DANI,
      affectsDebt: false,
      economicSplit: { [DANI]: 6000, [LAURA]: 4000 },
    }),
  ];
  assert.equal(computeBalanceCents(expenses, [], PARTNERS), 0);
});

test("M1) 0,01€ paga Dani, 50/50 -> el céntimo impar es de Dani (el pagador), balance 0", () => {
  const split = buildSplitFromPercent(1, [{ email: DANI, bp: 5000 }, { email: LAURA, bp: 5000 }], DANI);
  assert.deepEqual(split, { [DANI]: 1, [LAURA]: 0 });

  const expenses = [expense({ amount: 0.01, payerEmail: DANI, economicSplit: split })];
  assert.equal(computeBalanceCents(expenses, [], PARTNERS), 0);
});

test("M2) 0,01€ paga Laura, 50/50 -> el céntimo impar es de Laura (el pagador), balance 0", () => {
  const split = buildSplitFromPercent(1, [{ email: DANI, bp: 5000 }, { email: LAURA, bp: 5000 }], LAURA);
  assert.deepEqual(split, { [DANI]: 0, [LAURA]: 1 });

  const expenses = [expense({ amount: 0.01, payerEmail: LAURA, economicSplit: split })];
  assert.equal(computeBalanceCents(expenses, [], PARTNERS), 0);
});

test("N) payerEmail ajeno al espacio debe rechazarse", () => {
  assert.equal(validatePayerEmail("intruso@example.com", MEMBER_EMAILS), false);
});

test("N bis) payerEmail que sí pertenece al espacio se acepta", () => {
  assert.equal(validatePayerEmail(DANI, MEMBER_EMAILS), true);
});

test("O) economicSplit con un valor negativo debe rechazarse", () => {
  // Suma exacta (10000) a propósito, para que el único motivo de rechazo
  // sea el valor negativo, no un desajuste de suma.
  const ok = validateEconomicSplit(toCents(100), { [DANI]: -100, [LAURA]: 10100 }, MEMBER_EMAILS);
  assert.equal(ok, false);
});

test("P) economicSplit con un valor decimal (no céntimos enteros) debe rechazarse", () => {
  // Suma exacta (10000) a propósito, para que el único motivo de rechazo
  // sea el decimal, no un desajuste de suma.
  const ok = validateEconomicSplit(toCents(100), { [DANI]: 6000.5, [LAURA]: 3999.5 }, MEMBER_EMAILS);
  assert.equal(ok, false);
});

// ---- Ejemplos literales del punto 2 de la revisión, sin letra asignada ----

test("buildSplitFromAmounts rechaza importes que no suman el total (100€ != 70€+40€)", () => {
  const split = buildSplitFromAmounts(toCents(100), [
    { email: DANI, cents: toCents(70) },
    { email: LAURA, cents: toCents(40) },
  ]);
  assert.equal(split, null); // NUNCA se convierte en 70/30 silenciosamente
});

test("buildSplitFromAmounts acepta importes que sí suman el total exacto (70€+30€)", () => {
  const split = buildSplitFromAmounts(toCents(100), [
    { email: DANI, cents: toCents(70) },
    { email: LAURA, cents: toCents(30) },
  ]);
  assert.deepEqual(split, { [DANI]: 7000, [LAURA]: 3000 });
});

test("buildSplitFromPercent rechaza porcentajes que no suman 100% (55%+44%)", () => {
  const split = buildSplitFromPercent(
    toCents(100),
    [{ email: DANI, bp: 5500 }, { email: LAURA, bp: 4400 }],
    DANI
  );
  assert.equal(split, null);
});

test("buildSplitFromPercent con 55%/45% válidos: el resto solo resuelve el redondeo, no un error de entrada", () => {
  // 1,01€ no se divide exacto en 55/45 -> el resto que recibe el pagador es
  // puramente el residuo de redondear un porcentaje ya válido, no una
  // corrección de una entrada que no cuadraba (eso ya se rechazó arriba).
  const split = buildSplitFromPercent(
    101,
    [{ email: DANI, bp: 5500 }, { email: LAURA, bp: 4500 }],
    DANI
  );
  assert.equal(split[DANI] + split[LAURA], 101);
});

// ---- Regresión: "legacy 50/50 must preserve aggregate rounding semantics" ----
//
// Contraejemplo encontrado durante la implementación (ver
// PHASE3_IMPLEMENTATION.md): repartir céntimo a céntimo CADA gasto legacy
// por separado (floor + resto al pagador) NO da el mismo resultado que
// computeDebtHalf() cuando el mismo pagador tiene varios gastos de céntimo
// impar, porque computeDebtHalf() suma todo primero y redondea una sola vez
// al final. computeBalanceCents() debe reproducir exactamente esa semántica
// agregada para los gastos sin economicSplit, sin excepción.

test('legacy 50/50 must preserve aggregate rounding semantics (Dani paga 0,01€ + 0,03€)', () => {
  const expenses = [
    expense({ amount: 0.01, payerEmail: DANI }),
    expense({ amount: 0.03, payerEmail: DANI }),
  ];
  // Total pagado por Dani = 0,04€. 50/50 agregado -> Laura debe 0,02€ = 2 céntimos.
  // NO 1 céntimo (lo que daría repartir cada gasto por separado con floor+resto).
  assert.equal(computeBalanceCents(expenses, [], PARTNERS), 2);
});

test('legacy 50/50 must preserve aggregate rounding semantics (caso simétrico, paga Laura)', () => {
  const expenses = [
    expense({ amount: 0.01, payerEmail: LAURA }),
    expense({ amount: 0.03, payerEmail: LAURA }),
  ];
  // Mismo caso con los papeles cambiados: Dani debe 0,02€ a Laura -> signo negativo.
  assert.equal(computeBalanceCents(expenses, [], PARTNERS), -2);
});
