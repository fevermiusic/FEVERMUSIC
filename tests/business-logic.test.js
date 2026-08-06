// tests/business-logic.test.js
//
// Ejercita las funciones REALES de firebase.js (no una reescritura)
// contra el stub de base de datos en memoria. La idea es probar el
// comportamiento que más le puede costar caro al negocio si se
// rompe: vender con stock insuficiente, perder stock cuando falla
// un pedido a medias, o pisar un producto que otra persona acaba
// de crear.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');

function setup() {
  const { window, firebase } = loadApp(['firebase.js']);
  return { window, firebase };
}

test('addStock: suma al stock existente de forma atómica', async () => {
  const { window, firebase } = setup();
  firebase._store.products = { 'GTR-001': { name: 'Guitarra', stock: 10, price: 100 } };

  await window.addStock('GTR-001', 5);
  assert.equal(firebase._store.products['GTR-001'].stock, 15);
});

test('decrementStock: descuenta stock cuando alcanza para todos los productos del pedido', async () => {
  const { window, firebase } = setup();
  firebase._store.products = {
    'GTR-001': { name: 'Guitarra', stock: 10 },
    'AMP-002': { name: 'Amplificador', stock: 3 },
  };

  const results = await window.decrementStock([{ code: 'GTR-001', qty: 2 }, { code: 'AMP-002', qty: 1 }]);

  assert.equal(firebase._store.products['GTR-001'].stock, 8);
  assert.equal(firebase._store.products['AMP-002'].stock, 2);
  assert.ok(results.every(r => r.ok));
});

test('normalizeProductCode: un espacio antes de un guion no debe duplicarlo ("101 -4L" y "101-4L" son el mismo código)', () => {
  const { window } = loadApp(['import-stock.js', 'stock.js']);
  assert.equal(window.normalizeProductCode('101 -4L'), '101-4L');
  assert.equal(window.normalizeProductCode('101-4L'), '101-4L');
  assert.equal(window.normalizeProductCode('101  -   4L'), '101-4L');
});

test('normalizeProductCode: preserva un guion, comilla o barra de fracción que queda al FINAL (son parte real del código), sin tocar el inicio', () => {
  const { window } = loadApp(['import-stock.js', 'stock.js']);
  // Un guion que queda pegado al final ahora SÍ se conserva (antes se
  // recortaba asumiendo que siempre venía de relleno de Excel, pero
  // ya no hay forma de distinguirlo de un guion real escrito a mano)
  assert.equal(window.normalizeProductCode('B-3K-                    '), 'B-3K-');
  // El guion del MEDIO del código nunca se tocó, sigue igual
  assert.equal(window.normalizeProductCode('FV-BOW-1/2               '), 'FV-BOW-1⁄2');
  // Un código ya limpio no debe verse afectado
  assert.equal(window.normalizeProductCode('CKCL002'), 'CKCL002');
});

test('normalizeProductCode: si el mismo símbolo queda repetido al final (comilla, barra de fracción o guion), se deja solo uno', () => {
  const { window } = loadApp(['import-stock.js', 'stock.js']);
  assert.equal(window.normalizeProductCode('14""'), '14"');
  assert.equal(window.normalizeProductCode('TOM-14"""'), 'TOM-14"');
  assert.equal(window.normalizeProductCode('FV-BOW-1/2//'), 'FV-BOW-1⁄2⁄');
  assert.equal(window.normalizeProductCode('FV-BOW-1/2--'), 'FV-BOW-1⁄2-');
});

test('decrementStock: si UN producto no alcanza, no debe quedar stock "fantasma" descontado en los demás', async () => {
  const { window, firebase } = setup();
  // Este es exactamente el bug que el propio código documenta haber
  // corregido: revertir lo ya descontado si falla a medias.
  firebase._store.products = {
    'GTR-001': { name: 'Guitarra', stock: 10 },
    'AMP-002': { name: 'Amplificador', stock: 3 },
    'MIC-003': { name: 'Micrófono', stock: 0 }, // este no alcanza
  };

  await assert.rejects(() =>
    window.decrementStock([
      { code: 'GTR-001', qty: 2 },
      { code: 'AMP-002', qty: 1 },
      { code: 'MIC-003', qty: 1 },
    ])
  );

  // Los dos que SÍ tenían stock deben haber vuelto a su valor original.
  assert.equal(firebase._store.products['GTR-001'].stock, 10, 'GTR-001 debió revertirse a su stock original');
  assert.equal(firebase._store.products['AMP-002'].stock, 3, 'AMP-002 debió revertirse a su stock original');
  assert.equal(firebase._store.products['MIC-003'].stock, 0);
});

