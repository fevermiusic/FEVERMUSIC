// =========================================================
// Musical Fever — Nueva Nota · Lógica principal
// Estado, buscador de productos, tabla de artículos,
// totales y descuento
// =========================================================

// ── Estado ─────────────────────────────────────────────
let items       = [];
let discountPct = 0;
let clientRuc    = '';
let clientNombre = '';

// ── Estado de edición ──────────────────────────────────
// Cuando se llega desde "Editar" en Historial, estos valores se
// completan con los datos de la nota original. editingOriginalItems
// guarda una copia congelada de los ítems TAL COMO estaban antes de
// editar (independiente de `items`, que el usuario va modificando),
// para poder reconciliar el stock correctamente al guardar.
let editingOrderId      = null;
let editingOriginalItems = null;
let editingOriginalMeta  = null; // { fecha, hora } — se conservan al editar

// Catálogo — antes esta vista mantenía su PROPIA copia (PRODUCTS)
// con su propio watchProducts(), duplicando la misma conexión que
// ya mantiene Stock. En la SPA, Stock.js ya tiene productsCache
// siempre actualizado en vivo — se reusa directo, cero conexiones
// extra a Firebase.
let suggestionIndex    = -1;
let currentSuggestions = [];

// Igual que en Stock: el dropdown puede tener ~1000 productos si no
// se escribe nada (búsqueda vacía = todo el catálogo). Se pintan de
// a SUGGESTION_PAGE_SIZE y se cargan más al hacer scroll dentro del
// propio dropdown — la búsqueda sigue filtrando sobre TODO
// productsCache (ya en memoria), solo cambia cuánto se pinta.
const SUGGESTION_PAGE_SIZE = 20;
let suggestionRenderLimit  = SUGGESTION_PAGE_SIZE;
let suggestionScrollWired  = false;

// ── Punto de entrada que llama el Router cada vez que se
//   muestra esta vista. Antes leía ?ruc=...&nombre=... de la URL
//   real (cada nota era una navegación de página completa); ahora
//   el Router pasa esos mismos datos como parámetros directos.
window.NuevaNota = {
  init(params) {
    params = params || {};
    clientRuc    = params.ruc    || '';
    clientNombre = params.nombre || '';
    document.getElementById('displayRuc').textContent    = clientRuc    || '—';
    document.getElementById('displayNombre').textContent = clientNombre || 'Sin cliente asignado';

    const titleEl   = document.querySelector('.topbar-title h1');
    const confirmBtn = document.querySelector('[onclick="confirmOrder()"]');

    if (params.editOrderId) {
      // ── Modo edición: precargar la nota existente ──
      editingOrderId       = params.editOrderId;
      editingOriginalItems = (params.editItems || []).map(i => ({ code: i.code, qty: i.qty }));
      editingOriginalMeta  = { fecha: params.editFecha || '', hora: params.editHora || '' };

      // maxStock = stock real actual del producto + la cantidad que
      // ya tenía esta nota (porque esa cantidad se le devuelve al
      // stock al guardar, antes de descontar la nueva — ver
      // confirmOrder() en nueva-nota-actions.js). Sin esto, maxStock
      // quedaba undefined y la validación de "Stock máximo" en
      // changeQty()/setQty() nunca se disparaba (nada es mayor que
      // undefined), permitiendo pedir más cantidad de la disponible
      // sin avisar hasta que el guardado fallaba a medio camino.
      items = (params.editItems || []).map(i => {
        const live = productsCache.find(p => p.code === i.code);
        const liveStock = live ? live.stock : 0;
        return { ...i, subtotal: i.price * i.qty, maxStock: liveStock + i.qty };
      });
      discountPct = params.editDiscount || 0;
      const discInput = document.getElementById('discInput');
      if (discInput) discInput.value = discountPct > 0 ? discountPct : '';

      document.getElementById('notaNumber').textContent = params.editNumero || '';
      if (titleEl)    titleEl.textContent    = 'Editar Nota de Pedido';
      if (confirmBtn) confirmBtn.textContent = 'Guardar cambios';
    } else {
      // ── Modo normal: nota nueva ──
      editingOrderId       = null;
      editingOriginalItems = null;
      editingOriginalMeta  = null;

      items       = [];
      discountPct = 0;

      const year = new Date().getFullYear();
      const numEl = document.getElementById('notaNumber');
      // Se muestra un placeholder mientras se consulta Firebase para
      // saber cuál es el siguiente correlativo real de este año (ver
      // generateNextOrderNumber() en firebase.js) — antes esto era
      // instantáneo porque era un número al azar, pero al azar es
      // justamente el problema que se estaba corrigiendo.
      numEl.textContent = 'NP-' + year + '-…';
      generateNextOrderNumber(year).then(num => { numEl.textContent = num; })
        .catch(() => { /* si falla la lectura, se revalida igual antes de guardar en confirmOrder() */ });
      if (titleEl)    titleEl.textContent    = 'Nueva Nota de Pedido';
      if (confirmBtn) confirmBtn.textContent = 'Confirmar pedido';
    }

    renderItems();
    recalc();
    // La SPA recrea el HTML de esta vista (y con él, #productSuggestions)
    // cada vez que se entra a Nueva Nota. Sin este reseteo, el listener
    // de scroll del buscador de productos quedaba "conectado" solo la
    // primera vez de la sesión: la bandera seguía en true, así que el
    // scroll infinito nunca se volvía a conectar al nuevo elemento y
    // el buscador se quedaba pegado en "Cargando más al bajar…".
    suggestionScrollWired = false;
    wireProductSearchKeydown();
  }
};

