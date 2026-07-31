# Pruebas automatizadas — Musical Fever

## Cómo correrlas

```bash
npm install     # solo la primera vez (instala jsdom)
npm test
```

Corre en unos segundos, sin necesitar internet ni un proyecto de
Firebase real — usa una base de datos en memoria que imita el
subconjunto real de Firebase que usa la app (ver
`tests/helpers/fake-firebase.js`).

## Qué cubre cada archivo

- **tests/critical-regressions.test.js** — Los dos bugs graves que
  ya se encontraron y corrigieron una vez (retención de historial en
  "modo prueba" de 3 minutos, y XSS por nombres sin escapar). Si
  alguien sin querer los reintroduce, estas pruebas fallan de
  inmediato.

- **tests/business-logic.test.js** — Ejercita las funciones REALES
  de `firebase.js` (no reescrituras): que el stock nunca quede
  negativo, que una venta con varios productos no descuente stock
  "fantasma" si uno de ellos falla, que dos ventas simultáneas por
  la última unidad no vendan las dos, que dos productos creados con
  el mismo código al mismo tiempo no se pisen entre sí, y que la
  numeración de notas sea correlativa.

- **tests/views-sync.test.js** — Corre `scripts/check-views-sync.js`
  y falla si `views/*.html` quedó desactualizado respecto a lo que
  `router.js` realmente usa.

- **tests/syntax.test.js** — Verifica que todos los `.js` del
  proyecto sean sintácticamente válidos (`node --check`). Atrapa
  errores de tipeo antes de subir a producción.

## Antes de cada presentación o despliegue

```bash
npm test
```

Si todo pasa en verde, es seguro subir. Si algo falla, el mensaje de
la prueba dice exactamente qué se rompió y por qué importa — léelo,
no lo ignores ni lo comentes para que "pase".

## Limitación honesta

Esto NO reemplaza probar la app de verdad en un navegador ni en el
celular. Cubre la lógica de negocio y los bugs ya conocidos; no
prueba CSS visual, gestos táctiles, ni el comportamiento real de
Firebase con la base de datos de producción.
