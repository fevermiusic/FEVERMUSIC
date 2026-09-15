// tests/load-simulation.js
//
// No es una prueba de node:test — es un ensayo de carga que corre
// aparte (node tests/load-simulation.js) y muestra un reporte. Usa
// las funciones REALES de firebase.js contra la base de datos en
// memoria, con un volumen de datos parecido al que tendría el
// negocio funcionando de verdad: cientos de productos y varios
// vendedores confirmando pedidos al mismo tiempo.
//
// Qué mide:
//   1) Que ningún producto termine con stock negativo.
//   2) Que la suma de lo vendido + lo que queda en stock siempre
//      cuadre con el stock inicial (no se "pierde" ni se "duplica"
//      inventario en el camino).
//   3) Cuánto tarda el sistema en resolver todo (referencia de
//      rendimiento, no un límite estricto).

const { loadApp } = require('./helpers/load-app');

const N_PRODUCTS   = 500;
const N_CLIENTS    = 200;
const N_VENDEDORES = 30;   // "usuarios" concurrentes
const PEDIDOS_POR_VENDEDOR = 10;

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

async function main() {
  const { window, firebase } = loadApp(['firebase.js']);

  // ── Sembrar datos realistas ──
  const products = {};
  const initialStockTotal = {};
  for (let i = 1; i <= N_PRODUCTS; i++) {
    const code = 'PRD-' + String(i).padStart(4, '0');
    const stock = randInt(0, 50);
    products[code] = {
      name: `Producto ${i}`,
      desc: '',
      price: randInt(20, 2000),
      stock,
      category: pick(['guitarras', 'baterias', 'teclados', 'audio', 'accesorios']),
    };
    initialStockTotal[code] = stock;
  }
  firebase._store.products = products;
  firebase._store.clients = {};
  for (let i = 1; i <= N_CLIENTS; i++) {
    const ruc = String(10000000000 + i);
    firebase._store.clients[ruc] = { nombre: `Cliente ${i}`, ciudad: pick(['Lima', 'Cusco', 'Tacna', 'Arequipa']) };
  }
  firebase._store.orders = {};

  const codes = Object.keys(products);
  const soldPerCode = {};
  const failedPerCode = {};
  codes.forEach(c => { soldPerCode[c] = 0; failedPerCode[c] = 0; });

  // ── Simular N vendedores confirmando pedidos concurrentemente ──
  const t0 = Date.now();
  let totalPedidosOk = 0;
  let totalPedidosFallidos = 0;
  let stockNegativoDetectado = false;

  const vendedorTasks = [];
  for (let v = 0; v < N_VENDEDORES; v++) {
    vendedorTasks.push((async () => {
      for (let p = 0; p < PEDIDOS_POR_VENDEDOR; p++) {
        // Pedido con 1 a 4 productos distintos, cantidades chicas (venta real)
        const nItems = randInt(1, 4);
        const items = [];
        for (let k = 0; k < nItems; k++) {
          items.push({ code: pick(codes), qty: randInt(1, 3) });
        }
        try {
          const results = await window.decrementStock(items);
          results.forEach(r => { soldPerCode[r.code] += r.qty; });
          totalPedidosOk++;
        } catch (err) {
          // Falla esperada (stock insuficiente) — no es un error del sistema.
          (err.failedItems || []).forEach(f => { failedPerCode[f.code] = (failedPerCode[f.code] || 0) + 1; });
          totalPedidosFallidos++;
        }
      }
    })());
  }

  await Promise.all(vendedorTasks);
  const elapsedMs = Date.now() - t0;

  // ── Verificar integridad del inventario ──
  for (const code of codes) {
    const finalStock = firebase._store.products[code].stock;
    if (finalStock < 0) stockNegativoDetectado = true;
    const esperado = initialStockTotal[code] - soldPerCode[code];
    if (finalStock !== esperado) {
      console.log(`✗ DESCUADRE en ${code}: inicial=${initialStockTotal[code]} vendido=${soldPerCode[code]} final=${finalStock} (esperado ${esperado})`);
    }
  }

  const totalOperacionesStock = N_VENDEDORES * PEDIDOS_POR_VENDEDOR;

  console.log('='.repeat(60));
  console.log('SIMULACIÓN DE CARGA — Musical Fever');
  console.log('='.repeat(60));
  console.log(`Productos sembrados:          ${N_PRODUCTS}`);
  console.log(`Clientes sembrados:           ${N_CLIENTS}`);
  console.log(`Vendedores concurrentes:      ${N_VENDEDORES}`);
  console.log(`Pedidos por vendedor:         ${PEDIDOS_POR_VENDEDOR}`);
  console.log(`Total de pedidos intentados:  ${totalOperacionesStock}`);
  console.log(`Pedidos confirmados:          ${totalPedidosOk}`);
  console.log(`Pedidos rechazados (sin stock suficiente, esperado): ${totalPedidosFallidos}`);
  console.log(`Tiempo total:                 ${elapsedMs} ms`);
  console.log(`Promedio por pedido:          ${(elapsedMs / totalOperacionesStock).toFixed(2)} ms`);
  console.log('-'.repeat(60));
  console.log(`Stock negativo detectado:     ${stockNegativoDetectado ? '❌ SÍ (grave)' : '✓ No, ningún producto quedó en negativo'}`);
  console.log('='.repeat(60));

  if (stockNegativoDetectado) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('La simulación falló con un error inesperado:', err);
  process.exitCode = 1;
});