// ── Sincronizar el carrito con el stock en tiempo real ──
// El stock disponible (productsCache) ya se actualiza en vivo en
// toda la app (ver stock.js/firebase.js). Pero antes, la cantidad
// MÁXIMA permitida para un producto ya agregado al carrito
// (item.maxStock) se calculaba una sola vez, al momento de
// agregarlo, y quedaba congelada — si alguien en otra sucursal
// vendía ese mismo producto mientras esta nota seguía abierta, el
// formulario seguía dejando subir la cantidad hasta un tope que ya
// no era real. No se llegaba a corromper ningún dato (el descuento
// de stock al confirmar es transaccional y rechaza si ya no alcanza),
// pero el usuario recién se enteraba al final, con la nota ya
// armada — nada aceptable para una empresa seria. Ahora se refresca
// en vivo cada vez que cambia el stock real.
window.onProductsCacheUpdated = function () {
  if (typeof items === 'undefined' || items.length === 0) return;
  if (!document.getElementById('prodBody')) return; // la vista de Nueva Nota no está montada ahora mismo

  let changed = false;
  items.forEach(item => {
    const live = productsCache.find(p => p.code === item.code);
    const liveStock = live ? live.stock : 0;
    // En modo edición, la cantidad que esta nota ya tenía originalmente
    // se le devuelve al stock recién al guardar (ver confirmOrder()),
    // así que el tope real disponible incluye esa cantidad "reservada".
    const reserved = editingOrderId && editingOriginalItems
      ? (editingOriginalItems.find(i => i.code === item.code)?.qty || 0)
      : 0;
    const newMax = liveStock + reserved;

    if (item.maxStock !== newMax) { item.maxStock = newMax; changed = true; }
    if (item.qty > newMax) {
      item.qty      = Math.max(newMax, 0);
      item.subtotal = round2(item.qty * item.price);
      changed = true;
      alert(`El stock de "${item.name}" cambió. Se ajustó la cantidad en el pedido a ${item.qty} (disponible ahora).`);
    }
  });

  if (changed) { renderItems(); recalc(); }
};