test('decrementStock: nunca deja el stock en negativo aunque dos ventas casi simultáneas compitan por lo último que queda', async () => {
  const { window, firebase } = setup();
  firebase._store.products = { 'GTR-001': { name: 'Guitarra', stock: 1 } };

  // Dos "vendedores" intentando vender la última unidad al mismo tiempo.
  const [a, b] = await Promise.allSettled([
    window.decrementStock([{ code: 'GTR-001', qty: 1 }]),
    window.decrementStock([{ code: 'GTR-001', qty: 1 }]),
  ]);

  const okCount = [a, b].filter(r => r.status === 'fulfilled').length;
  const failCount = [a, b].filter(r => r.status === 'rejected').length;

  assert.equal(okCount, 1, 'exactamente una de las dos ventas debe tener éxito');
  assert.equal(failCount, 1, 'la otra debe fallar por falta de stock, no venderse igual');
  assert.equal(firebase._store.products['GTR-001'].stock, 0, 'el stock final nunca debe quedar negativo');
});

test('saveProduct con isNew=true: dos creaciones simultáneas con el mismo código no se pisan entre sí', async () => {
  const { window, firebase } = setup();
  firebase._store.products = {};

  const [a, b] = await Promise.allSettled([
    window.saveProduct('GTR-006', { name: 'Guitarra A', desc: '', price: 100, stock: 5, category: 'general' }, undefined, true),
    window.saveProduct('GTR-006', { name: 'Guitarra B', desc: '', price: 200, stock: 8, category: 'general' }, undefined, true),
  ]);

  const okCount = [a, b].filter(r => r.status === 'fulfilled').length;
  const failCount = [a, b].filter(r => r.status === 'rejected').length;

  assert.equal(okCount, 1, 'solo una de las dos creaciones debe ganar');
  assert.equal(failCount, 1, 'la otra debe fallar con un error claro, no sobreescribir en silencio');
  assert.ok(
    ['Guitarra A', 'Guitarra B'].includes(firebase._store.products['GTR-006'].name),
    'el producto que ganó debe quedar intacto con sus propios datos'
  );
});

test('saveProduct con isNew=true: el mensaje de error explica qué pasó', async () => {
  const { window, firebase } = setup();
  firebase._store.products = { 'GTR-006': { name: 'Ya existente', stock: 1, price: 1 } };

  await assert.rejects(
    () => window.saveProduct('GTR-006', { name: 'Nueva', desc: '', price: 1, stock: 1, category: 'general' }, undefined, true),
    /ya existe un producto/i
  );
  assert.equal(firebase._store.products['GTR-006'].name, 'Ya existente', 'no debe haberse tocado el producto existente');
});

test('deleteProduct: borrado físico real — el nodo desaparece por completo de /products', async () => {
  const { window, firebase } = setup();
  firebase._store.products = { 'GTR-001': { name: 'Guitarra', stock: 1 } };
  await window.deleteProduct('GTR-001');
  // El nodo ya no existe en absoluto (no queda "fantasma" con
  // deleted:true en la base real). El borrado sigue viajando en
  // tiempo real a otras pantallas/dispositivos gracias al listener
  // 'child_removed' agregado en watchCollectionWithCache.
  assert.equal(firebase._store.products['GTR-001'], undefined);
});

test('saveProduct con isNew=true sobre un producto borrado lógicamente: revive el código en vez de rechazarlo', async () => {
  const { window, firebase } = setup();
  firebase._store.products = { 'GTR-001': { name: 'Guitarra vieja', stock: 0, deleted: true } };

  await window.saveProduct('GTR-001', { name: 'Guitarra nueva', desc: '', price: 100, stock: 5, category: 'general' }, undefined, true);

  const p = firebase._store.products['GTR-001'];
  assert.equal(p.name, 'Guitarra nueva');
  assert.equal(p.stock, 5);
  assert.equal(p.deleted, undefined, 'la marca de eliminado debe desaparecer al revivir el código');
});

test('saveOrder + generateNextOrderNumber: los números de nota son correlativos, no aleatorios', async () => {
  const { window, firebase } = setup();
  firebase._store.orders = {};

  const year = 2026;
  const n1 = await window.generateNextOrderNumber(year);
  await window.saveOrder({ numero: n1, cliente: 'Juan', ruc: '12345678901', items: [], total: 100 });

  const n2 = await window.generateNextOrderNumber(year);

  assert.equal(n1, `NP-${year}-001`);
  assert.equal(n2, `NP-${year}-002`, 'el siguiente número debe ser el correlativo, no repetirse ni saltar al azar');
});
