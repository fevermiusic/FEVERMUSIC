/* ══════════════════════════════════════
   stock.js — Lógica de inventario
   ══════════════════════════════════════ */

let productsCache = [];

// Normaliza un código de producto para que sea siempre una clave
// de Firebase válida y consistente, venga de "Agregar producto",
// de editar, o de una importación masiva. Sin esto, "101 -4L" y
// "101-4L" quedaban como dos productos distintos (dos claves
// distintas) aunque a simple vista parezcan el mismo código.
function normalizeProductCode(raw) {
  var code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
  // sanitizeFirebaseKey vive en import-stock.js (quita/reemplaza
  // caracteres inválidos para una clave de Firebase: . # $ [ ] /).
  // Se llama así, en vez de duplicar la lógica, porque ambos
  // archivos se cargan en el mismo scope global de la SPA.
  if (typeof sanitizeFirebaseKey === 'function') code = sanitizeFirebaseKey(code);
  // Códigos que vienen de un Excel con columnas de ancho fijo
  // (ej. "B-3K-" con 50 espacios de relleno después) terminan, tras
  // el trim de arriba, en un guion colgando que no forma parte del
  // código real — nadie escribe a propósito un código que TERMINE en
  // guion. Se recorta cualquier racha de guiones/caracteres no
  // alfanuméricos que quede pegada al FINAL. El resto del código
  // (incluido el inicio) queda intacto: solo se toca la punta final.
  var trimmedEnd = code.replace(/[^A-Z0-9]+$/, '');
  if (trimmedEnd) code = trimmedEnd; // si quedara vacío (código de puros símbolos), se deja como estaba
  return code;
}

// Convierte la clave interna de vuelta a lo que el usuario realmente
// escribió, para CUALQUIER lugar donde el código se muestre en
// pantalla (tarjetas, tabla, modal de editar, notas, Excel...).
// Internamente el código se guarda con "⁄" (U+2044) en vez de "/"
// porque Firebase no admite "/" dentro de una clave, pero mostrar
// ese caracter tal cual en vez de convertirlo de vuelta a "/" hace
// que a simple vista se vea casi idéntico a un guion normal — el
// usuario edita, vuelve a escribir "/", y el resultado se ve
// exactamente igual que antes, como si el cambio nunca se hubiera
// guardado. Esta función es la única responsable de esa conversión
// de vuelta, así que todo lo que el usuario VE siempre muestra "/"
// tal cual lo tecleó, sin importar qué caracter se use por debajo
// para guardarlo.
function displayProductCode(code) {
  return String(code || '').replace(/⁄/g, '/');
}

function fmtPrice(n) {
  const num = Number(n);
  if (isNaN(num)) return "0";
  return num.toLocaleString('es-PE', { minimumFractionDigits: num % 1 === 0 ? 0 : 2 });
}

/* ── Paginación por scroll infinito ──────────────────────
   Antes se armaban las 500+ filas de golpe (tarjetas Y tabla) y
   la búsqueda solo las ocultaba con CSS — igual quedaban todas en
   el DOM. Ahora solo se pintan de a PAGE_SIZE, y se agregan más
   automáticamente cuando el usuario llega cerca del final. La
   búsqueda sigue operando sobre TODO productsCache (ya está en
   memoria, no hace falta volver a pedirle nada a Firebase), pero
   el renderizado de los resultados también se pagina igual. */
const STOCK_PAGE_SIZE = 20;
let stockRenderLimit = STOCK_PAGE_SIZE;
let stockScrollObserver = null;

function getFilteredProducts() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  if (!q) return productsCache;
  return productsCache.filter(p => {
    const search = `${p.code || ''} ${p.name || ''} ${p.category || ''}`.toLowerCase();
    return search.includes(q);
  });
}

