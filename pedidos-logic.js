// =========================================================
// Musical Fever — Notas de Pedido (lógica)
// Extraído de pedidos.html para la SPA. Se carga UNA vez en
// index.html — la conexión a Firebase queda viva todo el tiempo,
// sin importar qué vista esté mostrándose en pantalla.
//
// IMPORTANTE: 3 funciones se renombraron porque su nombre chocaba
// con las mismas de Stock (toggleSelectionMode, setSelectionMode,
// outsideClose) — al convivir ambas páginas en el mismo documento,
// la que cargara última "pisaba" a la otra silenciosamente.
//   toggleSelectionMode → toggleClienteSelectionMode
//   setSelectionMode    → setClienteSelectionMode
//   outsideClose(e)     → outsideCloseCliente(e)
// =========================================================

let clientsCache = [];
let editingRuc    = '';
let isNewClient   = false;
let selectedClientRucs = new Set();

// Mismo criterio que Stock: se pinta de a CLIENTS_PAGE_SIZE y se
// carga más al llegar cerca del final del scroll — la búsqueda sigue
// filtrando sobre TODO clientsCache (ya en memoria).
const CLIENTS_PAGE_SIZE = 20;
let clientsRenderLimit  = CLIENTS_PAGE_SIZE;
let clientsScrollObserver = null;

const clientSelection = createSelectionMode({
  containers: ['.table-wrap table', '.topbar-actions'],
  buttonId: 'btnSelectMode',
  labelId: 'selectModeLabel',
  onExit: () => {
    selectedClientRucs.clear();
    document.querySelectorAll('.client-check').forEach(cb => { cb.checked = false; });
    const master = document.getElementById('checkAllClientes');
    if (master) master.checked = false;
    updateBulkClientes();
  }
});

function getFilteredClients() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  if (!q) return clientsCache;
  return clientsCache.filter(c => {
    const search = `${c.ruc || ''} ${c.nombre || ''} ${c.ciudad || ''}`.toLowerCase();
    return search.includes(q);
  });
}

function clientRowHtml(c) {
  const escapedNombre = escapeJsAttr(c.nombre);
  const escapedRuc    = escapeJsAttr(c.ruc);
  const escapedCiudad = escapeJsAttr(c.ciudad || '');
  const isChecked = selectedClientRucs.has(c.ruc) ? 'checked' : '';
  return `
    <tr data-ruc="${escapeHtml(c.ruc)}" class="${isChecked ? 'row-selected' : ''}">
      <td class="col-check"><input type="checkbox" class="row-checkbox client-check" data-ruc="${escapeHtml(c.ruc)}" ${isChecked} onchange="onClientCheckToggle(this)"></td>
      <td data-label="RUC"><span class="ruc-num">${escapeHtml(c.ruc)}</span></td>
      <td data-label="Cliente"><div class="client-name">${escapeHtml(c.nombre)}</div></td>
      <td data-label="Ciudad"><span class="city-cell">${c.ciudad ? escapeHtml(c.ciudad) : '—'}</span></td>
      <td data-label=""><div class="actions-cell">
        <button class="btn btn-ghost btn-edit-client" style="height:30px;font-size:12px;padding:0 10px"
          onclick="openEdit('${escapedRuc}','${escapedNombre}','${escapedCiudad}')">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
        <button class="btn btn-primary" style="height:30px;font-size:12px;padding:0 10px"
          onclick="goToNuevaNota('${escapedRuc}','${escapedNombre}')">
          <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nota
        </button>
      </div></td>
    </tr>
  `;
}

/* Vuelve a armar la página visible (0..clientsRenderLimit) a partir
   del listado ya filtrado. Se usa al cargar/cambiar datos, al
   tipear en el buscador, y al llegar al final del scroll. */
