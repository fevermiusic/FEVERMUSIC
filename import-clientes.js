// =========================================================
// Musical Fever — Importacion de Clientes
// Compara contra Firebase Y contra el propio archivo
// =========================================================

function loadScriptClientes(url) {
  return new Promise(function(resolve, reject) {
    if (document.querySelector('script[src="' + url + '"]')) { resolve(); return; }
    var s = document.createElement('script');
    s.src = url; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Plantilla de ejemplo
async function downloadClientTemplate() {
  await loadScriptClientes('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  var data = [
    ['RUC', 'Cliente', 'Ciudad'],
    ['20123456789', 'Instrumentos del Sur S.A.C.', 'Lima'],
    ['20987654321', 'Melody Center E.I.R.L.', 'Arequipa'],
    ['10456789012', 'Juan Perez Natural', ''],
  ];
  var ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 14 }, { wch: 34 }, { wch: 16 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  await saveWorkbook(wb, 'plantilla-clientes.xlsx');
}

// Estado global
var importRows         = [];
var pendingNewClientes  = []; // filas limpias (sin duplicado) listas para guardar
var duplicateQueue      = []; // filas duplicadas: se omiten todas de una vez

// Por encima de este numero de duplicados, la lista solo muestra un resumen
// (evita pintar cientos de filas de una vez y sentirse "trabado").
var MAX_DUP_CLIENTES_RENDER = 300;

function openImportClientes() {
  importRows = []; pendingNewClientes = []; duplicateQueue = [];
  var fi = document.getElementById('importClientesFile');
  if (fi) fi.value = '';
  var err = document.getElementById('importClientesError');
  if (err) err.style.display = 'none';
  showImportStep('stepUpload');
  document.getElementById('importClientesModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeImportClientes() {
  document.getElementById('importClientesModal').classList.remove('open');
  document.body.style.overflow = '';
}

function showImportStep(step) {
  ['stepUpload','stepPreview','stepDuplicates','stepDone'].forEach(function(s) {
    var el = document.getElementById(s);
    if (el) el.style.display = (s === step) ? '' : 'none';
  });
  var proc = document.getElementById('btnProcesarImport');
  if (proc) proc.style.display = (step === 'stepPreview') ? '' : 'none';
}

// Parsear archivo
async function onImportClientesFile(input) {
  var file = input.files[0];
  if (!file) return;
  await loadScriptClientes('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb   = XLSX.read(e.target.result, { type: 'binary' });
      var ws   = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      var dataRows = rows.filter(function(r, i) {
        if (i === 0) return false;
        var ruc    = String(r[0] || '').trim().replace(/\D/g, '');
        var nombre = String(r[1] || '').trim();
        return ruc.length > 0 && nombre.length > 0;
      });

      if (dataRows.length === 0) {
        showClientImportError('El archivo no tiene registros validos. Debe tener al menos una fila con RUC y Nombre.');
        input.value = ''; return;
      }

      importRows = dataRows.map(function(r) {
        return {
          ruc:    String(r[0] || '').trim().replace(/\D/g, '').slice(0, 11),
          nombre: String(r[1] || '').trim(),
          ciudad: String(r[2] || '').trim()
        };
      }).filter(function(r) { return r.ruc && r.nombre; });

      if (importRows.length === 0) {
        showClientImportError('No se encontraron clientes con RUC y Nombre validos. Descarga la plantilla.');
        input.value = ''; return;
      }

      renderClientesPreview();
      showImportStep('stepPreview');
    } catch(err) {
      showClientImportError('No se pudo leer el archivo. Sube un Excel (.xlsx) o CSV valido.');
      input.value = '';
    }
  };
  reader.readAsBinaryString(file);
}

function showClientImportError(msg) {
  var el = document.getElementById('importClientesError');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 6000);
  } else { alert(msg); }
}

// Normaliza un RUC igual que al importarlo (solo dígitos, máx 11) —
// se usa también sobre clientsCache para que la comparación no falle
// si algún registro viejo quedó guardado con espacios u otro formato.
function normalizeRuc(ruc) {
  return String(ruc || '').trim().replace(/\D/g, '').slice(0, 11);
}

// Vista previa — compara vs Firebase Y vs repetidos en el archivo
function renderClientesPreview() {
  var existingRucs = new Set(clientsCache.map(function(c) { return normalizeRuc(c.ruc); }));

  var countInFile = {};
  importRows.forEach(function(r) {
    countInFile[r.ruc] = (countInFile[r.ruc] || 0) + 1;
  });

  var html = '<table class="import-preview-table"><thead><tr>'
    + '<th>RUC</th><th>Cliente</th><th>Ciudad</th><th>Estado</th>'
    + '</tr></thead><tbody>';

  importRows.forEach(function(r) {
    var isDbDup       = existingRucs.has(r.ruc);
    var isInternalDup = countInFile[r.ruc] > 1;
    var isDup         = isDbDup || isInternalDup;

    var badge;
    if (isDbDup)            badge = '<span class="import-badge dup">Ya en Firebase</span>';
    else if (isInternalDup) badge = '<span class="import-badge dup">Repetido en archivo</span>';
    else                    badge = '<span class="import-badge new">Nuevo</span>';

    html += '<tr class="' + (isDup ? 'import-row-dup' : '') + '">'
      + '<td class="mono">' + escapeHtml(r.ruc) + '</td>'
      + '<td>' + escapeHtml(r.nombre) + '</td>'
      + '<td>' + (r.ciudad ? escapeHtml(r.ciudad) : '—') + '</td>'
      + '<td>' + badge + '</td>'
      + '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('previewClientesBody').innerHTML = html;

  var totalDups = importRows.filter(function(r) {
    return existingRucs.has(r.ruc) || countInFile[r.ruc] > 1;
  }).length;
  var news = importRows.length - totalDups;

  document.getElementById('previewClientesSummary').innerHTML =
    '<strong>' + importRows.length + '</strong> registros &nbsp;&middot;&nbsp; '
    + '<span style="color:var(--green)">' + news + ' nuevos</span> &nbsp;&middot;&nbsp; '
    + '<span style="color:var(--amber)">' + totalDups + ' duplicados</span>';
}

// ── Procesar ──────────────────────────────────────────────
// Separa el archivo en "nuevos" (se importan directo) y "duplicados"
// (ya en Firebase o repetidos dentro del archivo). Los duplicados ya
// NO se resuelven uno por uno: se listan todos y se omiten en un click.
function processImportClientes() {
  var existingRucs = new Set(clientsCache.map(function(c) { return normalizeRuc(c.ruc); }));

  var countInFile = {};
  importRows.forEach(function(r) {
    countInFile[r.ruc] = (countInFile[r.ruc] || 0) + 1;
  });

  pendingNewClientes = [];
  duplicateQueue     = [];

  importRows.forEach(function(r) {
    var isDbDup       = existingRucs.has(r.ruc);
    var isInternalDup = countInFile[r.ruc] > 1;

    if (!isDbDup && !isInternalDup) {
      pendingNewClientes.push(r);
    } else {
      duplicateQueue.push({
        ruc: r.ruc, nombre: r.nombre, ciudad: r.ciudad,
        motivo: isDbDup ? 'Ya en Firebase' : 'Repetido en archivo'
      });
    }
  });

  if (duplicateQueue.length === 0) {
    saveImportedClientes(pendingNewClientes);
    return;
  }
  renderClientesDuplicatesList();
  showImportStep('stepDuplicates');
}

// ── Listar todos los duplicados de una vez (sin ir uno por uno) ──
function renderClientesDuplicatesList() {
  var visibleRows = duplicateQueue.slice(0, MAX_DUP_CLIENTES_RENDER);

  var html = '<table class="import-preview-table"><thead><tr>'
    + '<th>RUC</th><th>Cliente</th><th>Ciudad</th><th>Motivo</th>'
    + '</tr></thead><tbody>';

  visibleRows.forEach(function(r) {
    html += '<tr class="import-row-dup">'
      + '<td class="mono">' + escapeHtml(r.ruc) + '</td>'
      + '<td>' + escapeHtml(r.nombre) + '</td>'
      + '<td>' + (r.ciudad ? escapeHtml(r.ciudad) : '—') + '</td>'
      + '<td><span class="import-badge dup">' + escapeHtml(r.motivo) + '</span></td>'
      + '</tr>';
  });
  html += '</tbody></table>';

  var extra = duplicateQueue.length - visibleRows.length;
  if (extra > 0) {
    html += '<p class="dup-list-note">+ ' + extra + ' duplicado' + (extra !== 1 ? 's' : '') + ' mas (no se muestran, pero tambien se omitiran)</p>';
  }

  document.getElementById('dupClientesListBody').innerHTML = html;
  document.getElementById('dupClientesSummary').innerHTML =
    '<strong>' + duplicateQueue.length + '</strong> cliente' + (duplicateQueue.length !== 1 ? 's' : '') + ' duplicado' + (duplicateQueue.length !== 1 ? 's' : '') + ' se omitir' + (duplicateQueue.length !== 1 ? 'án' : 'á') + '. &nbsp;&middot;&nbsp; '
    + '<span style="color:var(--green)">' + pendingNewClientes.length + ' nuevo' + (pendingNewClientes.length !== 1 ? 's' : '') + '</span> se importar' + (pendingNewClientes.length !== 1 ? 'án' : 'á') + '.';
}

// 'omitir' guarda los nuevos y descarta TODOS los duplicados en un solo paso.
// 'cancelar' cierra el modal sin guardar nada.
function resolveDuplicate(action) {
  if (action === 'cancelar') { closeImportClientes(); return; }
  saveImportedClientes(pendingNewClientes);
}

// Guardar en Firebase
async function saveImportedClientes(rows) {
  var omitted = duplicateQueue.length;

  if (!rows || rows.length === 0) {
    document.getElementById('importDoneMsg').textContent = omitted > 0
      ? 'No hay clientes nuevos para importar. Se omitieron ' + omitted + ' duplicado' + (omitted !== 1 ? 's' : '') + '.'
      : 'No hay clientes nuevos para importar.';
    showImportStep('stepDone');
    return;
  }
  var btn = document.getElementById('btnProcesarImport');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  try {
    await Promise.all(rows.map(function(r) {
      return saveClient(r.ruc, { nombre: r.nombre, ciudad: r.ciudad || '' });
    }));
    var msg = rows.length + ' cliente' + (rows.length !== 1 ? 's' : '') + ' importado' + (rows.length !== 1 ? 's' : '') + ' correctamente.';
    if (omitted > 0) msg += ' Se omitieron ' + omitted + ' duplicado' + (omitted !== 1 ? 's' : '') + '.';
    document.getElementById('importDoneMsg').textContent = msg;
    showImportStep('stepDone');
  } catch(err) {
    alert('Error al guardar: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Procesar importación'; }
  }
}