function productCardHtml(p) {
  const code = p.code || '';
  const name = p.name || '';
  const category = p.category || '';
  const stock = p.stock !== undefined ? p.stock : 0;
  const price = p.price !== undefined ? p.price : 0;
  const desc = p.desc || '';
  const stockClass = stock <= 6 ? 'stock-low' : 'stock-ok';
  const escapedName = escapeJsAttr(name);
  const escapedCode = escapeJsAttr(code);
  const escapedCat  = escapeJsAttr(category);
  const isChecked = (typeof selectedStockCodes !== 'undefined' && selectedStockCodes.has(code)) ? 'checked' : '';
  return `
    <div class="product-card${isChecked ? ' selected' : ''}" data-code="${escapeHtml(code)}">
      <div class="pc-top">
        <div class="pc-check-wrap">
          <input type="checkbox" class="row-checkbox stock-check-card" data-code="${escapeHtml(code)}" ${isChecked}
            onchange="onStockCheckToggle(this)" onclick="event.stopPropagation()">
        </div>
        <div class="pc-code-wrap">
          <span class="pc-lbl">Código:</span>
          <span class="pc-code">${escapeHtml(displayProductCode(code))}</span>
        </div>
        <button class="btn-icon-edit" title="Editar"
          onclick="openEditStock('${escapedCode}','${escapedName}','${stock}','${price}','${escapedCat}','${escapeJsAttr(desc)}')">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>
      <div class="pc-mid">
        <div class="pc-name-wrap">
          <span class="pc-lbl">Prdto:</span>
          <span class="pc-name">${escapeHtml(name)}</span>
        </div>
        ${desc ? `<div class="pc-desc">${escapeHtml(desc)}</div>` : ''}
      </div>
      <div class="pc-bot">
        <div class="pc-bot-item">
          <span class="pc-lbl">Cantidad:</span>
          <span class="pc-qty ${stockClass}">${stock}</span>
        </div>
        <div class="pc-bot-item">
          <span class="pc-lbl">Precio:</span>
          <span class="pc-price">S/ ${fmtPrice(price)}</span>
        </div>
      </div>
    </div>
  `;
}

function productRowHtml(p) {
  const code = p.code || '';
  const name = p.name || '';
  const category = p.category || '';
  const stock = p.stock !== undefined ? p.stock : 0;
  const price = p.price !== undefined ? p.price : 0;
  const desc = p.desc || '';
  const stockClass = stock <= 6 ? 'stock-low' : 'stock-ok';
  const escapedName = escapeJsAttr(name);
  const escapedCode = escapeJsAttr(code);
  const escapedCat  = escapeJsAttr(category);
  const isChecked = (typeof selectedStockCodes !== 'undefined' && selectedStockCodes.has(code)) ? 'checked' : '';
  const showCheckbox = typeof currentUserRole !== 'undefined' && currentUserRole !== 'vendedor';
  return `
    <tr data-code="${escapeHtml(code)}" class="${isChecked ? 'row-selected' : ''}">
      ${showCheckbox ? `<td class="col-check"><input type="checkbox" class="row-checkbox stock-check" data-code="${escapeHtml(code)}" ${isChecked} onchange="onStockCheckToggle(this)"></td>` : ''}
      <td class="pt-code">${escapeHtml(displayProductCode(code))}</td>
      <td class="pt-name">${escapeHtml(name)}</td>
      <td class="pt-desc">${desc ? escapeHtml(desc) : '<span class="pt-desc-empty">—</span>'}</td>
      <td class="pt-qty ${stockClass}">${stock}</td>
      <td class="pt-price">S/ ${fmtPrice(price)}</td>
      <td>
        <button class="btn btn-ghost btn-sm stock-edit-btn" title="Editar"
          onclick="openEditStock('${escapedCode}','${escapedName}','${stock}','${price}','${escapedCat}','${escapeJsAttr(desc)}')">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Editar
        </button>
      </td>
    </tr>
  `;
}

/* Vuelve a armar la página visible (0..stockRenderLimit) a partir
   del catálogo ya filtrado. Se usa tanto al cargar/cambiar datos
   como al tipear en el buscador y al llegar al final del scroll. */