// ── Buscador inteligente de productos ──────────────────
function onProductSearchInput() {
  const rawValue = document.getElementById('productSearch').value;
  const q = rawValue.toLowerCase().trim();
  document.getElementById('selectedProductCode').value = '';
  document.getElementById('addPrice').value            = '';
  document.getElementById('stockHint').style.display   = 'none';
  toggleProductSearchClear(rawValue.length > 0);

  currentSuggestions = productsCache.filter(p => {
    const code = (p.code || '').toLowerCase();
    const name = (p.name || '').toLowerCase();
    return !q || name.includes(q) || code.includes(q);
  });
  suggestionIndex = -1;
  suggestionRenderLimit = SUGGESTION_PAGE_SIZE;
  renderSuggestions();
}

function renderSuggestions() {
  const box = document.getElementById('productSuggestions');
  if (!box) return; // la vista de Nueva Nota no está montada ahora mismo
  if (currentSuggestions.length === 0) {
    box.innerHTML = `<div class="suggestion-empty">No se encontraron productos.</div>`;
    box.style.display = 'block';
    return;
  }
  const page = currentSuggestions.slice(0, suggestionRenderLimit);
  box.innerHTML = page.map((p, i) => {
    const stockVal = p.stock !== undefined ? p.stock : 0;
    const stockClass  = stockVal > 6 ? 'stock-green' : 'stock-red';
    const highlighted = i === suggestionIndex ? 'highlighted' : '';
    const safePrice = fmt(p.price);
    const safeName = p.name || '';
    const safeCode = p.code || '';
    return `
      <div class="suggestion-item ${highlighted}" onmousedown="selectProduct('${escapeJsAttr(safeCode)}')">
        <div class="suggestion-main">
          <span class="suggestion-name">${escapeHtml(safeName)}</span>
          <span class="suggestion-code">${escapeHtml(safeCode)}</span>
        </div>
        <div class="suggestion-meta">
          <span class="suggestion-price">S/ ${safePrice}</span>
          <span class="suggestion-stock ${stockClass}">${stockVal} en stock</span>
        </div>
      </div>
    `;
  }).join('');
  if (currentSuggestions.length > page.length) {
    box.insertAdjacentHTML('beforeend', `<div class="suggestion-loading-more">Cargando más al bajar…</div>`);
  }
  box.style.display = 'block';

  // El listener de scroll se conecta una sola vez por elemento del
  // DOM (el <div id="productSuggestions"> vive fijo en la vista,
  // solo se reemplaza su innerHTML en cada búsqueda).
  if (!suggestionScrollWired) {
    suggestionScrollWired = true;
    box.addEventListener('scroll', () => {
      if (suggestionRenderLimit >= currentSuggestions.length) return;
      const nearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 60;
      if (nearBottom) {
        suggestionRenderLimit += SUGGESTION_PAGE_SIZE;
        renderSuggestions();
      }
    });
  }
}

function selectProduct(code) {
  const p = productsCache.find(x => x.code === code);
  if (!p) return;
  const safeName = p.name || '';
  const safeCode = p.code || '';
  const stockVal = p.stock !== undefined ? p.stock : 0;
  
  document.getElementById('productSearch').value       = `${safeName} (${safeCode})`;
  document.getElementById('selectedProductCode').value = safeCode;
  document.getElementById('addPrice').value            = p.price !== undefined ? p.price : 0;
  document.getElementById('productSuggestions').style.display = 'none';
  toggleProductSearchClear(true);

  const hint     = document.getElementById('stockHint');
  const hintText = document.getElementById('stockHintText');
  hint.style.display = 'flex';
  hint.className     = 'stock-hint';
  if (stockVal <= 0) {
    hint.classList.add('danger');
    hintText.textContent = 'Sin stock disponible';
  } else if (stockVal > 6) {
    hint.classList.add('ok');
    hintText.textContent = `${stockVal} unidades disponibles`;
  } else {
    hint.classList.add('danger');
    hintText.textContent = `Solo quedan ${stockVal} en stock`;
  }
}