function renderClientsPage() {
  const body = document.getElementById('tableBody');
  if (!body) return; // la vista de Pedidos no está montada ahora mismo

  const filtered = getFilteredClients();
  const page = filtered.slice(0, clientsRenderLimit);
  body.innerHTML = page.map(clientRowHtml).join('');

  if (currentUserRole !== 'vendedor') {
    body.querySelectorAll('tr[data-ruc]').forEach(row => wireSelectableRow(row, clientSelection, onClientCheckToggle));
  }

  const empty  = document.getElementById('emptyState');
  const footer = document.getElementById('footerInfo');
  if (empty)  empty.style.display = filtered.length === 0 ? 'block' : 'none';
  if (footer) footer.textContent = '';

  applyPedidosRoleRestrictions();
  setupClientsInfiniteScroll(filtered.length);
  updateBulkClientes();
}

/* Observa un centinela al final de la tabla; cuando entra en
   pantalla, se cargan 20 clientes más — sin volver a pedirle nada
   a Firebase, ya están todos en clientsCache. root apunta a
   .page-content (el contenedor que realmente scrollea) en vez de
   la ventana completa — mismo ajuste que se hizo en Stock, donde
   root:null nunca detectaba el final porque el scroll real pasa
   adentro de .page-content, no en la ventana. */
function setupClientsInfiniteScroll(totalFiltered) {
  if (clientsScrollObserver) { clientsScrollObserver.disconnect(); clientsScrollObserver = null; }
  if (clientsRenderLimit >= totalFiltered) return; // ya está todo cargado

  const tbody = document.getElementById('tableBody');
  if (!tbody) return;

  const sentinel = document.createElement('div');
  sentinel.id = 'clientsScrollSentinel';
  sentinel.style.height = '1px';
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 5;
  td.appendChild(sentinel);
  tr.appendChild(td);
  tbody.appendChild(tr);

  clientsScrollObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      clientsRenderLimit += CLIENTS_PAGE_SIZE;
      renderClientsPage();
    }
  }, { root: tbody.closest('.page-content'), rootMargin: '400px' });
  clientsScrollObserver.observe(sentinel);
}

// ── Render dinámico de la tabla a partir de Firebase ──────
// Si la vista de Pedidos no está montada en este momento (el
// usuario está viendo Stock, por ejemplo), #tableBody no existe —
// no hay nada que pintar todavía. Cuando vuelva a Pedidos,
// Pedidos.init() llama a renderClients() de nuevo con los datos
// ya en caché, sin esperar a Firebase otra vez.
function renderClients() {
  clientsRenderLimit = CLIENTS_PAGE_SIZE; // el catálogo cambió (Firebase) — se vuelve a empezar desde la primera página
  renderClientsPage();
}

// Suscripción en tiempo real a Firebase — se conecta UNA sola vez,
// apenas la app abre (no en cada visita a la sección).
authReady.then(() => {
  watchClients(list => {
    clientsCache = list.sort((a, b) => a.nombre.localeCompare(b.nombre));
    renderClients();
  });
});

function goToNuevaNota(ruc, nombre) {
  if (window.Router) {
    Router.go('nueva-nota', { params: { ruc, nombre } });
  } else {
    window.location.href = `nueva-nota.html?ruc=${ruc}&nombre=${encodeURIComponent(nombre)}`;
  }
}

