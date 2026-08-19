# Fase 2 — Infraestructura mínima de tests

El cálculo económico 50/50 **no se ha modificado** — solo se ha extraído a un archivo aparte para poder testearlo, tal como pediste.

## Qué se ha hecho

- **[debt-calc.js](parejas-app/debt-calc.js)**: `debtExpenses()`/`computeDebtHalf()` movidas aquí como funciones puras (reciben `expenses`/`settlements`/`partners` en vez de leer `state`/Firestore). Es una copia exacta de la lógica que ya había en `app.js:1467-1484` — mismo orden de operaciones, mismo redondeo, sin ningún cambio de comportamiento.
- **[app.js](parejas-app/app.js:1467)**: las dos funciones ahora son wrappers de una línea que llaman a `DebtCalc.debtExpenses(...)`/`DebtCalc.computeDebtHalf(...)` con los datos reales de la app (`visibleExpenses()`, `state.settlements`, `PARTNERS`). Nada más en `app.js` cambia.
- **[index.html](parejas-app/index.html:802)**: añadido `<script defer src="debt-calc.js?...">` justo antes de `app.js`.
- **[test/debt-calc.test.js](parejas-app/test/debt-calc.test.js)**: tests con `node:test` (built-in de Node, sin dependencias nuevas).
- **[package.json](parejas-app/package.json)**: añadido `"scripts": { "test": "node --test" }`.

No se ha tocado ningún otro fichero. No se ha hecho commit ni push — sigue todo en tu copia local sin subir.

## Casos cubiertos (verificados contra el modelo actual, 50/50)

| Caso (decisión 6) | Resultado esperado | Estado |
|---|---|---|
| A) 100€ Dani, 50/50 | Laura debe 50 | ✅ escrito y verificado a mano |
| C) Dani paga 100, Laura paga 60 | Laura debe 20 | ✅ |
| D) caso C + settlement 20 | balance 0 | ✅ |
| E) gasto individual mezclado | no afecta al balance compartido | ✅ |
| F) `affectsDebt: false` | cuenta como gasto, no afecta a la deuda | ✅ |
| — (añadido, no pedido explícitamente) | un settlement mayor que la deuda puede dejar balance negativo (Dani debe a Laura) | ✅, para comprobar que el signo también funciona al revés |
| — (añadido) | redondeo de céntimos impares no pierde/gana más de 1 céntimo | ✅, con tolerancia — ver nota abajo |

**B, G y H se quedan como especificación escrita dentro del propio archivo de test (comentario al final), no como tests activos**: los tres dependen del reparto configurable (`economicSplit`) que todavía no existe — `computeDebtHalf()` de hoy no tiene ningún parámetro de porcentaje, así que no hay nada real que testear todavía para esos tres casos. Cuando lleguemos a la Fase 3/4, esos comentarios ya tienen los números exactos listos para convertirse en tests de verdad.

## Aviso importante: no he podido ejecutar `node --test` en este entorno

Node.js no está instalado/en el PATH de esta sandbox (ni en Bash ni en PowerShell, y tampoco encontré un `node.exe` en las rutas habituales de instalación). No he podido correr los tests aquí mismo.

Lo que sí he hecho para compensar:
- **Verificado a mano, operación por operación, la aritmética de cada test** (todos usan importes enteros excepto el de redondeo, así que no hay ambigüedad de coma flotante que pueda hacerme equivocar).
- **Verificado en vivo en el navegador** (servidor de preview local en `localhost:3002`) que `debt-calc.js` carga correctamente, que `DebtCalc` queda expuesto como global, y que `DebtCalc.computeDebtHalf(...)` con el caso A da exactamente `50` — la misma prueba que hace el test, pero ejecutada de verdad en el runtime real de la app, no solo sobre el papel. Sin errores nuevos en consola tras el cambio.

Para que tú lo confirmes con Node de verdad:

```bash
npm test
```

Si algo no coincide con lo que digo arriba, es una señal real de que me he equivocado en algún paso de la extracción — dímelo y lo reviso.

## Siguiente paso

Con esto listo, la Fase 3 (añadir `paidBy`/`economicSplit` de forma aditiva, sin tocar el 50/50 existente) ya tiene una red de seguridad real: cualquier cambio en `debt-calc.js` que rompa el comportamiento actual haría fallar alguno de estos tests antes de llegar a producción.
