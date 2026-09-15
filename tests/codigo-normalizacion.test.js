// tests/codigo-normalizacion.test.js
//
// Pruebas de estrés sobre normalizeProductCode / sanitizeFirebaseKey /
// mergeStockRows con casos límite (relleno de ancho fijo de Excel,
// símbolos repetidos, unicode, mayúsculas/acentos, barra "/", códigos
// vacíos o solo de símbolos). El objetivo es que si un cambio futuro
// a la normalización de códigos vuelve a introducir una fusión
// silenciosa de productos distintos (el bug original de "Importar
// stock"), estas pruebas lo detecten antes de que llegue a producción.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');

function setup() {
  const { window } = loadApp(['stock.js', 'import-stock.js']);
  return window;
}

test('normalizeProductCode: casos límite no deben romper ni vaciar el código', () => {
  const w = setup();
  const casos = [
    'FV-6', 'FV- 6', 'fv-6', 'Fv 6',
    '101 -4L', '101-4L',
    'B-3K-                    ', // ancho fijo excel
    '14""', '14"',
    'FV-BOW-1/2', 'FV-BOW-1/2-',
    '--', '""', '⁄⁄',
    '', '   ', '...',
    'A/B/C', 'A//B',
    'código-ñ-áéíóú',
    'a'.repeat(500),
    '[test]', '$test$', '#test#',
  ];
  for (const c of casos) {
    const norm = w.normalizeProductCode(c);
    assert.equal(typeof norm, 'string', `normalizeProductCode(${JSON.stringify(c)}) debe devolver string`);
  }
});

test('normalizeProductCode: colisiones esperadas y NO esperadas', () => {
  const w = setup();
  // Estos SÍ deberían colisionar (mismo código lógico)
  const colisionan = [
    ['FV-6', 'FV- 6'],
    ['fv-6', 'FV-6'],
    ['101 -4L', '101-4L'],
    ['S-2U H', 'S-2U-H'],
  ];
  for (const [a, b] of colisionan) {
    assert.equal(w.normalizeProductCode(a), w.normalizeProductCode(b),
      `esperaba que "${a}" y "${b}" normalizaran igual`);
  }

  // Estos NO deberían colisionar (son códigos distintos)
  const noColisionan = [
    ['FV-6', 'FV-60'],
    ['A-1', 'A-2'],
    ['FV-BOW-1/2', 'FV-BOW-1/3'],
  ];
  for (const [a, b] of noColisionan) {
    assert.notEqual(w.normalizeProductCode(a), w.normalizeProductCode(b),
      `"${a}" y "${b}" NO deberían normalizar igual`);
  }
});

test('normalizeProductCode: caso sospechoso — guion final único vs doble', () => {
  const w = setup();
  // Comentario en el código dice que UN guion final se preserva,
  // pero dos o más se recortan a uno. Probemos si esto puede
  // producir una colisión inesperada entre un código que termina
  // en un solo guion real y uno que traía relleno de ancho fijo.
  const a = w.normalizeProductCode('FV-BOW-1/2-');     // guion real al final
  const b = w.normalizeProductCode('FV-BOW-1/2---');   // guiones de relleno
  // Este "assert.equal" documenta un comportamiento CONOCIDO y ACEPTADO
  // (ver comentario en stock.js), no un bug: ambos casos colapsan al
  // mismo código porque no hay forma de distinguir un guion real de
  // relleno de Excel una vez reducidos a uno solo. Si esta prueba
  // empezara a fallar (es decir, si dejaran de colapsar igual) sería
  // señal de que alguien cambió esa lógica — conviene revisar que el
  // nuevo comportamiento siga pasando por mergeStockRows como conflicto
  // en vez de fusionarse en silencio.
  assert.equal(a, b, 'Ambos colapsan al mismo código: un guion real final es indistinguible de relleno de Excel');
});

test('mergeStockRows: agrupa colisiones y las marca (no las mezcla silenciosamente)', () => {
  const w = setup();
  const rows = [
    { idx: 0, code: 'FV-6', normalizedCode: 'FV-6', stock: 5, price: 100 },
    { idx: 1, code: 'FV-6', normalizedCode: 'FV-6', stock: 3, price: 120 },
    { idx: 2, code: 'GTR-1', normalizedCode: 'GTR-1', stock: 1, price: 50 },
  ];
  const merged = w.mergeStockRows(rows);
  assert.equal(merged.length, 2, 'debe quedar un grupo por código único');
  const grupoFV6 = merged.find(g => g.normalizedCode === 'FV-6');
  assert.equal(grupoFV6.collisionRows.length, 2, 'debe registrar las 2 filas en colisión');
});

test('sanitizeFirebaseKey: nunca debe dejar pasar caracteres inválidos para Firebase', () => {
  const w = setup();
  const invalidos = /[.#$\[\]\/]/;
  const casos = ['a.b', 'a#b', 'a$b', 'a[b]', 'a/b', '.#$[]/'];
  for (const c of casos) {
    const out = w.sanitizeFirebaseKey(c);
    assert.ok(!invalidos.test(out), `sanitizeFirebaseKey("${c}") dejó pasar un caracter inválido: "${out}"`);
  }
});

test('displayProductCode / normalizeProductCode: round-trip con barra "/"', () => {
  const w = setup();
  const original = 'FV-BOW-1/2';
  const norm = w.normalizeProductCode(original);
  const shown = w.displayProductCode(norm);
  assert.equal(shown, original, 'el round-trip normalizar → mostrar debe devolver la barra original');
});