function renderStockPage() {
  const list  = document.getElementById('productList');
  const tbody = document.getElementById('productTableBody');
  if (!list && !tbody) return; // la vista de Stock no está montada ahora mismo

  const filtered = getFilteredProducts();
  const page = filtered.slice(0, stockRenderLimit);

  if (list) {
    list.innerHTML = page.map(productCardHtml).join('');
    if (currentUserRole !== 'vendedor') {
      list.querySelectorAll('.product-card').forEach(card => wireSelectableRow(card, stockSelection, onStockCheckToggle));
    }
  }
  if (tbody) {
    tbody.innerHTML = page.map(productRowHtml).join('');
    if (currentUserRole !== 'vendedor') {
      tbody.querySelectorAll('tr[data-code]').forEach(row => wireSelectableRow(row, stockSelection, onStockCheckToggle));
    }
  }

  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.style.display = filtered.length === 0 ? 'block' : 'none';

  const footerInfo = document.getElementById('footerInfo');
  if (footerInfo) {
    footerInfo.textContent = filtered.length > page.length
      ? `Mostrando ${page.length} de ${filtered.length} productos — bajá para ver más`
      : `${filtered.length} producto${filtered.length !== 1 ? 's' : ''}`;
  }

  setupStockInfiniteScroll(filtered.length);
  if (typeof updateBulkStock === 'function') updateBulkStock();
}

/* Observa un "centinela" al final de la lista/tabla; cuando entra
   en pantalla, se cargan 20 productos más (sin volver a pedirle
   nada a Firebase — ya están todos en productsCache). */
function setupStockInfiniteScroll(totalFiltered) {
  if (stockScrollObserver) { stockScrollObserver.disconnect(); stockScrollObserver = null; }
  if (stockRenderLimit >= totalFiltered) return; // ya está todo cargado

  // Ambas vistas (cards para mobile, tabla para desktop) están
  // siempre en el DOM — CSS solo oculta la que no corresponde según
  // el ancho de pantalla. Si se elegía la tabla sin fijarse si está
  // oculta, el centinela quedaba dentro de un elemento display:none
  // y el IntersectionObserver nunca disparaba en modo teléfono, por
  // lo que el scroll infinito se quedaba trabado en los primeros 20.
  const tbody = document.getElementById('productTableBody');
  const list  = document.getElementById('productList');
  const isVisible = (el) => !!el && el.offsetParent !== null;
  const anchor = isVisible(tbody) ? tbody : (isVisible(list) ? list : (tbody || list));
  if (!anchor) return;

  const sentinel = document.createElement('div');
  sentinel.id = 'stockScrollSentinel';
  sentinel.style.height = '1px';
  if (anchor.tagName === 'TBODY') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.appendChild(sentinel);
    tr.appendChild(td);
    anchor.appendChild(tr);
  } else {
    anchor.appendChild(sentinel);
  }

  stockScrollObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      stockRenderLimit += STOCK_PAGE_SIZE;
      renderStockPage();
    }
  }, { root: anchor.closest('.page-content'), rootMargin: '400px' });
  stockScrollObserver.observe(sentinel);
}

/* ── Render: lista de cards ── */
function renderProducts() {
  stockRenderLimit = STOCK_PAGE_SIZE; // el catálogo cambió (Firebase) — se vuelve a empezar desde la primera página
  renderStockPage();
  updateStats();
}

