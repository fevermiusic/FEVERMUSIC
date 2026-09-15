// check-views-sync.js
//
// Por qué existe: router.js NO carga views/*.html en tiempo real —
// las 4 vistas están copiadas como texto dentro de router.js
// (VIEWS_HTML), a propósito, para que la app funcione abriendo
// index.html con doble clic, sin servidor. Eso significa que
// views/*.html son solo copias de referencia para editar más
// cómodo; router.js es la que realmente corre.
//
// El riesgo: si alguien edita views/stock-view.html pensando que
// eso ya actualiza la app, no pasa nada — hay que volver a copiar
// ese HTML dentro de router.js a mano. Si se olvida, las dos
// versiones se desincronizan sin ningún aviso (esto ya pasó una vez
// con historial y nueva-nota antes de este script).
//
// Qué hace este script: compara lo que hay embebido en router.js
// contra cada archivo de views/, y avisa exactamente cuál quedó
// desactualizado. Correlo antes de subir a producción:
//
//   node scripts/check-views-sync.js
//
// Si todo coincide, termina con código 0 ("todo sincronizado").
// Si algo no coincide, termina con código 1 y te dice cuál archivo
// hay que revisar — así nunca se sube al servidor una vista vieja
// sin que nadie se dé cuenta.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROUTER_PATH = path.join(ROOT, 'router.js');

const FILES = {
  'stock':      'views/stock-view.html',
  'pedidos':    'views/pedidos-view.html',
  'historial':  'views/historial-view.html',
  'nueva-nota': 'views/nueva-nota-view.html',
  'registros':  'views/registros-view.html',
};

function extractEmbeddedViews(routerSrc) {
  const startMarker = 'const VIEWS_HTML = {';
  const startIdx = routerSrc.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error('No se encontró "const VIEWS_HTML = {" en router.js — ¿cambió el nombre de la variable?');
  }
  let i = startIdx + startMarker.length - 1; // posición del '{' inicial
  let depth = 0, inStr = false, strCh = null, esc = false;
  for (; i < routerSrc.length; i++) {
    const c = routerSrc[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const objLiteral = routerSrc.slice(startIdx + 'const VIEWS_HTML = '.length, i + 1);
  // eslint-disable-next-line no-eval
  return eval('(' + objLiteral + ')');
}

const routerSrc = fs.readFileSync(ROUTER_PATH, 'utf8');
const embedded = extractEmbeddedViews(routerSrc);

let allSynced = true;

for (const [key, relPath] of Object.entries(FILES)) {
  const filePath = path.join(ROOT, relPath);
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const routerContent = embedded[key];

  if (routerContent === undefined) {
    console.error(`✗ router.js no tiene una entrada VIEWS_HTML["${key}"] para ${relPath}`);
    allSynced = false;
    continue;
  }

  if (fileContent !== routerContent) {
    console.error(`✗ DESINCRONIZADO: ${relPath} es distinto de lo que router.js realmente usa.`);
    console.error(`  → La versión que corre en la app está en router.js (VIEWS_HTML["${key}"]).`);
    console.error(`  → Copia ese contenido a ${relPath}, o si el cambio bueno está en ${relPath},`);
    console.error(`    cópialo dentro de router.js. Luego vuelve a correr este script.`);
    allSynced = false;
  } else {
    console.log(`✓ ${relPath} coincide con router.js`);
  }
}

if (!allSynced) {
  console.error('\nNo subas así a producción: al menos una vista quedó desactualizada.');
  process.exit(1);
} else {
  console.log('\nTodo sincronizado. Listo para producción.');
  process.exit(0);
}
