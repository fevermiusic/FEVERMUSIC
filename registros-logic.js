// =========================================================
// Registros — gestión de cuentas del equipo (solo admin)
// =========================================================
// El acceso a esta pantalla ya lo bloquea el router (ver router.js)
// para cualquiera que no sea admin, y las reglas de Firebase
// bloquean también la escritura en /users si no es admin — así que
// aunque alguien lograra abrir esta página, no podría cambiar nada.

let usersCache = [];

async function loadRegistros() {
  const tbody = document.getElementById('regTableBody');
  const footer = document.getElementById('regFooterInfo');
  const empty = document.getElementById('regEmptyState');
  footer.textContent = 'Cargando…';

  try {
    usersCache = await getAllUsers();
  } catch (err) {
    footer.textContent = 'No se pudo cargar la lista.';
    console.error(err);
    return;
  }

  if (usersCache.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
    footer.textContent = '0 cuentas';
    return;
  }
  empty.style.display = 'none';
  renderRegistros();
}

function renderRegistros() {
  const tbody = document.getElementById('regTableBody');
  const footer = document.getElementById('regFooterInfo');

  tbody.innerHTML = usersCache.map(u => {
    const esUno = u.uid === currentUserUid;
    const activo = u.activo !== false;
    return `
      <tr data-uid="${escapeHtml(u.uid)}">
        <td>${escapeHtml(u.nombre || '—')}${esUno ? ' <span style="color:var(--text-3);font-size:11px">(tú)</span>' : ''}</td>
        <td style="color:var(--text-3);font-size:12.5px">${escapeHtml(u.rol === 'admin' ? (u.correo || '—') : (u.usuario || '—'))}</td>
        <td class="col-city"><span class="reg-role-badge ${u.rol === 'admin' ? 'admin' : ''}">${u.rol === 'admin' ? 'Admin' : 'Vendedor'}</span></td>
        <td class="col-city">
          <div class="reg-status-cell">
            <label class="status-toggle">
              <input type="checkbox" ${activo ? 'checked' : ''} ${esUno ? 'disabled' : ''}
                onchange="onToggleActivo('${escapeJsAttr(u.uid)}', this.checked)">
              <span class="status-toggle-track"></span>
            </label>
            <span class="reg-status-label ${activo ? 'activo' : 'inactivo'}">${activo ? 'Activo' : 'Inactivo'}</span>
          </div>
        </td>
        <td class="col-acts">${esUno ? '' : `<div class="reg-acts-cell">
          <button class="btn-reg-edit" onclick="openEditVendor('${escapeJsAttr(u.uid)}')" title="Editar cuenta / cambiar contraseña">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-reg-delete" onclick="onDeleteUser('${escapeJsAttr(u.uid)}', '${escapeJsAttr(u.nombre || u.usuario || '')}')" title="Eliminar usuario">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>`}</td>
      </tr>
    `;
  }).join('');

  footer.textContent = `${usersCache.length} cuenta${usersCache.length === 1 ? '' : 's'}`;
}

async function onToggleActivo(uid, activo) {
  const row = document.querySelector(`tr[data-uid="${CSS.escape(uid)}"]`);
  const checkbox = row ? row.querySelector('input[type="checkbox"]') : null;
  if (checkbox) checkbox.disabled = true;

  try {
    await setUserActive(uid, activo);
    const u = usersCache.find(x => x.uid === uid);
    if (u) u.activo = activo;
    renderRegistros();
  } catch (err) {
    alert('No se pudo actualizar: ' + (err.message || err));
    renderRegistros(); // vuelve a pintar el estado real (revierte el switch si falló)
  }
}

async function onDeleteUser(uid, nombre) {
  if (uid === currentUserUid) return; // salvaguarda extra, aunque el botón ni se pinta para uno mismo
  if (!confirm(`¿Eliminar a "${nombre || 'este usuario'}"? Pierde acceso a la app de inmediato. Esta acción no se puede deshacer.`)) return;

  const row = document.querySelector(`tr[data-uid="${CSS.escape(uid)}"]`);
  const btn = row ? row.querySelector('.btn-reg-delete') : null;
  if (btn) btn.disabled = true;

  try {
    await deleteUserProfile(uid);
    usersCache = usersCache.filter(u => u.uid !== uid);
    renderRegistros();
  } catch (err) {
    alert('No se pudo eliminar: ' + (err.message || err));
    if (btn) btn.disabled = false;
  }
}

// ── Modal: nuevo vendedor ──────────────────────────────
function openNewVendor() {
  document.getElementById('newVendorNombre').value = '';
  document.getElementById('newVendorUsuario').value = '';
  document.getElementById('newVendorEmail').value = '';
  document.getElementById('newVendorPassword').value = '';
  document.getElementById('newVendorError').style.display = 'none';
  document.getElementById('newVendorOverlay').classList.add('open');
}
function closeNewVendor() {
  document.getElementById('newVendorOverlay').classList.remove('open');
}

async function submitNewVendor() {
  const nombre = document.getElementById('newVendorNombre').value.trim();
  const usuario = document.getElementById('newVendorUsuario').value.trim();
  const correo = document.getElementById('newVendorEmail').value.trim();
  const password = document.getElementById('newVendorPassword').value;
  const errorEl = document.getElementById('newVendorError');
  const submitBtn = document.getElementById('newVendorSubmit');
  errorEl.style.display = 'none';

  if (!nombre || !usuario || !password) {
    errorEl.textContent = 'Completa nombre, usuario y contraseña.';
    errorEl.style.display = 'block';
    return;
  }
  if (normalizeUsername(usuario).length === 0) {
    errorEl.textContent = 'El usuario debe tener al menos una letra o número.';
    errorEl.style.display = 'block';
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres (mínimo que exige Firebase).';
    errorEl.style.display = 'block';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creando…';
  try {
    await createVendorAccount(usuario, password, nombre, correo);
    closeNewVendor();
    await loadRegistros();
  } catch (err) {
    errorEl.textContent = traducirErrorNuevoVendedor(err.code) || err.message || 'No se pudo crear la cuenta.';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Crear cuenta';
  }
}

function traducirErrorNuevoVendedor(code) {
  const map = {
    'auth/email-already-in-use': 'Ese usuario ya existe — elige otro.',
    'auth/invalid-email': 'Ese usuario tiene caracteres que no se pueden usar. Prueba solo con letras y números.',
    'auth/weak-password': 'La contraseña es muy débil — usa al menos 6 caracteres.',
  };
  return map[code];
}

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('newVendorOverlay');
  if (overlay) {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeNewVendor(); });
  }
  const editOverlay = document.getElementById('editVendorOverlay');
  if (editOverlay) {
    editOverlay.addEventListener('click', e => { if (e.target === editOverlay) closeEditVendor(); });
  }
});

// ── Modal: editar cuenta / cambiar contraseña ──────────
let editVendorUid = null;

function openEditVendor(uid) {
  const u = usersCache.find(x => x.uid === uid);
  if (!u) return;
  editVendorUid = uid;
  document.getElementById('editVendorNombre').value = u.nombre || '';
  document.getElementById('editVendorEmail').value = u.correo || '';
  document.getElementById('editVendorPassword').value = '';
  document.getElementById('editVendorError').style.display = 'none';
  document.getElementById('editVendorOverlay').classList.add('open');
}

function closeEditVendor() {
  editVendorUid = null;
  document.getElementById('editVendorOverlay').classList.remove('open');
}

async function submitEditVendor() {
  if (!editVendorUid) return;
  const nombre = document.getElementById('editVendorNombre').value.trim();
  const correo = document.getElementById('editVendorEmail').value.trim();
  const nuevaPassword = document.getElementById('editVendorPassword').value;
  const errorEl = document.getElementById('editVendorError');
  const submitBtn = document.getElementById('editVendorSubmit');
  errorEl.style.display = 'none';

  if (!nombre) {
    errorEl.textContent = 'El nombre no puede quedar vacío.';
    errorEl.style.display = 'block';
    return;
  }
  if (nuevaPassword && nuevaPassword.length < 6) {
    errorEl.textContent = 'La contraseña debe tener al menos 6 caracteres (mínimo que exige Firebase).';
    errorEl.style.display = 'block';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando…';
  try {
    await updateUserProfile(editVendorUid, { nombre, correo });
    if (nuevaPassword) {
      await adminChangeVendorPassword(editVendorUid, nuevaPassword);
    }
    const u = usersCache.find(x => x.uid === editVendorUid);
    if (u) { u.nombre = nombre; u.correo = correo; }
    renderRegistros();
    closeEditVendor();
  } catch (err) {
    errorEl.textContent = (err && err.message) || 'No se pudieron guardar los cambios.';
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar cambios';
  }
}

// Punto de entrada que llama el router. La navegación (nav.js) ya
// oculta este enlace para vendedor, pero esto es la barrera real:
// si alguien de todos modos llega a #registros (escribiendo la URL
// a mano), se lo manda de vuelta sin cargar nada.
window.Registros = {
  init: function () {
    if (typeof isAdmin === 'function' && !isAdmin()) {
      if (window.Router) Router.go('pedidos', { force: true });
      return;
    }
    loadRegistros();
  }
};