/* ── Stats ── */
function updateStats() {
  const statTotal = document.getElementById('statTotal');
  if (!statTotal) return; // la vista de Stock no está montada ahora mismo
  const total = productsCache.length;
  const low   = productsCache.filter(p => (p.stock !== undefined ? p.stock : 0) <= 6).length;
  const value = productsCache.reduce((sum, p) => sum + ((Number(p.price) || 0) * (p.stock !== undefined ? p.stock : 0)), 0);
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statLow').textContent   = low;
  document.getElementById('statValue').textContent = `S/ ${value.toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;
}

/* ── Firebase listener ── */
// Espera a que auth-guard.js confirme la sesión antes de conectarse
// a Firebase — evita una condición de carrera con las Reglas que
// exigen auth != null.
authReady.then(() => {
  watchProducts(list => {
    productsCache = list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    renderProducts();
    // Aviso a otras vistas abiertas (ej. Nueva Nota) de que el stock
    // real acaba de cambiar, para que puedan refrescar sus propios
    // límites en vivo en vez de quedarse con el stock que había al
    // momento de agregar el producto al carrito.
    if (typeof window.onProductsCacheUpdated === 'function') window.onProductsCacheUpdated();
  });
});

/* ── Modales ── */
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}
function outsideClose(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

/* ── Editar ── */
let editingCode = '';

function openEditStock(code, name, stock, price, cat, desc) {
  editingCode = code; // clave real de Firebase (con "⁄" si el código lleva "/")
  document.getElementById('editModalTitle').textContent = name;
  // Se muestra siempre con "/" real, nunca con "⁄": si no se
  // convierte aquí, el campo editable queda con el mismo caracter
  // que el usuario ya considera "roto", y al volver a escribir "/"
  // el resultado normalizado se ve idéntico a lo que había antes.
  document.getElementById('editModalCode').textContent  = displayProductCode(code);
  document.getElementById('editCode').value  = displayProductCode(code);
  document.getElementById('editName').value  = name;
  document.getElementById('editStock').value = stock;
  document.getElementById('editPrice').value = price;
  const descEl = document.getElementById('editDesc');
  if (descEl) descEl.value = desc || '';
  openModal('editModal');
}

function saveStock() {
  const name  = document.getElementById('editName').value.trim();
  const stock = parseInt(document.getElementById('editStock').value)   || 0;
  const price = parseFloat(document.getElementById('editPrice').value) || 0;
  const descEl = document.getElementById('editDesc');
  const desc  = descEl ? descEl.value.trim() : '';
  // El campo Código pasa por el mismo normalizeProductCode que "Agregar",
  // así que también acepta "/" (se guarda como ⁄, la clave de Firebase
  // real no admite "/" literal, pero se ve igual en pantalla).
  const newCode = normalizeProductCode(document.getElementById('editCode').value);

  if (!name) return alert('El nombre no puede estar vacío.');
  if (!newCode) return alert('El código no puede estar vacío.');

  const codeChanged = newCode !== editingCode;
  if (codeChanged && productsCache.some(p => p.code === newCode)) {
    return alert(`Ya existe un producto con el código ${newCode}.`);
  }

  const existing = productsCache.find(p => p.code === editingCode) || {};
  const finalCode = codeChanged ? newCode : editingCode;

  const doSave = () => saveProduct(finalCode, {
    name,
    desc,
    price,
    stock,
    category: existing.category || 'general'
  }, existing.stock);

  const chain = codeChanged
    ? renameProductCode(editingCode, newCode).then(doSave)
    : doSave();

  chain
    .then(() => {
      editingCode = finalCode;
      closeModal('editModal');
    })
    .catch(err => alert('Error al guardar: ' + err.message));
}

function deleteCurrentProduct() {
  if (!editingCode) return;
  if (!confirm(`¿Eliminar el producto ${editingCode}? Esta acción no se puede deshacer.`)) return;
  deleteProduct(editingCode)
    .then(() => closeModal('editModal'))
    .catch(err => alert('No se pudo eliminar el producto: ' + err.message));
}

/* ── Agregar ── */
function addProduct() {
  const name  = document.getElementById('addName').value.trim();
  const code  = normalizeProductCode(document.getElementById('addCode').value);
  const stock = parseInt(document.getElementById('addStock').value)   || 0;
  const price = parseFloat(document.getElementById('addPrice').value) || 0;
  const descEl = document.getElementById('addDesc');
  const desc  = descEl ? descEl.value.trim() : '';

  if (!name || !code) return alert('Completa nombre y código.');
  if (productsCache.some(p => p.code === code))
    return alert(`Ya existe un producto con el código ${code}.`);

  saveProduct(code, { name, desc, price, stock, category: 'general' }, undefined, true)
    .then(() => {
      closeModal('addModal');
      ['addName','addCode','addDesc','addStock','addPrice'].forEach(id => {
        document.getElementById(id).value = '';
      });
    })
    .catch(err => alert('Error al registrar: ' + err.message));
}

/* ── Filtro búsqueda ── */
function filterStock() {
  stockRenderLimit = STOCK_PAGE_SIZE; // nueva búsqueda: se vuelve a la primera página de resultados
  renderStockPage();
}

/* ── Teclado ── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open')
      .forEach(m => closeModal(m.id));
  }
  // Enter en un campo de texto del modal de Editar o Agregar guarda
  // igual que si se hiciera clic en el botón — antes no pasaba nada
  // porque estos formularios no son un <form> real, así que Enter no
  // tenía ninguna acción por defecto. Se excluyen los <textarea> para
  // no interceptar el Enter que ahí sirve para bajar de línea.
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    const editModal = document.getElementById('editModal');
    const addModal  = document.getElementById('addModal');
    if (editModal && editModal.classList.contains('open') && editModal.contains(e.target)) {
      e.preventDefault();
      saveStock();
    } else if (addModal && addModal.classList.contains('open') && addModal.contains(e.target)) {
      e.preventDefault();
      addProduct();
    }
  }
});

/* ══════════════════════════════════════
   MODO SELECCIÓN, EXPORTAR Y ELIMINAR MASIVO
  ══════════════════════════════════════
   Los checkboxes están ocultos por defecto (ver stock-card.css /
   import.css) y solo aparecen en modo selección, activado desde
   el botón "Seleccionar" o con pulsación larga sobre una fila o
   tarjeta (lógica compartida en selection.js). */

let selectedStockCodes = new Set();

const stockSelection = createSelectionMode({
  containers: ['.product-table', '#productList', '.topbar-actions'],
  buttonId: 'btnSelectMode',
  labelId: 'selectModeLabel',
  onExit: () => {
    selectedStockCodes.clear();
    document.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = false; });
    const master = document.getElementById('checkAllStock');
    if (master) master.checked = false;
    updateBulkStock();
  }
});

function setSelectionMode(on) { stockSelection.set(on); }
function toggleSelectionMode() { stockSelection.toggle(); }

// Un mismo producto puede tener checkbox en la tabla (desktop) y en la
// tarjeta (mobile) a la vez; al marcar uno se sincroniza el otro.
function onStockCheckToggle(cb) {
  const code = cb.dataset.code;
  const checked = cb.checked;
  if (checked) selectedStockCodes.add(code); else selectedStockCodes.delete(code);
  document.querySelectorAll(`.row-checkbox[data-code="${CSS.escape(code)}"]`).forEach(other => {
    other.checked = checked;
  });
  updateBulkStock();
}

function toggleAllStock(master) {
  const filtered = getFilteredProducts();
  if (master.checked) {
    filtered.forEach(p => selectedStockCodes.add(p.code));
  } else {
    filtered.forEach(p => selectedStockCodes.delete(p.code));
  }
  renderStockPage();
}

// Botón "Seleccionar todo" del bulk-bar (modo selección ya activo).
function selectAllStock() {
  getFilteredProducts().forEach(p => selectedStockCodes.add(p.code));
  const master = document.getElementById('checkAllStock');
  if (master) master.checked = true;
  renderStockPage();
}

function updateBulkStock() {
  document.querySelectorAll('#productTableBody tr[data-code]').forEach(row => {
    row.classList.toggle('row-selected', selectedStockCodes.has(row.dataset.code));
  });
  document.querySelectorAll('.product-card[data-code]').forEach(card => {
    card.classList.toggle('selected', selectedStockCodes.has(card.dataset.code));
  });

  const count = selectedStockCodes.size;
  const bar   = document.getElementById('bulkBarStock');
  if (bar) bar.classList.toggle('visible', count > 0);
  const countEl = document.getElementById('bulkCountStock');
  if (countEl) countEl.textContent = `${count} producto${count !== 1 ? 's' : ''} seleccionado${count !== 1 ? 's' : ''}`;

  // Actualizar label exportar
  const total    = productsCache.length;
  const filtered = getFilteredProducts().length;
  const lbl = document.getElementById('exportStockLabel');
  if (lbl) {
    if (count > 0)             lbl.textContent = `Exportar (${count} sel.)`;
    else if (filtered < total) lbl.textContent = `Exportar filtrado (${filtered})`;
    else                       lbl.textContent = `Exportar todo (${total})`;
  }
}

/* ── Eliminar seleccionados / todo ── */
function deleteSelectedStock() {
  const count = selectedStockCodes.size;
  if (count === 0) return;
  if (!confirm(`¿Eliminar ${count} producto${count !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`)) return;
  // allSettled en vez de all: si un código tiene un caracter que
  // Firebase rechaza (dato viejo corrupto), ese producto falla pero
  // NO bloquea el borrado del resto de la selección.
  Promise.allSettled([...selectedStockCodes].map(code => deleteProduct(code).then(() => ({ code }))))
    .then(results => {
      setSelectionMode(false);
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        alert(`${count - failed.length} producto(s) eliminado(s). ${failed.length} no se pudo(pudieron) eliminar (código con caracteres inválidos). Edítalo(s) desde el modal para corregir el código y volver a intentar.`);
      }
    });
}

function deleteAllStock() {
  const total = productsCache.length;
  if (total === 0) return;
  if (!confirm(`¿Eliminar TODOS los ${total} productos? Esta acción no se puede deshacer.`)) return;
  if (!confirm('Segunda confirmación: ¿estás seguro? Se borrarán todos los productos del inventario.')) return;
  Promise.allSettled(productsCache.map(p => deleteProduct(p.code)))
    .then(results => {
      setSelectionMode(false);
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        alert(`${total - failed} producto(s) eliminado(s). ${failed} no se pudo(pudieron) eliminar (código con caracteres inválidos).`);
      }
    });
}

/* ── Exportar flexible ── */
async function exportStock() {
  let rows; let filename;
  const today = new Date().toISOString().slice(0, 10);

  if (selectedStockCodes.size > 0) {
    rows = productsCache.filter(p => selectedStockCodes.has(p.code));
    filename = `stock-seleccionado-${today}.xlsx`;
  } else {
    const filteredProducts = getFilteredProducts();
    const allVisible = filteredProducts.length === productsCache.length;
    // Solo se pregunta cuando el botón exporta TODO el inventario
    // (sin filtro ni selección activa) — exportar una selección o
    // un filtro ya es una acción intencional y puntual, así que no
    // hace falta confirmarla también.
    if (allVisible && !confirm(`¿Exportar los ${filteredProducts.length} productos a Excel?`)) return;
    rows = filteredProducts;
    filename = allVisible
      ? `stock-completo-${today}.xlsx`
      : `stock-filtrado-${today}.xlsx`;
  }

  // Lazy load SheetJS
  await new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });

  const data = [
    ['Código', 'Nombre', 'Descripción', 'Cantidad', 'Precio'],
    ...rows.map(p => [displayProductCode(p.code), sanitizeForExcel(p.name), sanitizeForExcel(p.desc || ''), p.stock, p.price])
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 34 }, { wch: 28 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock');
  XLSX.writeFile(wb, filename);
}


// ── Restricciones de rol "vendedor" ─────────────────────
// Antes vivía en un <script> aparte dentro de stock.html. En la
// SPA se movió aquí para poder llamarla desde Stock.init() cada
// vez que se muestra esta vista.
function applyStockRoleRestrictions() {
  if (currentUserRole !== 'vendedor') return;

  const statsRow = document.getElementById('stockStatsRow');
  if (statsRow) statsRow.style.display = 'none';

  const btnImport = document.querySelector('.btn-import');
  if (btnImport) btnImport.style.display = 'none';

  const btnExport = document.getElementById('btnExportStock');
  if (btnExport) btnExport.style.display = 'none';

  const btnSelect = document.getElementById('btnSelectMode');
  if (btnSelect) btnSelect.style.display = 'none';

  const btnAdd = document.querySelector('.btn-new-item');
  if (btnAdd) btnAdd.style.display = 'none';

  // Este estilo se agregaba una sola vez por página en el modelo
  // viejo. En la SPA, si ya existe (de una visita anterior a esta
  // vista), no hace falta agregarlo de nuevo.
  if (!document.getElementById('stockRoleStyle')) {
    const style = document.createElement('style');
    style.id = 'stockRoleStyle';
    // Para vendedor, productRowHtml() nunca agrega la celda de
    // checkbox en el <tbody>. Si dejamos visible el <th class="col-check">
    // del encabezado, la tabla queda con una columna de más y todo el
    // contenido se desplaza una posición (bug reportado). Se oculta
    // también el encabezado para que headers y celdas vuelvan a alinear.
    style.textContent = '.btn-icon-edit, .stock-edit-btn, .product-table .col-check { display: none !important; }';
    document.head.appendChild(style);
  }
}

// ── Punto de entrada que llama el Router cada vez que se
//    muestra esta vista (instantáneo: usa productsCache ya cargado) ──
window.Stock = {
  init() {
    renderProducts(); // ya incluye updateStats() y filterStock() adentro
    applyStockRoleRestrictions();
  }
};