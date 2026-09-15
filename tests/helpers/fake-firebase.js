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

  // Imita firebase.database.ServerValue.TIMESTAMP: en el SDK real es un
  // valor centinela que el SERVIDOR resuelve al milisegundo exacto de
  // escritura. Acá se resuelve del lado del cliente (Date.now()) en el
  // momento de guardar, que para las pruebas es equivalente.
  function resolveServerValues(v) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return Date.now();
      if (Array.isArray(v)) return v.map(resolveServerValues);
      const out = {};
      Object.keys(v).forEach(k => { out[k] = resolveServerValues(v[k]); });
      return out;
    }
    return v;
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
  const queryListeners = []; // { id, parts, field, startAtVal, endBeforeVal, event, cb, seen: Set }
  let queryIdCounter = 0;

  function pathStr(parts) { return parts.join('/'); }

  function fieldVal(childVal, field) {
    return childVal && typeof childVal === 'object' ? childVal[field] : undefined;
  }

  function matchesQuery(childVal, field, startAtVal, endBeforeVal) {
    const v = fieldVal(childVal, field);
    if (v === undefined) return false;
    if (startAtVal !== undefined && !(v >= startAtVal)) return false;
    if (endBeforeVal !== undefined && !(v < endBeforeVal)) return false;
    return true;
  }

  // Notifica listeners de "query" (orderByChild().startAt()/...) cuando
  // cambia un hijo directo del path que la query está observando. Imita
  // la semántica real: la PRIMERA vez que un hijo entra en el resultado
  // de la query dispara 'child_added'; los cambios posteriores mientras
  // sigue matcheando disparan 'child_changed'.
  function fireQueryListeners(parts) {
    if (parts.length === 0) return;
    const parentParts = parts.slice(0, -1);
    const childKey = parts[parts.length - 1];
    const parentKey = pathStr(parentParts);
    const childVal = getAt(parts);

    queryListeners.forEach(q => {
      if (pathStr(q.parts) !== parentKey) return;
      const isMatch = matchesQuery(childVal, q.field, q.startAtVal, q.endBeforeVal);
      const wasSeen = q.seen.has(childKey);
      if (isMatch && !wasSeen) {
        q.seen.add(childKey);
        if (q.event === 'child_added') q.cb(makeSnapshot(parts));
      } else if (isMatch && wasSeen) {
        if (q.event === 'child_changed') q.cb(makeSnapshot(parts));
      } else if (!isMatch && wasSeen) {
        q.seen.delete(childKey);
      }
    });
  }

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
    fireQueryListeners(parts);
  }

  function sortAndLimit(entries, field, limitToLastN) {
    // entries: [[key, val], ...]
    entries.sort((a, b) => {
      const av = fieldVal(a[1], field), bv = fieldVal(b[1], field);
      return (av > bv) - (av < bv);
    });
    if (limitToLastN !== undefined) return entries.slice(-limitToLastN);
    return entries;
  }

  function makeQuery(parts, field, startAtVal, endBeforeVal, limitToLastN) {
    return {
      orderByChild(f) { return makeQuery(parts, f, startAtVal, endBeforeVal, limitToLastN); },
      startAt(v) { return makeQuery(parts, field, v, endBeforeVal, limitToLastN); },
      endBefore(v) { return makeQuery(parts, field, startAtVal, v, limitToLastN); },
      limitToLast(n) { return makeQuery(parts, field, startAtVal, endBeforeVal, n); },

      once() {
        const val = getAt(parts);
        let entries = [];
        if (val && typeof val === 'object') {
          entries = Object.keys(val)
            .map(k => [k, val[k]])
            .filter(([, v]) => matchesQuery(v, field, startAtVal, endBeforeVal));
        }
        entries = sortAndLimit(entries, field, limitToLastN);
        const result = {};
        entries.forEach(([k, v]) => { result[k] = v; });
        return Promise.resolve({
          val: () => deepClone(result),
          exists: () => entries.length > 0,
          forEach: cb => entries.forEach(([k]) => cb(makeSnapshot([...parts, k]))),
          key: parts[parts.length - 1] ?? null,
        });
      },

      on(event, cb) {
        const id = ++queryIdCounter;
        const seen = new Set();
        // Estado inicial: dispara child_added para lo que YA matchea,
        // igual que Firebase real al conectar una query por primera vez.
        if (event === 'child_added' || event === 'child_changed') {
          const val = getAt(parts);
          if (val && typeof val === 'object') {
            Object.keys(val).forEach(k => {
              if (matchesQuery(val[k], field, startAtVal, endBeforeVal)) {
                seen.add(k);
                if (event === 'child_added') cb(makeSnapshot([...parts, k]));
              }
            });
          }
        }
        queryListeners.push({ id, parts, field, startAtVal, endBeforeVal, event, cb, seen });
        return cb;
      },

      off() {
        for (let i = queryListeners.length - 1; i >= 0; i--) {
          if (pathStr(queryListeners[i].parts) === pathStr(parts)) queryListeners.splice(i, 1);
        }
      },
    };
  }

  let pushCounter = 0;

  function makeRef(parts) {
    return {
      key: parts[parts.length - 1] ?? null,
      child(key) { return makeRef([...parts, ...String(key).split('/')]); },
      orderByChild(field) { return makeQuery(parts, field); },

      push() {
        pushCounter += 1;
        const id = '-fake' + String(pushCounter).padStart(8, '0');
        return makeRef([...parts, id]);
      },

      set(value) {
        setAt(parts, resolveServerValues(deepClone(value)));
        fireListeners(parts, 'set');
        return Promise.resolve();
      },

      update(value) {
        const current = getAt(parts);
        const merged = { ...(current && typeof current === 'object' ? current : {}), ...resolveServerValues(deepClone(value)) };
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
        setAt(parts, resolveServerValues(deepClone(result)));
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

  function databaseFn() { return fakeDb; }
  // firebase.database.ServerValue.TIMESTAMP: sentinela que resolveServerValues()
  // reconoce y convierte en Date.now() al momento de escribir (ver más arriba).
  databaseFn.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };

  const fakeFirebase = {
    initializeApp(_config, _name) {
      // Cada llamada con un "name" (app secundaria) recibe su propia
      // instancia de auth aislada, tal como en Firebase real — pero
      // comparten el mismo mapa de correos registrados y el mismo
      // contador de UIDs, para simular que es el mismo proyecto real.
      return { auth: makeAuthFor, delete: () => Promise.resolve() };
    },
    database: databaseFn,
    auth: makeAuthFor,
    _store: store,        // acceso directo para armar los "datos previos" de cada prueba
    _reset() { for (const k of Object.keys(store)) delete store[k]; for (const k of Object.keys(listeners)) delete listeners[k]; queryListeners.length = 0; registeredEmails.clear(); authUidCounter = 0; },
  };

  return fakeFirebase;
}

module.exports = { createFakeFirebase };
