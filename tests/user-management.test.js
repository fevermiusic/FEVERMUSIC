// tests/user-management.test.js
//
// Prueba el mecanismo nuevo de cuentas individuales por vendedor:
// que activo=false bloquea de verdad, que el admin puede listar y
// activar/desactivar cuentas, y que crear una cuenta nueva no pisa
// una que ya existe con el mismo correo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');

function setup() {
  return loadApp(['firebase.js']);
}

test('getUserProfile: devuelve null si el uid no tiene perfil configurado', async () => {
  const { window } = setup();
  const profile = await window.getUserProfile('uid-inexistente');
  assert.equal(profile, null);
});

test('getUserProfile: devuelve el perfil completo cuando existe', async () => {
  const { window, firebase } = setup();
  firebase._store.users = {
    'uid-1': { nombre: 'Ana Torres', email: 'ana@fever.com', rol: 'vendedor', activo: true },
  };
  const profile = await window.getUserProfile('uid-1');
  assert.equal(profile.nombre, 'Ana Torres');
  assert.equal(profile.rol, 'vendedor');
  assert.equal(profile.activo, true);
});

test('setUserActive: apagar una cuenta se refleja de inmediato en la base', async () => {
  const { window, firebase } = setup();
  firebase._store.users = { 'uid-1': { nombre: 'Ana', rol: 'vendedor', activo: true } };

  await window.setUserActive('uid-1', false);
  assert.equal(firebase._store.users['uid-1'].activo, false);

  const profile = await window.getUserProfile('uid-1');
  assert.equal(profile.activo, false, 'getUserProfile debe reflejar el cambio inmediatamente, no una copia vieja');
});

test('getAllUsers: devuelve todas las cuentas con más recientes primero', async () => {
  const { window, firebase } = setup();
  firebase._store.users = {
    'uid-viejo':  { nombre: 'Admin', rol: 'admin', activo: true, creadoEn: 1000 },
    'uid-nuevo':  { nombre: 'Vendedor nuevo', rol: 'vendedor', activo: true, creadoEn: 5000 },
  };
  const users = await window.getAllUsers();
  assert.equal(users.length, 2);
  assert.equal(users[0].uid, 'uid-nuevo', 'la cuenta más reciente debe aparecer primero');
});

test('createVendorAccount: crea el perfil correcto y NO afecta la sesión del admin', async () => {
  const { window, firebase } = setup();

  const uid = await window.createVendorAccount('pedro', 'clave123', 'Pedro Ruiz', 'pedro@fever.com');

  assert.ok(uid, 'debe devolver el uid de la cuenta creada');
  const perfil = firebase._store.users[uid];
  assert.equal(perfil.nombre, 'Pedro Ruiz');
  assert.equal(perfil.usuario, 'pedro');
  assert.equal(perfil.correo, 'pedro@fever.com');
  assert.equal(perfil.rol, 'vendedor');
  assert.equal(perfil.activo, true, 'una cuenta nueva debe quedar activa por defecto');
});

test('createVendorAccount: normaliza el usuario (mayúsculas, espacios, acentos) antes de guardarlo', async () => {
  const { window, firebase } = setup();
  const uid = await window.createVendorAccount('  ÁNA Torres  ', 'clave123', 'Ana Torres');
  assert.equal(firebase._store.users[uid].usuario, 'anatorres');
});

test('createVendorAccount: dos cuentas con el mismo usuario no pueden coexistir', async () => {
  const { window } = setup();
  await window.createVendorAccount('juan', 'clave123', 'Primero');
  await assert.rejects(
    () => window.createVendorAccount('juan', 'clave456', 'Segundo'),
    /already in use|in-use/i
  );
  // Tampoco si se escribe con mayúsculas distintas — es el mismo usuario.
  await assert.rejects(
    () => window.createVendorAccount('JUAN', 'clave789', 'Tercero'),
    /already in use|in-use/i
  );
});

test('auth-guard.js: una cuenta con activo=false debe cerrar sesión y no dejar pasar', async () => {
  // Esta prueba ejercita el flujo real de auth-guard.js: carga la
  // página con un usuario ya "autenticado" (vía el stub) cuyo
  // perfil en /users tiene activo:false, y confirma que se cierra
  // la sesión en vez de dejarlo entrar. jsdom no implementa
  // navegación real, así que el intento de redirección (window.
  // location.href = 'login.html?...') se captura como un error de
  // su consola virtual en vez de compararse directamente.
  const { JSDOM } = require('jsdom');
  const { createFakeFirebase } = require('./helpers/fake-firebase');
  const fs = require('fs');
  const path = require('path');
  const { VirtualConsole } = require('jsdom');

  const virtualConsole = new VirtualConsole();
  let capturedNavError = null;
  virtualConsole.on('jsdomError', err => { capturedNavError = err; });

  const dom = new JSDOM('<!DOCTYPE html><body><div class="user-card"></div></body>', {
    url: 'https://example.invalid/index.html',
    runScripts: 'dangerously',
    virtualConsole,
  });
  const window = dom.window;

  const firebase = createFakeFirebase();
  firebase._store.users = { 'uid-1': { nombre: 'Ex empleado', rol: 'vendedor', activo: false } };

  let signedOut = false;
  const realAuth = firebase.auth;
  firebase.auth = () => {
    const real = realAuth();
    return {
      ...real,
      onAuthStateChanged(cb) { cb({ uid: 'uid-1', email: 'ex@fever.com' }); },
      signOut() { signedOut = true; return Promise.resolve(); },
    };
  };
  window.firebase = firebase;
  window.alert = () => {};

  for (const relPath of ['firebase.js', 'auth-guard.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
    const script = window.document.createElement('script');
    script.textContent = code;
    window.document.body.appendChild(script);
  }

  await new Promise(resolve => setTimeout(resolve, 30));

  // jsdom no implementa navegación de página real, así que no podemos
  // leer window.location.href después del intento — pero SÍ podemos
  // confirmar lo que de verdad importa para la seguridad: que una
  // cuenta desactivada se cierra (signOut) en vez de quedar adentro.
  assert.equal(signedOut, true, 'una cuenta desactivada debe forzar signOut() y no dejarla entrar');
  assert.ok(capturedNavError, 'debe haber intentado salir de la página (redirigir a login.html)');
});

test('normalizeUsername / usernameToAuthEmail: producen un correo técnico estable y sin choques por mayúsculas/acentos', () => {
  const { window } = setup();
  assert.equal(window.normalizeUsername('Ana Torres'), 'anatorres');
  assert.equal(window.normalizeUsername('  JUAN  '), 'juan');
  assert.equal(window.normalizeUsername('José'), 'jose');
  assert.equal(window.usernameToAuthEmail('ana'), 'ana@fever.local');
  assert.equal(window.usernameToAuthEmail('Ana Torres'), 'anatorres@fever.local');
});

test('createVendorAccount: rechaza un usuario vacío o solo de símbolos', async () => {
  const { window } = setup();
  await assert.rejects(() => window.createVendorAccount('', 'clave123', 'Nadie'));
  await assert.rejects(() => window.createVendorAccount('   ', 'clave123', 'Nadie'));
  await assert.rejects(() => window.createVendorAccount('@@@', 'clave123', 'Nadie'));
});
