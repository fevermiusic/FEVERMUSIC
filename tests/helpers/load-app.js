// tests/helpers/load-app.js
//
// Carga los archivos REALES del proyecto (no copias, no
// reescrituras) dentro de una ventana jsdom, con firebase.js
// apuntando al stub en memoria de fake-firebase.js en vez de a
// internet. Así las pruebas ejercitan el código que de verdad se
// sube a producción.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createFakeFirebase } = require('./fake-firebase');

const ROOT = path.join(__dirname, '..', '..');

function readSrc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/**
 * @param {string[]} files - rutas relativas de los .js del proyecto a cargar, en orden
 * @param {string} bodyHtml - HTML inicial del <body>, si la prueba necesita elementos concretos
 */
function loadApp(files, bodyHtml = '') {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`, {
    url: 'https://example.invalid/index.html',
    pretendToBeVisual: true,
    runScripts: 'dangerously', // necesario para que los <script> corran en el realm real del window
  });
  const { window } = dom;

  // Stubs mínimos que el navegador real da gratis y jsdom no siempre cubre.
  window.firebase = createFakeFirebase();
  window.alert = () => {};
  window.confirm = () => true;
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  window.localStorage = window.localStorage || (() => {
    let data = {};
    return {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: k => { delete data[k]; },
      clear: () => { data = {}; },
    };
  })();

  const errors = [];
  window.addEventListener('error', e => errors.push(e.error || e.message));

  // window.eval() de jsdom NO comparte el realm global real del
  // documento (los `function` de nivel superior no quedan visibles
  // en `window` después). La forma correcta de ejecutar scripts de
  // "página clásica" es insertarlos como <script> reales.
  for (const relPath of files) {
    const code = readSrc(relPath);
    const script = window.document.createElement('script');
    script.textContent = code;
    window.document.body.appendChild(script);
  }

  return { window, document: window.document, firebase: window.firebase, errors };
}

module.exports = { loadApp, readSrc, ROOT };
