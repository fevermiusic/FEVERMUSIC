// =========================================================
// Musical Fever — Historial Logic
// Filtros, scroll infinito, Firebase, auto-limpieza 30 días
// =========================================================

// ── Estado global ──────────────────────────────────────
let ordersCache    = [];
let filteredOrders = [];
let displayedCount = 0;
const BATCH_SIZE   = 15;

// ── Paginación ───────────────────────────────────────────
// Se muestran PAGE_SIZE notas (15) y, al bajar hasta el final, se
// piden las 15 siguientes — así sucesivamente. Esto NO tiene
// relación con los 30 días: ese es un límite de retención que se
// aplica de forma completamente aparte, nota por nota, en el script
// diario scripts/limpiar-historial.js (vía GitHub Actions). Aquí
// simplemente se pagina lo que exista en /orders en ese momento.
// OJO: debe coincidir siempre con HISTORIAL_PAGE_SIZE en firebase.js,
// porque ese es el número real que se pide a Firebase por página.
const PAGE_SIZE = 15;

let historialLoadedOnce = false; // ya se pidió la primera página en esta sesión
let oldestLoadedTs      = 0;     // timestamp del pedido más antiguo ya cargado
let reachedEnd          = false; // ya no hay pedidos más antiguos para pedir
let isFetchingPage      = false; // evita pedir la misma página dos veces

// ── Tiempo real: notas nuevas aparecen al toque ─────────
// Se activa UNA vez, apenas abre la app (igual que watchProducts/
// watchClients en Stock y Pedidos) — no cuando se visita Historial.
// Así, si creas una nota en Nueva Nota y ya estabas parado en
// Historial (o entras después), la nota aparece sola, sin recargar
// la página. Es un socket muy barato: solo dispara para pedidos
// creados de ahora en adelante, no repite nada del historial viejo.
authReady.then(() => {
  watchNewOrders(Date.now(), order => {
    const yaExiste = ordersCache.some(o => o.id === order.id);
    if (yaExiste) return; // evita duplicar si ya llegó por la paginación normal
    ordersCache.unshift(order); // es la más nueva, va primero
    applyFilters(); // no hace nada si Historial no está montado ahora mismo
  });

  // Actualiza en el acto una nota que ya estaba en caché cuando se
  // edita (desde esta misma sesión o desde cualquier otra) — esto es
  // lo que hace que el monto/ítems se vean correctos sin tener que
  // recargar la página varias veces.
  watchOrderChanges(order => {
    const idx = ordersCache.findIndex(o => o.id === order.id);
    if (idx === -1) return; // no está en memoria (aún no se ha paginado hasta ahí)
    ordersCache[idx] = order;
    applyFilters();
  });

  // Si otra sesión elimina una nota que ya teníamos en caché, se
  // quita de acá también para no seguir contándola en Total/Ingresos.
  watchOrderRemovals(orderId => {
    const idx = ordersCache.findIndex(o => o.id === orderId);
    if (idx === -1) return;
    ordersCache.splice(idx, 1);
    applyFilters();
  });
});

// ── Auto-limpieza: elimina pedidos vencidos (safety-net del cliente) ──
// Retención de producción: 30 días. Debe coincidir con RETENCION_MS
// de scripts/limpiar-historial.js.
function autoCleanOldOrders(orders) {
  // Cada página que se trae de Firebase ya viene tal cual está en
  // /orders (sin filtro de fecha en la consulta), así que este
  // safety-net sí puede encontrar pedidos vencidos que el script
  // diario aún no alcanzó a borrar. Los borra en segundo plano en
  // lotes de 5 para no saturar la red del dispositivo.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 días
  const stale  = orders.filter(o => (o.timestamp || 0) < cutoff);
  if (stale.length === 0) return;

  // Diferir 3 segundos para que la UI ya esté pintada
  setTimeout(() => {
    const batch = stale.splice(0, 5);
    batch.forEach(o => { refOrders.child(o.id).remove().catch(() => {}); });
  }, 3000);

  const msg = document.getElementById('cleanupToast');
  if (msg) {
    msg.textContent = `🧹 ${stale.length} registro${stale.length > 1 ? 's' : ''} antiguo${stale.length > 1 ? 's' : ''} eliminado${stale.length > 1 ? 's' : ''} automáticamente`;
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 4000);
  }
}