function onProductSearchBlur() {
  // El timeout puede disparar después de que el usuario ya navegó a
  // otra vista (Pedidos, Historial, etc.), y la SPA reemplaza el HTML
  // de Nueva Nota por completo — #productSuggestions deja de existir.
  // Sin este chequeo, ese callback "huérfano" lanzaba un error al
  // intentar tocar .style de null.
  setTimeout(() => {
    const box = document.getElementById('productSuggestions');
    if (box) box.style.display = 'none';
  }, 100);
}

// Antes se conectaba directo al cargar el script — en la SPA eso
// truena, porque #productSearch no existe todavía hasta que esta
// vista se monta por primera vez. Ahora se conecta desde
// NuevaNota.init() cada vez que la vista aparece.
function wireProductSearchKeydown() {
  document.getElementById('productSearch').addEventListener('keydown', function(e) {
    const box = document.getElementById('productSuggestions');
    if (box.style.display === 'none' || currentSuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestionIndex = Math.min(suggestionIndex + 1, currentSuggestions.length - 1);
      if (suggestionIndex >= suggestionRenderLimit) suggestionRenderLimit += SUGGESTION_PAGE_SIZE;
      renderSuggestions();
      box.querySelector('.suggestion-item.highlighted')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionIndex = Math.max(suggestionIndex - 1, 0);
      renderSuggestions();
      box.querySelector('.suggestion-item.highlighted')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestionIndex >= 0 && currentSuggestions[suggestionIndex]) {
        selectProduct(currentSuggestions[suggestionIndex].code);
      }
    } else if (e.key === 'Escape') {
      box.style.display = 'none';
    }
  });
}

