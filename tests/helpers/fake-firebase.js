// tests/helpers/fake-firebase.js
//
// Imita, en memoria, el subconjunto del SDK de Firebase Realtime
// Database que realmente usa la app (ref/child/set/update/remove/
// get/transaction/on/off) — lo suficiente para poder correr
// firebase.js DE VERDAD (el archivo real del proyecto, no una
// reescritura) dentro de una prueba, sin depender de internet ni
// de un proyecto de Firebase real.
//
// Importante: transaction() imita el comportamiento real de
// Firebase — si dos transacciones "compiten" por el mismo nodo,
// cada updateFn recibe el valor MÁS RECIENTE en el momento en que
// le toca correr (no el valor de cuando se llamó originalmente).
// Eso es justamente lo que hace que el candado anti-duplicados de
// saveProduct(...) funcione, y lo que estas pruebas verifican.

function createFakeFirebase() {
  const store = {};

  function getAt(parts) {
    let node = store;
    for (const p of parts) {
      if (node == null || typeof node !== 'object') return undefined;
      node = node[p];
    }
    return node;
  }

  function setAt(parts, value) {
    if (parts.length === 0) return;
    let node = store;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (node[p] == null || typeof node[p] !== 'object') node[p] = {};
      node = node[p];
    }
    const lastKey = parts[parts.length - 1];
    if (value === undefined || value === null) delete node[lastKey];
    else node[lastKey] = value;
  }

  function deepClone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function makeSnapshot(parts) {
    const val = getAt(parts);
    return {
      val: () => deepClone(val),
      exists: () => val !== undefined && val !== null,
      forEach: cb => {
        if (val && typeof val === 'object') {
          Object.keys(val).forEach(k => cb(makeSnapshot([...parts, k])));
        }
      },
      key: parts[parts.length - 1] ?? null,
    };
  }

  const listeners = {}; // pathStr -> { event: [callbacks] }

  function pathStr(parts) { return parts.join('/'); }

  function fireListeners(parts, event) {
    // Notifica a los listeners exactos de ese path Y a los del padre
    // (child_added/child_changed/child_removed), como hace Firebase.
    const exact = listeners[pathStr(parts)];
    if (exact && exact[event]) exact[event].forEach(cb => cb(makeSnapshot(parts)));

    if (parts.length > 0) {
      const parentParts = parts.slice(0, -1);
      const parentKey = pathStr(parentParts);
      const childEvent = { set: 'child_changed', update: 'child_changed', remove: 'child_removed' }[event];
      if (childEvent && listeners[parentKey] && listeners[parentKey][childEvent]) {
        listeners[parentKey][childEvent].forEach(cb => cb(makeSnapshot(parts)));
      }
    }
  }

  let pushCounter = 0;

  function makeRef(parts) {
    return {
      key: parts[parts.length - 1] ?? null,
      child(key) { return makeRef([...parts, ...String(key).split('/')]); },

      push() {
        pushCounter += 1;
        const id = '-fake' + String(pushCounter).padStart(8, '0');
        return makeRef([...parts, id]);
      },

      set(value) {
        setAt(parts, deepClone(value));
        fireListeners(parts, 'set');
        return Promise.resolve();
      },

      update(value) {
        const current = getAt(parts);
        const merged = { ...(current && typeof current === 'object' ? current : {}), ...deepClone(value) };
        setAt(parts, merged);
        fireListeners(parts, 'update');
        return Promise.resolve();
      },

      remove() {
        setAt(parts, undefined);
        fireListeners(parts, 'remove');
        return Promise.resolve();
      },

      get() { return Promise.resolve(makeSnapshot(parts)); },
      once() { return Promise.resolve(makeSnapshot(parts)); },

      on(event, cb) {
        const key = pathStr(parts);
        if (!listeners[key]) listeners[key] = {};
        if (!listeners[key][event]) listeners[key][event] = [];
        listeners[key][event].push(cb);
        // Firebase llama a child_added una vez por cada hijo existente
        // al momento de suscribirse. Lo imitamos para 'child_added'.
        if (event === 'child_added') {
          const val = getAt(parts);
          if (val && typeof val === 'object') {
            Object.keys(val).forEach(k => cb(makeSnapshot([...parts, k])));
          }
        }
        return cb;
      },
      off() {
        delete listeners[pathStr(parts)];
      },

      // Simula la semántica real: updateFn puede correr más de una
      // vez si hay contención, y siempre ve el valor MÁS RECIENTE.
      transaction(updateFn) {
        const current = getAt(parts);
        const result = updateFn(current === undefined ? null : deepClone(current));
        if (result === undefined) {
          return Promise.resolve({ committed: false, snapshot: makeSnapshot(parts) });
        }
        setAt(parts, deepClone(result));
        fireListeners(parts, 'update');
        return Promise.resolve({ committed: true, snapshot: makeSnapshot(parts) });
      },
    };
  }

  const fakeDb = { ref: p => makeRef(p ? String(p).split('/').filter(Boolean) : []) };

  let authUidCounter = 0;
  const registeredEmails = new Set();

  function makeAuthFor() {
    return {
      onAuthStateChanged() {},
      Auth: { Persistence: { LOCAL: 'local', SESSION: 'session' } },
      setPersistence() { return Promise.resolve(); },
      createUserWithEmailAndPassword(email, _password) {
        const normalized = String(email).trim().toLowerCase();
        if (registeredEmails.has(normalized)) {
          const err = new Error('The email address is already in use by another account.');
          err.code = 'auth/email-already-in-use';
          return Promise.reject(err);
        }
        registeredEmails.add(normalized);
        authUidCounter += 1;
        const uid = 'fake-uid-' + authUidCounter;
        return Promise.resolve({ user: { uid, email: normalized } });
      },
      signOut() { return Promise.resolve(); },
    };
  }

  const fakeFirebase = {
    initializeApp(_config, _name) {
      // Cada llamada con un "name" (app secundaria) recibe su propia
      // instancia de auth aislada, tal como en Firebase real — pero
      // comparten el mismo mapa de correos registrados y el mismo
      // contador de UIDs, para simular que es el mismo proyecto real.
      return { auth: makeAuthFor, delete: () => Promise.resolve() };
    },
    database() { return fakeDb; },
    auth: makeAuthFor,
    _store: store,        // acceso directo para armar los "datos previos" de cada prueba
    _reset() { for (const k of Object.keys(store)) delete store[k]; for (const k of Object.keys(listeners)) delete listeners[k]; registeredEmails.clear(); authUidCounter = 0; },
  };

  return fakeFirebase;
}

module.exports = { createFakeFirebase };
