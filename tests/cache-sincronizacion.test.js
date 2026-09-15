// tests/cache-sincronizacion.test.js
//
// Verifica el mecanismo de caché local + sincronización incremental
// de firebase.js (ver el bloque "CACHÉ LOCAL + SINCRONIZACIÓN
// INCREMENTAL"). Desde el bug real de un producto vendido con datos
// desactualizados en el teléfono de un vendedor (nombre/precio
// viejos que llegaron a tumbar la confirmación de un pedido),
// /products dejó de persistir caché entre sesiones (persistCache:
// false) — cada vez que la app arranca, SIEMPRE hace una lectura
// completa y fresca del servidor antes de mostrar nada. /clients sí
// sigue con el caché+delta original (persistCache: true, el
// comportamiento por defecto), porque ahí un dato con unas horas de
// atraso no tiene ningún riesgo real. Estas pruebas confirman que:
//   1) toda escritura marca "updatedAt" (lo que hace posible pedir
//      "solo lo que cambió", usado por /clients),
//   2) watchProducts NUNCA persiste ni confía en un snapshot viejo
//      entre sesiones — cada conexión trae todo fresco del servidor,
//   3) watchClients SÍ mantiene el caché+delta: una sincronización
//      con caché reciente recoge altas/cambios de otro dispositivo
//      sin bajar todo /clients, aunque un borrado no se refleje hasta
//      la próxima resincronización completa (limitación aceptada,
//      documentada en el código, solo para /clients).

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

test('watchProducts: NO persiste caché entre sesiones — cada conexión trae /products completo y fresco del servidor', async () => {
  const { window, firebase } = setup();
  firebase._store.products = {
    'GTR-001': { name: 'Guitarra', stock: 10, price: 100, updatedAt: 1000 },
  };

  // Primera "sesión": watchProducts hace la sincronización inicial.
  let lastList = null;
  window.watchProducts(list => { lastList = list; });
  await waitTick();
  assert.equal(lastList.length, 1, 'primera carga debe traer el único producto existente');

  // A diferencia de /clients, acá NO debe quedar nada guardado en
  // localStorage — justamente lo que evita que un teléfono venda con
  // datos de hace horas/días si no se refresca a tiempo.
  const cacheRaw = window.localStorage.getItem('mf_cache_products_v1');
  assert.equal(cacheRaw, null, 'watchProducts no debe dejar ningún caché persistido en localStorage');

  // "Otro dispositivo" crea un producto nuevo.
  firebase._store.products['AMP-002'] = { name: 'Amplificador', stock: 5, price: 300, updatedAt: Date.now() };

  // Segunda "sesión" (simula reabrir la app días después, sin ningún
  // caché del que partir): debe traer el catálogo completo y fresco,
  // incluyendo el producto nuevo.
  let secondList = null;
  window.watchProducts(list => { secondList = list; });
  await waitTick();

  assert.ok(secondList.some(p => p.code === 'AMP-002'), 'el producto nuevo de otro dispositivo debe aparecer (lectura completa fresca)');
  assert.ok(secondList.some(p => p.code === 'GTR-001'), 'el producto viejo se mantiene');
});

test('watchProducts: un producto borrado por otro dispositivo SÍ desaparece de inmediato en la siguiente sesión (sin esperar 3 horas)', async () => {
  const { window, firebase } = setup();
  firebase._store.products = {
    'GTR-001': { name: 'Guitarra', stock: 10, price: 100, updatedAt: 1000 },
    'AMP-002': { name: 'Amplificador', stock: 5, price: 300, updatedAt: 1000 },
  };

  window.watchProducts(() => {});
  await waitTick();

  // Otro dispositivo borra AMP-002 directamente del árbol.
  delete firebase._store.products['AMP-002'];

  // Como /products ya no persiste caché entre sesiones, CUALQUIER
  // nueva conexión (reabrir la app) hace una lectura completa —
  // el borrado se ve al instante, sin esperar ninguna ventana de
  // 3 horas (esa limitación solo sigue existiendo para /clients).
  let list = null;
  window.watchProducts(l => { list = l; });
  await waitTick();
  assert.ok(!list.some(p => p.code === 'AMP-002'), 'el producto borrado ya no debe aparecer en la siguiente sesión');
  assert.ok(list.some(p => p.code === 'GTR-001'), 'el producto que sigue existiendo se mantiene');
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

test('watchProducts: un borrado físico (deleteProduct) SÍ se refleja al instante en otro dispositivo, sin esperar las 3 horas', async () => {
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
  // elimina el nodo de verdad (.remove()), no queda nada "fantasma"
  // en Firebase.
  await window.deleteProduct('AMP-002');

  // El listener 'child_removed' de "Dispositivo A" (agregado sobre el
  // nodo completo, sin depender de updatedAt) debe sacarlo de la
  // lista al instante — sin llamar a refreshProductsNow() ni esperar
  // la resincronización de 3 horas.
  await waitTick();
  assert.ok(!listA.some(p => p.code === 'AMP-002'), 'el borrado físico debe reflejarse en tiempo real, sin esperar 3 horas');
  assert.ok(listA.some(p => p.code === 'GTR-001'), 'el producto que sigue existiendo no se ve afectado');
});

test('watchClients: caché+delta persistido entre sesiones (a diferencia de watchProducts)', async () => {
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
