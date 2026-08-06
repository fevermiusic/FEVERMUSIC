// tests/cache-sincronizacion.test.js
//
// Verifica el mecanismo de caché local + sincronización incremental
// de watchProducts/watchClients (ver el bloque "CACHÉ LOCAL +
// SINCRONIZACIÓN INCREMENTAL" en firebase.js). El objetivo del
// mecanismo es dejar de bajar el catálogo completo de /products y
// /clients cada vez que se abre la app — estas pruebas confirman que:
//   1) toda escritura marca "updatedAt" (lo que hace posible pedir
//      "solo lo que cambió"),
//   2) una sincronización con caché reciente SÍ recoge altas/cambios
//      hechos por otro dispositivo después de la última sync,
//   3) un borrado hecho por otro dispositivo NO se refleja hasta la
//      próxima resincronización completa (limitación conocida y
//      aceptada, documentada en el código — no es un bug).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');

function setup() {
  const { window, firebase } = loadApp(['firebase.js']);
  return { window, firebase };
}

function waitTick() {
  return new Promise(resolve => setTimeout(resolve, 80)); // > 50ms de debounce interno
}

test('saveProduct / addStock / decrementStock / saveClient marcan "updatedAt"', async () => {
  const { window, firebase } = setup();
  firebase._store.products = { 'GTR-001': { name: 'Guitarra', stock: 10, price: 100 } };
  firebase._store.clients = {};

  await window.saveProduct('GTR-001', { name: 'Guitarra', price: 120 }, 10);
  assert.ok(typeof firebase._store.products['GTR-001'].updatedAt === 'number', 'saveProduct debe marcar updatedAt');

  await window.addStock('GTR-001', 3);
  assert.ok(typeof firebase._store.products['GTR-001'].updatedAt === 'number', 'addStock debe marcar updatedAt');

  await window.decrementStock([{ code: 'GTR-001', qty: 1 }]);
  assert.ok(typeof firebase._store.products['GTR-001'].updatedAt === 'number', 'decrementStock debe marcar updatedAt');

  await window.saveClient('20123456789', { nombre: 'Cliente Uno', ciudad: 'Lima' });
  assert.ok(typeof firebase._store.clients['20123456789'].updatedAt === 'number', 'saveClient debe marcar updatedAt');
});

test('watchProducts: con caché reciente, un alta de otro dispositivo SÍ se refleja (sin necesitar bajar todo /products)', async () => {
  const { window, firebase } = setup();
  firebase._store.products = {
    'GTR-001': { name: 'Guitarra', stock: 10, price: 100, updatedAt: 1000 },
  };

  // Primera "sesión": watchProducts hace la sincronización inicial y
  // guarda el caché en localStorage.
  let lastList = null;
  window.watchProducts(list => { lastList = list; });
  await waitTick();
  assert.equal(lastList.length, 1, 'primera carga debe traer el único producto existente');

  const cacheRaw = window.localStorage.getItem('mf_cache_products_v1');
  assert.ok(cacheRaw, 'debe haber quedado un caché guardado en localStorage');
  const cache = JSON.parse(cacheRaw);
  assert.ok(cache.lastSync > 0 && cache.lastFullSync > 0, 'el caché debe registrar lastSync y lastFullSync');

  // "Otro dispositivo" crea un producto nuevo con updatedAt posterior
  // a la última sincronización.
  firebase._store.products['AMP-002'] = { name: 'Amplificador', stock: 5, price: 300, updatedAt: cache.lastSync + 5000 };

  // Segunda "sesión" en la MISMA pestaña/localStorage (simula reabrir
  // la app): watchProducts debe partir del caché guardado y traer el
  // producto nuevo vía la consulta incremental, sin volver a
  // re-emitir todo desde cero como un child_added sin filtro.
  let secondList = null;
  window.watchProducts(list => { secondList = list; });
  await waitTick();

  assert.ok(secondList.some(p => p.code === 'AMP-002'), 'el producto nuevo de otro dispositivo debe aparecer tras la sincronización incremental');
  assert.ok(secondList.some(p => p.code === 'GTR-001'), 'el producto viejo (ya en caché) se mantiene');
});

test('watchProducts: un producto borrado por otro dispositivo NO desaparece hasta la resincronización completa (limitación aceptada)', async () => {
  const { window, firebase } = setup();
  firebase._store.products = {
    'GTR-001': { name: 'Guitarra', stock: 10, price: 100, updatedAt: 1000 },
    'AMP-002': { name: 'Amplificador', stock: 5, price: 300, updatedAt: 1000 },
  };

  window.watchProducts(() => {});
  await waitTick();

  // Otro dispositivo borra AMP-002 directamente del árbol.
  delete firebase._store.products['AMP-002'];

  // lastFullSync sigue "reciente" (no pasaron las 3hs) -> no toca
  // resincronizar completo, así que el borrado no se detecta todavía.
  let list = null;
  window.watchProducts(l => { list = l; });
  await waitTick();
  assert.ok(list.some(p => p.code === 'AMP-002'), 'mientras no toque una resincronización completa, el producto borrado sigue en la lista (limitación documentada)');

  // Se simula que ya pasaron más de 3 horas desde la última
  // resincronización completa, editando el caché guardado.
  const cache = JSON.parse(window.localStorage.getItem('mf_cache_products_v1'));
  cache.lastFullSync = Date.now() - (4 * 60 * 60 * 1000);
  window.localStorage.setItem('mf_cache_products_v1', JSON.stringify(cache));

  let listAfterFullResync = null;
  window.watchProducts(l => { listAfterFullResync = l; });
  await waitTick();
  assert.ok(!listAfterFullResync.some(p => p.code === 'AMP-002'), 'tras la resincronización completa, el producto borrado ya no debe aparecer');
  assert.ok(listAfterFullResync.some(p => p.code === 'GTR-001'), 'el producto que sigue existiendo se mantiene tras la resincronización completa');
});