function openEdit(ruc, nombre, ciudad) {
  if (currentUserRole === 'vendedor') return; // editar cliente es exclusivo de admin
  isNewClient = false;
  editingRuc = ruc;
  document.getElementById('editModalTitle').textContent = 'Editar cliente';
  document.getElementById('editModalSubtitle').textContent = 'Modificar datos del cliente en la nota';
  document.getElementById('editCurrentInfo').style.display = 'flex';
  document.getElementById('btnDeleteClient').style.display = 'inline-flex';
  document.getElementById('editCurrentRuc').textContent = ruc;
  document.getElementById('editCurrentCity').textContent = ciudad || '—';
  document.getElementById('editRuc').value = ruc;
  document.getElementById('editNombre').value = nombre;
  document.getElementById('editCiudad').value = ciudad;
  document.getElementById('editModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function openNewClient() {
  isNewClient = true;
  editingRuc = '';
  document.getElementById('editModalTitle').textContent = 'Nuevo cliente';
  document.getElementById('editModalSubtitle').textContent = 'Registrar cliente para emitir notas de pedido';
  document.getElementById('editCurrentInfo').style.display = 'none';
  document.getElementById('btnDeleteClient').style.display = 'none';
  document.getElementById('editRuc').value = '';
  document.getElementById('editNombre').value = '';
  document.getElementById('editCiudad').value = '';
  document.getElementById('editModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeEdit() {
  const modal = document.getElementById('editModal');
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
}

// Renombrado de outsideClose(e) — ver nota al inicio del archivo.
function outsideCloseCliente(e) {
  if (e.target === document.getElementById('editModal')) closeEdit();
}

function saveEdit() {
  if (!isNewClient && currentUserRole === 'vendedor') return; // editar cliente es exclusivo de admin

  const ruc    = document.getElementById('editRuc').value.trim();
  const nombre = document.getElementById('editNombre').value.trim();
  const ciudad = document.getElementById('editCiudad').value.trim();

  if (!/^\d{11}$/.test(ruc)) {
    return alert('El RUC debe tener exactamente 11 dígitos.');
  }
  if (!nombre) {
    return alert('Completa la razón social.');
  }
  if ((isNewClient || ruc !== editingRuc) && clientsCache.some(c => c.ruc === ruc)) {
    return alert(`Ya existe un cliente registrado con el RUC ${ruc}.`);
  }

  const data = { nombre, ciudad };
  const finish = () => closeEdit();

  if (!isNewClient && editingRuc && ruc !== editingRuc) {
    saveClient(ruc, data)
      .then(() => deleteClient(editingRuc))
      .then(finish)
      .catch(err => alert('No se pudo actualizar el cliente: ' + err.message));
  } else {
    saveClient(ruc, data).then(finish).catch(err => {
      alert('No se pudo guardar el cliente: ' + err.message);
    });
  }
}

function deleteCurrentClient() {
  if (!editingRuc) return;
  if (currentUserRole === 'vendedor') return; // vendedor puede editar, no eliminar
  if (!confirm(`¿Eliminar al cliente con RUC ${editingRuc}? Esta acción no se puede deshacer.`)) return;
  deleteClient(editingRuc).then(() => closeEdit())
    .catch(err => alert('No se pudo eliminar el cliente: ' + err.message));
}

function filterTable() {
  clientsRenderLimit = CLIENTS_PAGE_SIZE; // nueva búsqueda: se vuelve a la primera página de resultados
  renderClientsPage();
}

// El listener de Escape queda activo siempre (se cargó una vez);
// closeEdit() ya es seguro de llamar aunque la vista no exista.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeEdit();
});

// ── Modo selección / checkboxes ─────────────────────────
function setClienteSelectionMode(on) { clientSelection.set(on); }
function toggleClienteSelectionMode() { clientSelection.toggle(); }

function onClientCheckToggle(cb) {
  const ruc = cb.dataset.ruc;
  if (cb.checked) selectedClientRucs.add(ruc); else selectedClientRucs.delete(ruc);
  updateBulkClientes();
}

function toggleAllClientes(master) {
  const filtered = getFilteredClients();
  if (master.checked) {
    filtered.forEach(c => selectedClientRucs.add(c.ruc));
  } else {
    filtered.forEach(c => selectedClientRucs.delete(c.ruc));
  }
  renderClientsPage();
}

function selectAllClientes() {
  getFilteredClients().forEach(c => selectedClientRucs.add(c.ruc));
  const master = document.getElementById('checkAllClientes');
  if (master) master.checked = true;
  renderClientsPage();
}