// ── Normalizar texto: quita tildes y pasa a minúsculas ─
function normalize(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ── Convierte un timestamp a "YYYY-MM-DD" en hora LOCAL ──
// o.fecha se guarda como texto local tipo "26 jun. 26" (no es
// parseable de forma confiable), así que para el filtro de
// rango se usa o.timestamp, leyendo año/mes/día en hora local
// (igual que interpreta el navegador los <input type="date">).
function timestampToYmd(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Inverso de timestampToYmd: convierte "YYYY-MM-DD" a timestamp en
// hora LOCAL. endOfDay=true da el último milisegundo de ese día
// (para usarlo como límite superior de un rango "hasta").
function ymdToTimestamp(ymd, endOfDay) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  return endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
    : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

// ── Limita el buscador a 11 dígitos SOLO si es numérico ──
// Si el usuario escribe letras (nombre de cliente o nota), no
// se aplica ningún límite y el texto se extiende con normalidad.
function limitSearchInput(input) {
  const val = input.value;
  if (/^\d+$/.test(val) && val.length > 11) {
    input.value = val.slice(0, 11);
  }
}

// ── Muestra/oculta el placeholder "dd/mm/aaaa" de un input fecha ──
// Se le agrega/quita la clase 'has-value' según tenga o no fecha,
// y el CSS oculta el <span> superpuesto cuando hay valor.
function toggleDatePlaceholder(input) {
  input.classList.toggle('has-value', !!input.value);
}

// ── Helper: fecha local -> "YYYY-MM-DD" (para <input type="date">) ──
function dateToInputValue(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── Abrir/cerrar el menú de filtro rápido por fecha ──────
function toggleQuickRange(e) {
  e.stopPropagation();
  document.getElementById('quickRangeMenu').classList.toggle('open');
}

// ── Abrir/cerrar el panel plegable de "más filtros" en móvil
// (Desde, Hasta, filtro rápido, Limpiar, Seleccionar, Exportar).
// En escritorio el panel ya está siempre visible por CSS, así que
// esta función solo tiene efecto visual por debajo de 768px.
function toggleFilterExtra() {
  const extra = document.getElementById('filterExtra');
  const btn   = document.getElementById('filterToggleBtn');
  if (!extra || !btn) return;
  const isOpen = extra.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

// Cierra el menú si se hace click en cualquier otro lugar de la página
document.addEventListener('click', e => {
  const menu = document.getElementById('quickRangeMenu');
  const btn  = document.getElementById('quickRangeBtn');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target) && e.target !== btn) {
    menu.classList.remove('open');
  }
});

// ── Aplica un rango rápido (hoy / semana / quincena / mes) ──
// Calcula desde/hasta en base a la fecha actual y rellena los
// campos del filtro, manteniendo el día de hoy como límite superior.
function applyQuickRange(tipo) {
  const hoy = new Date();
  let desde = new Date(hoy);

  if (tipo === 'hoy') {
    // desde = hasta = hoy
  } else if (tipo === 'semana') {
    desde.setDate(hoy.getDate() - 6);
  } else if (tipo === 'quincena') {
    desde.setDate(hoy.getDate() - 14);
  } else if (tipo === 'mes') {
    desde.setDate(hoy.getDate() - 29);
  }

  const desdeInput = document.getElementById('filterDesde');
  const hastaInput = document.getElementById('filterHasta');
  desdeInput.value = dateToInputValue(desde);
  hastaInput.value  = dateToInputValue(hoy);
  toggleDatePlaceholder(desdeInput);
  toggleDatePlaceholder(hastaInput);

  document.getElementById('quickRangeMenu').classList.remove('open');
  applyFilters();
}

// ── Predicado de filtro (buscador + rango de fechas) ────
// Se usa tanto para filtrar todo lo ya cargado como para decidir,
// al llegar una página nueva del servidor, si esos pedidos entran
// en lo que el usuario está buscando ahora mismo.
function orderMatchesFilters(o, rawQ, q, isRuc, desde, hasta, vendedorUid) {
  if (q) {
    if (isRuc) {
      const rucSlice = rawQ.slice(0, 11);
      if (!(o.ruc || '').includes(rucSlice)) return false;
    } else {
      const matchClient = normalize(o.cliente || '').includes(q);
      const matchNota    = normalize(o.numero || '').includes(q);
      if (!matchClient && !matchNota) return false;
    }
  }

  if (desde || hasta) {
    const ymd = timestampToYmd(o.timestamp);
    if (!ymd) return false;
    if (desde && ymd < desde) return false;
    if (hasta && ymd > hasta) return false;
  }

  if (vendedorUid) {
    if (!o.creadoPor || o.creadoPor.uid !== vendedorUid) return false;
  }

  return true;
}

// ── Aplicar filtros ─────────────────────────────────────
// ── Llena el <select> de Vendedor con los nombres que aparecen en
//    las notas ya cargadas (no depende de /users, así que funciona
//    igual para admin y vendedor). Se llama en cada applyFilters()
//    porque ordersCache va creciendo con el scroll infinito — así,
//    si aparece un vendedor nuevo al cargar más notas, entra a la
//    lista sin que el usuario tenga que recargar la página. Conserva
//    la opción ya seleccionada aunque se vuelva a armar la lista.
function updateVendedorFilterOptions() {
  const sel = document.getElementById('filterVendedor');
  if (!sel) return;
  if (currentUserRole === 'vendedor') return; // oculto y forzado a su propio uid, no hace falta poblarlo

  const vendedores = new Map(); // uid -> nombre
  ordersCache.forEach(o => {
    if (o.creadoPor && o.creadoPor.uid) vendedores.set(o.creadoPor.uid, o.creadoPor.nombre || 'Sin nombre');
  });

  const currentValue = sel.value;
  const nuevasOpciones = ['<option value="">Todos (general)</option>']
    .concat(
      Array.from(vendedores.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([uid, nombre]) => `<option value="${escapeHtml(uid)}">${escapeHtml(nombre)}</option>`)
    )
    .join('');

  if (sel.innerHTML !== nuevasOpciones) {
    sel.innerHTML = nuevasOpciones;
    // Si el vendedor que estaba seleccionado sigue en la lista nueva, se
    // conserva; si no (ej. todavía no se cargó ninguna nota suya), se
    // deja el valor tal cual el navegador lo intente restaurar.
    if (Array.from(sel.options).some(opt => opt.value === currentValue)) {
      sel.value = currentValue;
    }
  }
}

function applyFilters() {
  const searchEl = document.getElementById('searchInput');
  if (!searchEl) return; // la vista de Historial no está montada ahora mismo
  const rawQ   = (document.getElementById('searchInput').value || '').trim();
  const desde  = document.getElementById('filterDesde').value;
  const hasta  = document.getElementById('filterHasta').value;
  const vendedorSel = document.getElementById('filterVendedor');
  // ── Rol "vendedor": SIEMPRE se fuerza su propio uid, sin importar
  // qué tenga el <select> (que además está oculto para este rol, ver
  // applyHistorialRoleRestrictions). Antes el filtro por vendedor era
  // 100% opcional, así que un vendedor podía ver en su propio
  // Historial las notas hechas por CUALQUIER otro vendedor — esto
  // cierra ese hueco: un vendedor jamás ve ventas ajenas, solo admin.
  const vendedorUid = (currentUserRole === 'vendedor')
    ? currentUserUid
    : (vendedorSel ? vendedorSel.value : '');

  updateVendedorFilterOptions();

  const q = normalize(rawQ);
  const isRuc = /^\d+$/.test(rawQ);

  // Si el usuario pide un rango "Desde" más antiguo que lo que ya
  // está cargado en memoria (la paginación todavía no bajó tanto),
  // se pide puntualmente ese tramo faltante antes de filtrar, para
  // que la búsqueda por fecha siempre sea exacta aunque el usuario
  // nunca haya hecho scroll hasta ahí. No tiene relación con los 30
  // días de retención (eso lo maneja el script de limpieza aparte).
  const desdeTs = ymdToTimestamp(desde, false);
  if (desdeTs && !reachedEnd && desdeTs < oldestLoadedTs && !isFetchingPage) {
    isFetchingPage = true;
    fetchOrdersPage(desdeTs, oldestLoadedTs - 1).then(list => {
      autoCleanOldOrders(list);
      mergeIntoCache(list);
      oldestLoadedTs = ordersCache.length
        ? ordersCache[ordersCache.length - 1].timestamp || 0
        : oldestLoadedTs;
      isFetchingPage = false;
      applyFilters();
    });
    return; // se vuelve a llamar applyFilters() cuando llegue esa página
  }

  filteredOrders = ordersCache.filter(o => orderMatchesFilters(o, rawQ, q, isRuc, desde, hasta, vendedorUid));

  displayedCount = 0;
  renderBatch();
  updateHistStats();

  // ── Buscador: expande la paginación en segundo plano ──────────
  // Firebase no tiene índice de texto sobre cliente/nota/RUC, así que
  // no hay forma de pedirle al servidor "dame los que coincidan con
  // esto" en una sola consulta. Las dos alternativas malas serían:
  // (a) traer TODO /orders de un solo golpe para buscar en memoria
  //     (el mismo problema de bandwidth que generateNextOrderNumber),
  //     o (b) limitar la búsqueda solo a lo que el usuario ya
  //     scrolleó a mano, devolviendo "sin resultados" para una nota
  //     de la semana pasada que nunca cargó.
  // Este es el punto medio: si hay texto escrito y lo que ya está en
  // memoria no tiene coincidencias, se sigue pidiendo la SIGUIENTE
  // página (15 en 15, la misma función que usa el scroll infinito)
  // hasta encontrar algo o llegar al final de los 30 días de
  // retención — nunca una sola consulta gigante, y la búsqueda sí
  // llega a cubrir toda la base disponible.
  if (rawQ && filteredOrders.length === 0 && !reachedEnd && !isFetchingPage) {
    fetchNextPage();
  }
}

// ── Renderizar lote ─────────────────────────────────────
function renderBatch() {
  const body = document.getElementById('histBody');
  if (!body) return; // la vista de Historial no está montada ahora mismo
  if (displayedCount === 0) body.innerHTML = '';

  const slice = filteredOrders.slice(displayedCount, displayedCount + BATCH_SIZE);
  displayedCount += slice.length;

  body.insertAdjacentHTML('beforeend', slice.map(o => {
    const escapedId = escapeJsAttr(o.id || '');
    const editBadge = renderEditBadge(o.editCount);
    return `
      <tr data-id="${escapeHtml(o.id)}">
        <td class="col-check"><input type="checkbox" class="row-checkbox hist-check" data-id="${escapeHtml(o.id)}" onchange="onHistCheckToggle(this)"></td>
        <td data-label="N° Nota"><span class="nota-num">${escapeHtml(o.numero)}</span></td>
        <td data-label="Cliente"><div class="client-hist">${escapeHtml(o.cliente)}</div><div class="ruc-hist">${escapeHtml(o.ruc)}</div></td>
        <td class="col-vendedor" data-label="Vendedor">${vendorBadge(o.creadoPor && o.creadoPor.nombre)}</td>
        <td data-label="Fecha"><span class="date-hist">${escapeHtml(o.fecha)}<br><span style="font-size:10.5px;color:var(--text-3)">${escapeHtml(o.hora)}</span></span></td>
        <td data-label="Total"><span class="total-hist">S/ ${fmtHist(o.total)}</span></td>
        <td data-label=""><div style="display:flex;justify-content:flex-end;align-items:center;gap:6px">
          ${editBadge}
          <button class="btn btn-ghost" style="height:28px;font-size:11.5px;padding:0 9px" onclick="verNota('${escapedId}')">Ver</button>
        </div></td>
        <td class="hist-card-mobile">
          <div class="hist-card-top">
            <span class="hist-card-num">${escapeHtml(o.numero)}</span>
            <span class="hist-card-total">S/ ${fmtHist(o.total)}</span>
          </div>
          <div class="hist-card-client">${escapeHtml(o.cliente)}</div>
          <div class="hist-card-ruc">RUC: ${escapeHtml(o.ruc)}</div>
          ${o.creadoPor && o.creadoPor.nombre ? `<div style="margin-bottom:11px">${vendorBadge(o.creadoPor.nombre)}</div>` : ''}
          <div class="hist-card-bottom">
            <span class="hist-card-date">${escapeHtml(o.fecha)}</span>
            <div style="display:flex;align-items:center;gap:6px">
              ${editBadge}
              <button class="btn hist-card-btn" onclick="verNota('${escapedId}')">Ver detalle</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join(''));

  const newRows = Array.from(body.querySelectorAll('tr[data-id]')).slice(-slice.length);
  newRows.forEach(row => wireSelectableRow(row, histSelection, onHistCheckToggle));

  const empty  = document.getElementById('emptyState');
  const footer = document.getElementById('footerInfo');
  if (empty)  empty.style.display = filteredOrders.length === 0 ? 'block' : 'none';
  if (footer) footer.textContent  = `${filteredOrders.length} nota${filteredOrders.length !== 1 ? 's' : ''}`;
}

// ── Scroll infinito ─────────────────────────────────────
// 1) Si ya hay más pedidos cargados en memoria pero sin pintar
//    (pasó del filtro pero no se mostró aún), simplemente se pinta
//    el siguiente lote — sin tocar la red.
// 2) Si ya se pintó todo lo que hay en memoria y todavía quedan
//    días más antiguos dentro de los 30 días, recién ahí se pide la
//    siguiente página al servidor. Así, alguien que solo mira los
//    pedidos de esta semana nunca descarga el resto del historial.
function onScroll() {
  const s = document.documentElement;
  const nearBottom = s.scrollTop + window.innerHeight >= s.scrollHeight - 200;
  if (!nearBottom) return;

  if (displayedCount < filteredOrders.length) {
    renderBatch();
    return;
  }
  fetchNextPage();
}
window.addEventListener('scroll', onScroll, { passive: true });

// ── Estadísticas ────────────────────────────────────────
function updateHistStats() {
  const total   = filteredOrders.length;
  const clientes = new Set(filteredOrders.map(o => o.ruc)).size;
  const revenue  = Math.round(filteredOrders.reduce((s, o) => s + (o.total || 0), 0) * 100) / 100;
  const el = n => document.getElementById(n);
  if (el('statTotalNotas')) el('statTotalNotas').textContent = total;
  if (el('statClientes'))   el('statClientes').textContent   = clientes;
  if (el('statRevenue'))    el('statRevenue').textContent    = 'S/ ' + fmtHist(revenue);
}

// Agrega pedidos nuevos al caché sin duplicar (por si un pedido
// cae justo en el límite entre dos páginas) y mantiene el orden
// del más nuevo al más antiguo.
function mergeIntoCache(list) {
  const seen = new Set(ordersCache.map(o => o.id));
  list.forEach(o => { if (!seen.has(o.id)) ordersCache.push(o); });
  ordersCache.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

// ── Suscripción Firebase — paginada por cantidad ────────
// Antes: se traía de un solo golpe TODOS los pedidos de los
// últimos 30 días — con 15 vendedores entrando y saliendo de
// Historial varias veces al día, esto era el mayor consumidor de
// ancho de banda de toda la app.
//
// Ahora: la primera visita en la sesión solo trae los PAGE_SIZE
// (15) pedidos más recientes. Si el usuario navega fuera de
// Historial y vuelve, se reutiliza lo que ya está en memoria (sin
// pedir nada de nuevo). Solo se piden los siguientes 15 cuando el
// usuario realmente hace scroll hasta el final de la lista (ver
// onScroll/fetchNextPage). Esto es independiente de los 30 días de
// retención, que se manejan aparte en scripts/limpiar-historial.js.
function loadHistorialData() {
  if (historialLoadedOnce) {
    applyFilters();
    return;
  }
  // OJO: no se resetea ordersCache a [] acá — el listener de
  // watchNewOrders puede haber agregado alguna nota nueva mientras
  // el usuario todavía no entraba a Historial, y no queremos perderla.
  reachedEnd     = false;
  isFetchingPage = true;

  fetchOrdersFirstPage().then(list => {
    autoCleanOldOrders(list);
    mergeIntoCache(list); // combina con lo que ya hubiera (dedupe por id) y ordena
    oldestLoadedTs = ordersCache.length ? (ordersCache[ordersCache.length - 1].timestamp || 0) : 0;
    reachedEnd = list.length < PAGE_SIZE;
    isFetchingPage = false;
    historialLoadedOnce = true;
    applyFilters();
  }).catch(() => { isFetchingPage = false; });
}

// Trae los PAGE_SIZE (15) pedidos inmediatamente más antiguos que
// lo que ya está cargado.
function fetchNextPage() {
  if (isFetchingPage || reachedEnd) return Promise.resolve();
  isFetchingPage = true;

  const footer = document.getElementById('footerInfo');
  const prevFooterText = footer ? footer.textContent : '';
  if (footer) footer.textContent = 'Cargando más notas...';

  return fetchOrdersBefore(oldestLoadedTs).then(list => {
    autoCleanOldOrders(list);
    mergeIntoCache(list);
    oldestLoadedTs = ordersCache.length ? (ordersCache[ordersCache.length - 1].timestamp || 0) : oldestLoadedTs;
    reachedEnd = list.length < PAGE_SIZE;
    isFetchingPage = false;
    applyFilters(); // vuelve a filtrar/pintar incluyendo lo recién llegado
  }).catch(() => {
    isFetchingPage = false;
    if (footer) footer.textContent = prevFooterText;
  });
}

// ── Restricciones de rol "vendedor" ─────────────────────
// Historial no tenía ninguna restricción de rol (a diferencia de
// Stock y Pedidos): el botón "Seleccionar", la barra de selección
// masiva y la columna de checkboxes quedaban visibles también para
// vendedor, aunque esa acción es exclusiva de administración.
function applyHistorialRoleRestrictions() {
  if (currentUserRole !== 'vendedor') return;

  const btnSelect = document.getElementById('btnSelectMode');
  if (btnSelect) btnSelect.style.display = 'none';

  const bulkBar = document.getElementById('bulkBarHist');
  if (bulkBar) bulkBar.style.display = 'none';

  // "Editar" y "Eliminar" en el detalle de la nota están disponibles
  // tanto para admin como para vendedor.

  // El filtro "Vendedor" no tiene sentido para este rol: su Historial
  // ya está forzado (en applyFilters) a mostrar solo SUS propias
  // notas, así que el <select> y su label se ocultan por completo en
  // vez de dejarlo visible sin efecto real.
  const vendedorSel = document.getElementById('filterVendedor');
  if (vendedorSel) {
    const wrap = vendedorSel.closest('.filter-group') || vendedorSel.parentElement;
    if (wrap) wrap.style.display = 'none';
  }

  // La columna de checkbox se genera en cada fila dentro de
  // renderBatch(), así que en vez de tocar ese HTML se oculta por
  // CSS (header y celdas comparten la clase "col-check"). Ídem la
  // columna "Vendedor": para este rol siempre es su propio nombre
  // repetido en cada fila, así que no aporta información y solo
  // ocupa espacio — se oculta también por CSS (header y celdas
  // comparten la clase "col-vendedor").
  if (!document.getElementById('historialRoleStyle')) {
    const style = document.createElement('style');
    style.id = 'historialRoleStyle';
    style.textContent = '.table-wrap .col-check { display: none !important; } '
      + '.table-wrap .col-vendedor { display: none !important; }';
    document.head.appendChild(style);
  }
}

// ── Punto de entrada que llama el Router cada vez que se
//    muestra esta vista ──
window.Historial = {
  init() {
    loadHistorialData();
    applyHistorialRoleRestrictions();
  }
};

// ── Limpiar filtros ─────────────────────────────────────
function clearFilters() {
  document.getElementById('searchInput').value = '';
  const desde = document.getElementById('filterDesde');
  const hasta = document.getElementById('filterHasta');
  const vendedorSel = document.getElementById('filterVendedor');
  desde.value = '';
  hasta.value = '';
  if (vendedorSel) vendedorSel.value = '';
  toggleDatePlaceholder(desde);
  toggleDatePlaceholder(hasta);
  applyFilters();
}

// ── Helper formato número ───────────────────────────────
function fmtHist(n) {
  return (n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Color por vendedor ──────────────────────────────────
// Le asigna a cada nombre de vendedor SIEMPRE el mismo color (un
// hash simple del texto elige una posición fija en la paleta), así
// se puede reconocer de un vistazo quién hizo cada nota sin tener
// que leer el nombre completo cada vez.
const VENDOR_COLOR_PALETTE = [
  { bg: '#DBEAFE', fg: '#1E40AF' }, // azul
  { bg: '#DCFCE7', fg: '#166534' }, // verde
  { bg: '#FEF3C7', fg: '#92400E' }, // ámbar
  { bg: '#FCE7F3', fg: '#9D174D' }, // rosa
  { bg: '#EDE9FE', fg: '#5B21B6' }, // violeta
  { bg: '#CFFAFE', fg: '#155E75' }, // cian
  { bg: '#FFEDD5', fg: '#9A3412' }, // naranja
  { bg: '#E0E7FF', fg: '#3730A3' }, // índigo
];
function vendorColor(nombre) {
  const str = String(nombre || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return VENDOR_COLOR_PALETTE[hash % VENDOR_COLOR_PALETTE.length];
}
function vendorBadge(nombre) {
  if (!nombre) return '<span class="date-hist">—</span>';
  const c = vendorColor(nombre);
  return `<span style="display:inline-block;padding:3px 9px;border-radius:20px;font-size:11.5px;font-weight:600;background:${c.bg};color:${c.fg}">${escapeHtml(nombre)}</span>`;
}

// ── Badge de nota editada ────────────────────────────────
// Verde: editada 1 vez. Amarillo: 2 veces. Rojo: 3 o más veces.
// No se muestra nada si la nota nunca fue editada.
function renderEditBadge(editCount) {
  const n = editCount || 0;
  if (n <= 0) return '';
  let color, bg;
  if (n === 1)      { color = '#059669'; bg = '#D1FAE5'; } // verde
  else if (n === 2) { color = '#B45309'; bg = '#FEF3C7'; } // amarillo
  else              { color = '#DC2626'; bg = '#FEE2E2'; } // rojo
  return `<span class="edit-badge" title="Editada ${n} ${n === 1 ? 'vez' : 'veces'}" `
    + `style="display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;`
    + `padding:0 5px;border-radius:999px;font-size:10.5px;font-weight:700;`
    + `font-family:var(--font-mono, monospace);color:${color};background:${bg}">${n}</span>`;
}