// ── Dinero: redondeo a centavos ─────────────────────────
// Antes subtotal/descuento/total se guardaban como el resultado
// crudo de multiplicaciones y restas en punto flotante (ej.
// 0.1 + 0.2 en JS da 0.30000000000000004). fmt() lo disimulaba
// en pantalla porque toLocaleString redondea para MOSTRAR, pero el
// número real que se guardaba en Firebase (y que se usa después para
// sumar ingresos en Historial, exportar a Excel/PDF, etc.) podía
// quedar con "basura" de punto flotante. Para una empresa real, el
// dinero nunca debe manejarse así: cada subtotal/total ahora se
// redondea a centavos apenas se calcula, no solo al mostrarlo.
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmt(value) {
  const num = Number(value);
  if (isNaN(num)) return "0.00";
  return num.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Agregar artículo ────────────────────────────────────
function addItem() {
  const code = document.getElementById('selectedProductCode').value;
  if (!code) return alert('Selecciona un producto de la lista de sugerencias.');
  const p = productsCache.find(x => x.code === code);
  if (!p)    return alert('Selecciona un producto de la lista de sugerencias.');

  const qty   = parseInt(document.getElementById('addQty').value)    || 1;
  const price = parseFloat(document.getElementById('addPrice').value) || 0;
  const stock = p.stock !== undefined ? p.stock : 0;

  if (qty > stock) return alert(`Stock insuficiente. Disponible: ${stock} unidades.`);

  const existing = items.find(i => i.code === code);
  if (existing) {
    if (existing.qty + qty > stock) {
      return alert(`Stock insuficiente. Ya tienes ${existing.qty} en el pedido. Disponible: ${stock}.`);
    }
    // Antes esto ignoraba en silencio el precio que la persona
    // acababa de escribir en el formulario y seguía usando el precio
    // de la primera vez que se agregó ese producto — si alguien
    // corregía el precio antes de sumar más unidades, esa corrección
    // se perdía sin ningún aviso. Ahora el precio se actualiza al que
    // se acaba de ingresar (aplica a todas las unidades del renglón).
    existing.qty  += qty;
    existing.price = price;
    existing.subtotal = round2(existing.qty * existing.price);
  } else {
    items.push({ code: p.code, name: p.name, price, qty, subtotal: round2(qty * price), maxStock: stock });
  }

  renderItems();
  recalc();
  document.getElementById('productSearch').value       = '';
  document.getElementById('selectedProductCode').value = '';
  document.getElementById('addQty').value              = 1;
  document.getElementById('addPrice').value            = '';
  document.getElementById('stockHint').style.display   = 'none';
  toggleProductSearchClear(false);
}

// ── Botón "limpiar" (X) del buscador de producto ────────
// Muestra u oculta el botón según si hay texto escrito/seleccionado.
function toggleProductSearchClear(show) {
  const btn = document.getElementById('productSearchClear');
  if (btn) btn.style.display = show ? 'flex' : 'none';
}

// Se dispara al tocar la X: por flojera de borrar letra por letra
// cuando el vendedor se equivocó de producto. Limpia el texto, el
// código seleccionado, el precio autocompletado y el hint de stock,
// y deja el cursor listo en el input para escribir de nuevo.
function clearProductSearch() {
  const input = document.getElementById('productSearch');
  input.value = '';
  document.getElementById('selectedProductCode').value = '';
  document.getElementById('addPrice').value            = '';
  document.getElementById('stockHint').style.display    = 'none';
  document.getElementById('productSuggestions').style.display = 'none';
  toggleProductSearchClear(false);
  input.focus();
}

// ── Renderizar tabla de artículos ───────────────────────
function renderItems() {
  const body  = document.getElementById('prodBody');
  const table = document.getElementById('prodTable');
  const empty = document.getElementById('emptyProducts');
  const count = document.getElementById('itemCount');
  if (!body || !table || !empty || !count) return; // la vista de Nueva Nota no está montada ahora mismo

  count.textContent = items.length;

  if (items.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  table.style.display = '';
  empty.style.display = 'none';

  body.innerHTML = items.map((item, idx) => `
    <tr data-idx="${idx}">
      <td data-label="Código"><span style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-3)">${escapeHtml(item.code)}</span></td>
      <td data-label="Producto"><div class="prod-name">${escapeHtml(item.name)}</div></td>
      <td class="right" data-label="P. Unit.">
        <div class="price-edit-wrap">
          <span class="price-edit-prefix">S/</span>
          <input class="price-input" id="priceInput-${idx}" type="number" value="${item.price}" min="0" step="0.01"
            onchange="setPrice(${idx},this.value)">
        </div>
      </td>
      <td style="text-align:center" data-label="Cantidad">
        <div class="qty-control" style="justify-content:center">
          <button class="qty-btn" onclick="changeQty(${idx},-1)">−</button>
          <input class="qty-input" id="qtyInput-${idx}" type="number" value="${item.qty}" min="1" max="${item.maxStock}"
            onchange="setQty(${idx},this.value)">
          <button class="qty-btn" onclick="changeQty(${idx},1)">+</button>
        </div>
      </td>
      <td class="right" data-label="Subtotal"><span class="subtotal-mono" id="subtotalCell-${idx}">S/ ${fmt(item.subtotal)}</span></td>
      <td data-label="" style="width:32px;text-align:center;padding:0 4px">
        <button class="btn-remove" onclick="removeItem(${idx})" title="Eliminar">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

// ── Actualizar una sola fila sin reconstruir toda la tabla ─
// ANTES: changeQty/setQty/setPrice llamaban a renderItems(), que
// reemplaza el innerHTML de TODA la tabla (todas las filas, no solo
// la tocada). Eso destruye y vuelve a crear los <input> de cantidad
// y precio de TODAS las filas en cada tap de "+"/"-". En móvil, si
// el usuario venía de escribir en un campo (teclado abierto) o
// estaba tocando ese mismo input, destruirlo de golpe cierra el
// teclado abruptamente y el navegador reacomoda el viewport —
// disparando un scroll "fantasma" que se sentía como que la pantalla
// "sube y baja sola". Como "Editar nota" (Historial) reusa esta
// misma vista, el bug se veía también ahí. Ahora solo se actualiza
// el valor puntual de la fila que cambió; renderItems() completo
// queda solo para cuando la lista cambia de tamaño (agregar/quitar
// artículos), que es cuando sí hace falta reconstruir filas.
function updateRowDisplay(idx) {
  const item = items[idx];
  if (!item) return;
  const qtyEl   = document.getElementById(`qtyInput-${idx}`);
  const priceEl = document.getElementById(`priceInput-${idx}`);
  const subEl   = document.getElementById(`subtotalCell-${idx}`);
  if (qtyEl)   qtyEl.value       = item.qty;
  if (priceEl) priceEl.value     = item.price;
  if (subEl)   subEl.textContent = `S/ ${fmt(item.subtotal)}`;
}

function changeQty(idx, delta) {
  const item   = items[idx];
  const newQty = item.qty + delta;
  if (newQty < 1) return;
  if (newQty > item.maxStock) return alert(`Stock máximo: ${item.maxStock}`);
  item.qty      = newQty;
  item.subtotal = round2(item.qty * item.price);
  updateRowDisplay(idx);
  recalc();
}

function setQty(idx, val) {
  const item = items[idx];
  let q = parseInt(val) || 1;
  if (q < 1) q = 1;
  if (q > item.maxStock) { q = item.maxStock; alert(`Stock máximo: ${item.maxStock}`); }
  item.qty      = q;
  item.subtotal = round2(item.qty * item.price);
  updateRowDisplay(idx);
  recalc();
}

function setPrice(idx, val) {
  const item = items[idx];
  let p = parseFloat(val);
  if (isNaN(p) || p < 0) p = 0;
  item.price    = p;
  item.subtotal = round2(item.qty * item.price);
  updateRowDisplay(idx);
  recalc();
}

function removeItem(idx) {
  items.splice(idx, 1);
  renderItems();
  recalc();
}

// ── Recalcular totales ──────────────────────────────────
function recalc() {
  const subtotal = round2(items.reduce((s, i) => s + i.subtotal, 0));
  const discAmt  = round2(subtotal * (discountPct / 100));
  const total    = round2(subtotal - discAmt);

  document.getElementById('sumSubtotal').textContent = `S/ ${fmt(subtotal)}`;
  document.getElementById('sumTotal').textContent    = `S/ ${fmt(total)}`;

  if (discountPct > 0 && subtotal > 0) {
    document.getElementById('discountRow').style.display  = 'flex';
    document.getElementById('discPctLabel').textContent   = discountPct;
    document.getElementById('sumDiscount').textContent    = `− S/ ${fmt(discAmt)}`;
    document.getElementById('discSaving').style.display   = 'block';
    document.getElementById('discSaving').textContent     = `Ahorro: S/ ${fmt(discAmt)}`;
  } else {
    document.getElementById('discountRow').style.display  = 'none';
    document.getElementById('discSaving').style.display   = 'none';
  }
}

// ── Control de Descuentos ────────────────────────────────
function setDiscount(pct, element) {
  discountPct = pct;
  
  const pills = document.querySelectorAll('.disc-pill');
  pills.forEach(p => p.classList.remove('active'));
  if (element) {
    element.classList.add('active');
  }

  const discInput = document.getElementById('discInput');
  if (discInput) {
    discInput.value = pct > 0 ? pct : '';
  }

  recalc();
}

function onDiscountInput() {
  const discInput = document.getElementById('discInput');
  if (!discInput) return;
  
  let val = parseFloat(discInput.value);
  if (isNaN(val) || val < 0) val = 0;
  if (val > 100) val = 100;
  
  discountPct = val;

  const pills = document.querySelectorAll('.disc-pill');
  pills.forEach(p => p.classList.remove('active'));

  recalc();
}