test('refreshProductsNow(): fuerza un refresco completo al instante, sin esperar el listener en tiempo real ni las 3 horas', async () => {
  const { window, firebase } = setup();
  firebase._store.products = {
    'GTR-001': { name: 'Guitarra', stock: 10, price: 100, updatedAt: 1000 },
  };

  let lastList = null;
  window.watchProducts(list => { lastList = list; });
  await waitTick();
  assert.equal(lastList.find(p => p.code === 'GTR-001').price, 100);

  // Se simula lo que hace "Importar todo": otra escritura reemplaza
  // precio y stock directamente en el árbol (como si import-stock.js
  // hubiera llamado a saveProduct), y además se borra un producto —
  // sin pasar por watchProducts, para que el listener en tiempo real
  // no tenga por qué haberse enterado todavía.
  firebase._store.products['GTR-001'] = { name: 'Guitarra', stock: 25, price: 150, updatedAt: 999999999999 };

  await window.refreshProductsNow();
  await waitTick();

  const updated = lastList.find(p => p.code === 'GTR-001');
  assert.equal(updated.price, 150, 'refreshProductsNow debe traer el precio reemplazado al instante');
  assert.equal(updated.stock, 25, 'refreshProductsNow debe traer la cantidad reemplazada al instante');
});

test('refreshProductsNow(): un borrado se refleja al instante (no hace falta esperar las 3 horas)', async () => {
  const { window, firebase } = setup();
  firebase._store.products = {
    'GTR-001': { name: 'Guitarra', stock: 10, price: 100, updatedAt: 1000 },
    'AMP-002': { name: 'Amplificador', stock: 5, price: 300, updatedAt: 1000 },
  };

  let list = null;
  window.watchProducts(l => { list = l; });
  await waitTick();
  assert.ok(list.some(p => p.code === 'AMP-002'));

  delete firebase._store.products['AMP-002'];
  await window.refreshProductsNow();
  await waitTick();

  assert.ok(!list.some(p => p.code === 'AMP-002'), 'tras refreshProductsNow, el producto borrado ya no debe aparecer, sin esperar 3 horas');
  assert.ok(list.some(p => p.code === 'GTR-001'));
});

test('watchProducts: un borrado lógico (deleteProduct) SÍ se refleja al instante en otro dispositivo, sin esperar las 3 horas', async () => {
  const { window, firebase } = setup();
  firebase._store.products = {
    'GTR-001': { name: 'Guitarra', stock: 10, price: 100, updatedAt: 1000 },
    'AMP-002': { name: 'Amplificador', stock: 5, price: 300, updatedAt: 1000 },
  };

  // "Dispositivo A": abre Stock y deja el listener en tiempo real activo.
  let listA = null;
  window.watchProducts(l => { listA = l; });
  await waitTick();
  assert.ok(listA.some(p => p.code === 'AMP-002'));

  // "Dispositivo B" (o el mismo, da igual): borra AMP-002 usando
  // deleteProduct(), como hace el botón "Eliminar" de Stock — esto
  // NO borra el nodo, lo marca deleted:true + updatedAt actual.
  await window.deleteProduct('AMP-002');

  // El listener en tiempo real de "Dispositivo A" debe recibirlo como
  // un child_changed normal (mismo canal que un cambio de precio), y
  // sacarlo de la lista al instante — sin llamar a refreshProductsNow()
  // ni esperar la resincronización de 3 horas.
  await waitTick();
  assert.ok(!listA.some(p => p.code === 'AMP-002'), 'el borrado lógico debe reflejarse en tiempo real, sin esperar 3 horas');
  assert.ok(listA.some(p => p.code === 'GTR-001'), 'el producto que sigue existiendo no se ve afectado');
});

test('watchClients: mismo mecanismo de caché+delta que watchProducts', async () => {
  const { window, firebase } = setup();
  firebase._store.clients = {
    '20111111111': { nombre: 'Cliente A', ciudad: 'Lima', updatedAt: 1000 },
  };

  window.watchClients(() => {});
  await waitTick();

  const cache = JSON.parse(window.localStorage.getItem('mf_cache_clients_v1'));
  firebase._store.clients['20222222222'] = { nombre: 'Cliente B', ciudad: 'Arequipa', updatedAt: cache.lastSync + 5000 };

  let list = null;
  window.watchClients(l => { list = l; });
  await waitTick();
  assert.ok(list.some(c => c.ruc === '20222222222'), 'un cliente nuevo de otro dispositivo debe llegar por sincronización incremental');
});