function updateBulkClientes() {
  document.querySelectorAll('#tableBody tr[data-ruc]').forEach(row => {
    row.classList.toggle('row-selected', selectedClientRucs.has(row.dataset.ruc));
  });

  const count = selectedClientRucs.size;
  const bar   = document.getElementById('bulkBarClientes');
  if (!bar) return;
  bar.classList.toggle('visible', count > 0);
  document.getElementById('bulkCountClientes').textContent =
    `${count} cliente${count !== 1 ? 's' : ''} seleccionado${count !== 1 ? 's' : ''}`;

  const total    = clientsCache.length;
  const filtered = getFilteredClients().length;
  const exportBtn = document.getElementById('exportClientesLabel');
  if (exportBtn) {
    if (count > 0)             exportBtn.textContent = `Exportar (${count} sel.)`;
    else if (filtered < total) exportBtn.textContent = `Exportar filtrado (${filtered})`;
    else                       exportBtn.textContent = `Exportar todo (${total})`;
  }
}

function deleteSelectedClientes() {
  const count = selectedClientRucs.size;
  if (count === 0) return;
  if (!confirm(`¿Eliminar ${count} cliente${count !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`)) return;
  // allSettled: un RUC con problema no bloquea el borrado del resto
  // (mismo criterio que se aplicó en Stock).
  Promise.allSettled([...selectedClientRucs].map(ruc => deleteClient(ruc)))
    .then(results => {
      setClienteSelectionMode(false);
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) alert(`${count - failed} cliente(s) eliminado(s). ${failed} no se pudo(pudieron) eliminar.`);
    });
}

function deleteAllClientes() {
  const total = clientsCache.length;
  if (total === 0) return;
  if (!confirm(`¿Eliminar TODOS los ${total} clientes? Esta acción no se puede deshacer.`)) return;
  if (!confirm('Segunda confirmación: ¿estás seguro? Se borrarán todos los clientes.')) return;
  Promise.allSettled(clientsCache.map(c => deleteClient(c.ruc)))
    .then(results => {
      setClienteSelectionMode(false);
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) alert(`${total - failed} cliente(s) eliminado(s). ${failed} no se pudo(pudieron) eliminar.`);
    });
}

async function exportClientes() {
  let rows, filename;
  if (selectedClientRucs.size > 0) {
    rows = clientsCache.filter(c => selectedClientRucs.has(c.ruc));
    filename = `clientes-seleccionados-${today()}.xlsx`;
  } else {
    const filteredClients = getFilteredClients();
    const allVisible = filteredClients.length === clientsCache.length;
    // Solo se pregunta cuando el botón exporta TODO el catálogo
    // (sin filtro ni selección activa) — exportar una selección o
    // un filtro ya es una acción intencional y puntual, así que no
    // hace falta confirmarla también.
    if (allVisible && !confirm(`¿Exportar los ${filteredClients.length} clientes a Excel?`)) return;
    rows = filteredClients;
    filename = allVisible
      ? `clientes-todos-${today()}.xlsx`
      : `clientes-filtrados-${today()}.xlsx`;
  }

  await loadScriptExport('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

  const data = [
    ['RUC', 'Cliente', 'Ciudad'],
    ...rows.map(c => [c.ruc, sanitizeForExcel(c.nombre), sanitizeForExcel(c.ciudad || '')])
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  await saveWorkbook(wb, filename);
}

function loadScriptExport(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Restricciones de rol "vendedor" ─────────────────────
function applyPedidosRoleRestrictions() {
  if (currentUserRole !== 'vendedor') return;
  const btnImport = document.querySelector('.btn-import');
  if (btnImport) btnImport.style.display = 'none';
  const btnExport = document.getElementById('btnExportClientes');
  if (btnExport) btnExport.style.display = 'none';
  const btnSelect = document.getElementById('btnSelectMode');
  if (btnSelect) btnSelect.style.display = 'none';
  // El botón "Editar" de cada fila queda oculto para vendedor: no
  // puede modificar los datos del cliente (RUC, razón social,
  // ciudad) desde esta vista. Solo admin puede editar clientes.
  document.querySelectorAll('.btn-edit-client').forEach(btn => { btn.style.display = 'none'; });
}

// ── Punto de entrada que llama el Router cada vez que se
//    muestra esta vista (instantáneo: usa clientsCache ya cargado) ──
window.Pedidos = {
  init() {
    renderClients(); // ya reaplica las restricciones de rol adentro
  }
};
