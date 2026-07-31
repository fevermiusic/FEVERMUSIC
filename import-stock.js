// =========================================================
// Musical Fever — Control de Stock e Importación (Códigos Especiales Válidos)
// =========================================================

function loadScriptStock(url) {
  return new Promise(function(resolve, reject) {
    if (document.querySelector('script[src="' + url + '"]')) { resolve(); return; }
    var s = document.createElement('script');
    s.src = url; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

var IMPORT_MODE_CONFIG = {
  full: {
    label: 'Importar todo',
    modalTitle: 'Importar productos — todo',
    modalHint: 'Crea productos nuevos con código, nombre, descripción, cantidad y precio. En los que ya existen (mismo código): reemplaza cantidad, precio, nombre y descripción por los del archivo. Ningún código se omite.',
    dropHint: 'Excel (.xlsx) o CSV con columnas: Código, Nombre, Descripción, Cantidad, Precio',
    templateFile: 'plantilla-importar-todo.xlsx',
    templateHeader: ['Codigo', 'Nombre', 'Descripcion', 'Cantidad', 'Precio'],
    templateRows: [
      ['FV-V 1/2', 'Violin Fractional 1/2', 'Estudio Con Estuche', 10, 450],
      ['GTR-001', 'Guitarra Electroacustica Yamaha', 'APX600 Natural', 10, 890]
    ],
    templateColWidths: [12, 34, 28, 10, 10],
    tableCols: ['Codigo', 'Nombre', 'Cant.', 'Precio', 'Estado']
  },
  both: {
    label: 'Cantidad y precio',
    modalTitle: 'Importar cantidad y precio',
    modalHint: 'Suma la cantidad y reemplaza el precio en productos que ya existen.',
    dropHint: 'Excel (.xlsx) o CSV con columnas: Código, Cantidad, Precio',
    templateFile: 'plantilla-cantidad-y-precio.xlsx',
    templateHeader: ['Codigo', 'Cantidad', 'Precio'],
    templateRows: [
      ['FV-V 1/2', 10, 450]
    ],
    templateColWidths: [12, 10, 10],
    tableCols: ['Codigo', 'Nombre', '+Cant.', 'Precio nuevo', 'Estado']
  },
  stock: {
    label: 'Solo cantidad',
    modalTitle: 'Importar cantidad (stock)',
    modalHint: 'Suma la cantidad importada al stock actual de productos que ya existen. No toca el precio.',
    dropHint: 'Excel (.xlsx) o CSV con columnas: Código, Cantidad',
    templateFile: 'plantilla-cantidad.xlsx',
    templateHeader: ['Codigo', 'Cantidad'],
    templateRows: [
      ['FV-V 1/2', 10]
    ],
    templateColWidths: [12, 10],
    tableCols: ['Codigo', 'Nombre', '+Cant.', 'Estado']
  },
  price: {
    label: 'Solo precio',
    modalTitle: 'Importar precio',
    modalHint: 'Reemplaza el precio (no lo suma) de productos que ya existen. No toca la cantidad.',
    dropHint: 'Excel (.xlsx) o CSV con columnas: Código, Precio',
    templateFile: 'plantilla-precio.xlsx',
    templateHeader: ['Codigo', 'Precio'],
    templateRows: [
      ['FV-V 1/2', 450]
    ],
    templateColWidths: [12, 10],
    tableCols: ['Codigo', 'Nombre', 'Precio nuevo', 'Estado']
  }
};

function toggleImportMenu(e) {
  if (e) e.stopPropagation();
  var dd = document.getElementById('importMenuDropdown');
  if (!dd) return;
  dd.classList.toggle('open');
}

document.addEventListener('click', function(e) {
  var wrap = document.getElementById('importMenuWrap');
  var dd = document.getElementById('importMenuDropdown');
  if (!wrap || !dd) return;
  if (!wrap.contains(e.target)) dd.classList.remove('open');
});

function selectImportMode(mode) {
  var dd = document.getElementById('importMenuDropdown');
  if (dd) dd.classList.remove('open');
  openImportStock(mode);
}

async function downloadStockTemplate() {
  await loadScriptStock('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  var cfg = IMPORT_MODE_CONFIG[importStockMode];
  var data = [cfg.templateHeader].concat(cfg.templateRows);
  var ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = cfg.templateColWidths.map(function(w) { return { wch: w }; });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  XLSX.writeFile(wb, cfg.templateFile);
}

var importStockMode = 'full';
var importStockRows = [];
var importStockPlan  = [];
var MAX_IMPORT_ROWS_RENDER = 300;
// Si dos o más filas del mismo archivo terminan con el mismo código
// normalizado (ej. "FV-6" y "FV- 6"), antes se combinaban en un solo
// registro sin avisar. Ahora se marcan como conflicto y el usuario
// puede, fila por fila: editar el código para que quede único, o
// quitarla de la importación. Estos dos mapas (por índice de fila
// dentro de importStockRows) guardan esas decisiones entre renders.
var importStockExcluded = {};
var importStockCodeOverrides = {};

function openImportStock(mode) {
  importStockMode = mode || 'full';
  importStockRows = []; importStockPlan = [];
  importStockExcluded = {}; importStockCodeOverrides = {};
  var cfg = IMPORT_MODE_CONFIG[importStockMode];

  var fi = document.getElementById('importStockFile');
  if (fi) fi.value = '';
  var err = document.getElementById('importStockError');
  if (err) err.style.display = 'none';

  var title = document.getElementById('importStockModalTitle');
  if (title) title.textContent = cfg.modalTitle;
  var hint = document.getElementById('importStockModalHint');
  if (hint) hint.textContent = cfg.modalHint;
  var dropHint = document.getElementById('importStockDropHint');
  if (dropHint) dropHint.textContent = cfg.dropHint;

  showImportStockStep('stepUploadStock');
  document.getElementById('importStockModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeImportStock() {
  var modal = document.getElementById('importStockModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function showImportStockStep(step) {
  ['stepUploadStock', 'stepPreviewStock', 'stepConflictStock', 'stepDoneStock'].forEach(function(s) {
    var el = document.getElementById(s);
    if (el) el.style.display = (s === step) ? '' : 'none';
  });
  var siguiente = document.getElementById('btnSiguienteImportStock');
  if (siguiente) siguiente.style.display = (step === 'stepPreviewStock') ? '' : 'none';
  var proc = document.getElementById('btnProcesarImportStock');
  if (proc) proc.style.display = (step === 'stepConflictStock') ? '' : 'none';
  var closeBtn = document.getElementById('btnCerrarImportStock');
  if (closeBtn) closeBtn.textContent = (step === 'stepConflictStock') ? 'Cancelar' : 'Cerrar';
}

async function onImportStockFile(input) {
  var file = input.files[0];
  if (!file) return;
  await loadScriptStock('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

  var mode = importStockMode;
  var reader = new FileReader();

  reader.onload = function(e) {
    try {
      var wb   = XLSX.read(e.target.result, { type: 'binary' });
      var ws   = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      var dataRows = rows.filter(function(r, i) {
        if (i === 0) return false;
        return String(r[0] || '').trim().length > 0;
      });

      if (dataRows.length === 0) {
        showStockImportError('El archivo no tiene registros válidos.');
        input.value = ''; return;
      }

      importStockExcluded = {}; importStockCodeOverrides = {};
      importStockRows = dataRows.map(function(r, i) {
        var originalCode = String(r[0] || '').trim();
        var rawCode = normalizeProductCode(originalCode);
        var code = rawCode; // ya viene normalizado (mayúsculas, sin espacios internos, claves válidas)
        // El aviso solo se muestra si se QUITÓ un carácter (. # $ [ ]),
        // no cuando solo se sustituyó "/" por su parecido visual ni
        // cuando solo se le cambiaron espacios por guiones —eso no
        // cambia lo que el usuario reconoce como su código.
        var sanitized = /[.#$\[\]]/.test(originalCode);

        if (mode === 'full') {
          return {
            idx: i,
            code: rawCode,
            normalizedCode: code,
            sanitized: sanitized,
            originalCode: originalCode,
            name: String(r[1] || '').trim(),
            desc: String(r[2] || '').trim(),
            stock: parseInt(r[3]) || 0,
            price: parseFloat(r[4]) || 0
          };
        }
        if (mode === 'both') {
          return { idx: i, code: rawCode, normalizedCode: code, sanitized: sanitized, originalCode: originalCode, stock: parseInt(r[1]) || 0, price: parseFloat(r[2]) || 0 };
        }
        if (mode === 'stock') {
          return { idx: i, code: rawCode, normalizedCode: code, sanitized: sanitized, originalCode: originalCode, stock: parseInt(r[1]) || 0 };
        }
        return { idx: i, code: rawCode, normalizedCode: code, sanitized: sanitized, originalCode: originalCode, price: parseFloat(r[1]) || 0 };
      }).filter(function(r) {
        return r.code && (mode !== 'full' || r.name);
      });

      renderFullPreviewList();
      showImportStockStep('stepPreviewStock');
    } catch (err) {
      showStockImportError('No se pudo leer el archivo Excel.');
      input.value = '';
    }
  };
  reader.readAsBinaryString(file);
}

function showStockImportError(msg) {
  var el = document.getElementById('importStockError');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(function() { el.style.display = 'none'; }, 6000);
  } else { alert(msg); }
}

// Firebase Realtime Database no permite . # $ [ ] / dentro de una
// clave (los interpreta como separadores de ruta). El código de
// producto ES la clave (ver watchProducts en firebase.js: code = snap.key),
// así que un código como "FV-BOW-1/2" se guardaría en una ruta anidada
// products/FV-BOW-1/2 en vez de como un producto plano. Se reemplaza
// por un guion para que quede como una clave válida y plana.
// Firebase no admite estos 5 caracteres dentro de una clave (los usa
// como separadores de ruta): . # $ [ ] /
// Se quitan del código antes de guardarlo. La fila queda marcada con
// un aviso en la vista previa para que se note el cambio.
// Firebase no admite estos caracteres dentro de una clave (los usa
// como separadores de ruta): . # $ [ ] /
// La barra "/" es muy común en códigos de tallas/fracciones (ej.
// "1/2"), así que en vez de quitarla se reemplaza por un carácter
// Unicode de fracción que se ve prácticamente igual en pantalla
// (⁄ U+2044) — el código sigue mostrándose "1/2". El resto de
// caracteres inválidos sí se quita directamente, porque no hay un
// parecido razonable, y esa fila queda marcada con un aviso.
function sanitizeFirebaseKey(code) {
  return String(code || '')
    .replace(/\//g, '⁄')
    .replace(/[.#$\[\]]/g, '');
}

function toggleImportRowExclude(idx) {
  if (importStockExcluded[idx]) delete importStockExcluded[idx];
  else importStockExcluded[idx] = true;
  renderConflictStep();
}

// Corrige el código de una fila que ya se había omitido. A diferencia
// de updateImportRowCode (que solo aplica a filas activas dentro de un
// grupo en conflicto), esta además la vuelve a incluir: si el usuario
// está editando el código es porque quiere que la fila SÍ entre, con
// el código corregido — no tiene sentido dejarla omitida a la vez.
function editExcludedRowCode(idx, newValue) {
  var raw = String(newValue || '').trim();
  if (raw) importStockCodeOverrides[idx] = raw;
  delete importStockExcluded[idx];
  renderConflictStep();
}

function updateImportRowCode(idx, newValue) {
  var raw = String(newValue || '').trim();
  if (!raw) { delete importStockCodeOverrides[idx]; renderConflictStep(); return; }
  importStockCodeOverrides[idx] = raw;
  renderConflictStep();
}

// Aplica exclusiones (Omitir) y ediciones de código hechas en la
// vista previa, y arma la lista de filas realmente activas para el
// merge. Se recalcula en cada render porque el usuario puede seguir
// ajustando conflictos antes de darle a "Procesar importación".
function getActiveImportRows() {
  return importStockRows
    .filter(function(r) { return !importStockExcluded[r.idx]; })
    .map(function(r) {
      var override = importStockCodeOverrides[r.idx];
      if (!override) return r;
      var newNorm = normalizeProductCode(override);
      return Object.assign({}, r, { code: newNorm, normalizedCode: newNorm, originalCode: override, edited: true });
    });
}

// Antes, si dos filas del archivo caían en el mismo código ya
// normalizado (ej. "FV-6" y "FV- 6", o "S-2U H" y "S-2U-H"), se
// combinaban en un solo registro sin decírselo a nadie: se sumaba
// la cantidad y se quedaba con el último precio/nombre. Eso es
// riesgoso para una empresa real que necesita que TODO quede
// registrado. Ahora cada grupo guarda también sus filas originales
// (collisionRows) para poder mostrar el conflicto y dejar que el
// usuario edite el código o quite la fila que no corresponde.
function mergeStockRows(rows) {
  var merged = {};
  var order = [];
  rows.forEach(function(r) {
    var key = r.normalizedCode;
    if (merged[key]) {
      var m = merged[key];
      if (r.stock !== undefined) m.stock = (m.stock || 0) + r.stock;
      if (r.price !== undefined) m.price = r.price;
      if (r.name  !== undefined) m.name  = r.name;
      if (r.desc  !== undefined) m.desc  = r.desc;
      m.collisionRows.push(r);
    } else {
      merged[key] = Object.assign({}, r, { collisionRows: [r] });
      order.push(key);
    }
  });
  return order.map(function(key) { return merged[key]; });
}

// Mapa código-normalizado → producto existente, armado desde
// productsCache. Antes esto solo se calculaba adentro de
// renderConflictStep; se extrae acá porque ahora la vista previa
// (renderFullPreviewList) también lo necesita para mostrar, en los
// modos que no traen nombre en el archivo (stock/price/both), a QUÉ
// producto real corresponde cada código antes de tocar nada.
function getStockProductsMap() {
  var pMap = {};
  if (typeof productsCache !== 'undefined' && Array.isArray(productsCache)) {
    productsCache.forEach(function(p) {
      if (p && p.code) {
        var normCacheCode = String(p.code).trim().toUpperCase().replace(/\s+/g, ' ');
        pMap[normCacheCode] = p;
      }
    });
  }
  return pMap;
}

// ── Paso 2 (Vista previa): TODAS las filas tal cual se leyeron del
// archivo, sin fusionar nada todavía. Es solo informativo, para que
// el usuario vea que entraron las 513 (o las que sean) antes de que
// el sistema resuelva nada por su cuenta.
//
// Antes, en los modos "Solo cantidad" / "Solo precio" / "Cantidad y
// precio" (que no traen nombre en el Excel, solo código + cantidad/
// precio), esta función armaba <td> solo para las columnas que la fila
// SÍ tenía (r.name era undefined en esos modos). Como el header sí
// mostraba "Nombre", la tabla quedaba con una columna de <td> de menos
// que de <th>: cada celda se corría un lugar a la izquierda y el valor
// de "+Cant." terminaba pintado debajo del header "Nombre" (con "0" en
// vez del código, como se ve cuando el navegador rellena la celda que
// falta). Ahora SIEMPRE se arma una celda de nombre: en modo "full" es
// el nombre del archivo; en el resto, se busca el producto ya
// existente en el sistema por código y se muestra su nombre real (o
// "No encontrado" en rojo si el código no matchea ningún producto).
// Además, en "Solo cantidad" se muestra junto al +Cant. el stock
// actual y el resultado final (actual → actual + importado), para que
// quede clarísimo qué cantidad se va a sumar y sobre qué producto,
// ANTES de llegar al paso de conflictos.
function renderFullPreviewList() {
  var mode = importStockMode;
  var cfg = IMPORT_MODE_CONFIG[mode];
  var rows = importStockRows;
  var visibleRows = rows.slice(0, MAX_IMPORT_ROWS_RENDER);
  var pMap = getStockProductsMap();
  var headerCols = cfg.tableCols.slice(0, -1); // sin "Estado": acá todavía no se decide nada

  var html = '<table class="import-preview-table"><thead><tr>'
    + headerCols.map(function(c) { return '<th>' + c + '</th>'; }).join('')
    + '</tr></thead><tbody>';

  visibleRows.forEach(function(r) {
    var existing = pMap[r.normalizedCode];
    var cells = ['<td class="mono">' + escapeHtml(r.code)
      + (r.sanitized ? ' <span class="import-sanitized-flag" title="Código original: ' + escapeHtml(r.originalCode) + ' — se quitaron caracteres especiales no permitidos">⚠</span>' : '')
      + '</td>'];
    if (r.name !== undefined) {
      // Modo "full": el nombre viene del propio archivo.
      cells.push('<td>' + escapeHtml(r.name || '—') + '</td>');
    } else {
      // Modos sin nombre en el archivo: se muestra el nombre del
      // producto real que ya existe con ese código, para que el
      // usuario pueda verificar de un vistazo que el código y la
      // descripción coinciden con lo que espera (y detectar a tiempo
      // un código que por error matchea otro producto distinto).
      var existName = existing ? existing.name : '';
      cells.push('<td' + (existing ? '' : ' class="import-no-match"') + '>'
        + (existName ? escapeHtml(existName) : 'No encontrado') + '</td>');
    }
    if (r.stock !== undefined) {
      var curStock = existing ? (parseInt(existing.stock) || 0) : null;
      var stockCell = '<span class="mono">+' + r.stock + '</span>';
      if (curStock !== null) {
        stockCell += ' <span class="import-stock-hint">(' + curStock + ' → ' + (curStock + r.stock) + ')</span>';
      }
      cells.push('<td>' + stockCell + '</td>');
    }
    if (r.price !== undefined) cells.push('<td class="mono">S/ ' + r.price.toFixed(2) + '</td>');
    html += '<tr>' + cells.join('') + '</tr>';
  });

  html += '</tbody></table>';

  var extra = rows.length - visibleRows.length;
  if (extra > 0) {
    html += '<p class="dup-list-note">+ ' + extra + ' fila' + (extra !== 1 ? 's' : '') + ' más</p>';
  }

  var previewBody = document.getElementById('previewStockBody');
  if (previewBody) previewBody.innerHTML = html;

  var summaryEl = document.getElementById('previewStockSummary');
  if (summaryEl) {
    summaryEl.innerHTML = '<strong>' + rows.length + '</strong> fila' + (rows.length !== 1 ? 's' : '') + ' leída' + (rows.length !== 1 ? 's' : '') + ' del archivo';
  }

  var sanitizedCount = rows.filter(function(r) { return r.sanitized; }).length;
  var warnEl = document.getElementById('previewStockSanitizedWarning');
  if (warnEl) {
    if (sanitizedCount > 0) {
      warnEl.style.display = 'block';
      warnEl.textContent = '⚠ ' + sanitizedCount + ' código(s) tenían caracteres no permitidos (. # $ [ ]) y se guardarán sin ellos. Están marcados con ⚠ en la tabla — pasa el cursor sobre el código para ver el original.';
    } else {
      warnEl.style.display = 'none';
    }
  }
}

function goToConflictStep() {
  showImportStockStep('stepConflictStock');
  renderConflictStep();
}

// Lista de filas omitidas con su código EDITABLE ahí mismo — antes
// solo mostraba el texto y un "Deshacer" ciego, que devolvía la fila
// tal cual estaba (con el código que originó el choque). Ahora se
// puede corregir el código directamente acá: al tocar fuera del campo
// (onchange) la fila se corrige Y se vuelve a incluir en un solo paso,
// sin tener que deshacer primero y buscarla de nuevo entre las demás.
function buildExcludedRowsHtml() {
  var excludedIdxs = Object.keys(importStockExcluded);
  if (excludedIdxs.length === 0) return '';
  var html = '<div class="import-conflict-group">'
    + '<div class="import-conflict-group-title">Filas omitidas <span class="import-conflict-meta">(editá el código para volver a incluirlas)</span></div>';
  html += excludedIdxs.map(function(idx) {
    var row = importStockRows.filter(function(r) { return String(r.idx) === String(idx); })[0];
    if (!row) return '';
    var currentCode = importStockCodeOverrides[idx] ? normalizeProductCode(importStockCodeOverrides[idx]) : row.code;
    var meta = escapeHtml(row.name || '—')
      + (row.stock !== undefined ? ' · Cant. ' + row.stock : '')
      + (row.price !== undefined ? ' · S/ ' + row.price.toFixed(2) : '');
    return '<div class="import-conflict-row">'
      + '<input type="text" class="import-conflict-input" value="' + escapeHtml(currentCode) + '" '
      + 'onchange="editExcludedRowCode(' + idx + ', this.value)" title="Código original en el archivo: ' + escapeHtml(row.originalCode) + ' — editá y se vuelve a incluir con este código">'
      + '<span class="import-conflict-meta">' + meta + '</span>'
      + '<button type="button" class="btn-import-undo" onclick="toggleImportRowExclude(' + idx + ')">Deshacer</button>'
      + '</div>';
  }).join('');
  html += '</div>';
  return html;
}

// ── Paso 3 (Conflictos): acá se resuelve el problema real. Se
// calcula el plan final (create/update) y, si hay códigos que
// chocan, solo se muestra ESO — no las 500+ filas de nuevo — con una
// explicación breve de por qué pasa, y la posibilidad de editar el
// código de la fila que no corresponde u omitirla. Mientras quede
// un conflicto sin resolver, "Procesar importación" queda bloqueado.
function renderConflictStep() {
  var mode = importStockMode;
  var pMap = getStockProductsMap();

  var merged = mergeStockRows(getActiveImportRows());
  importStockPlan = merged.map(function(r) {
    var lookupKey = r.normalizedCode;
    var existing = pMap[lookupKey];
    if (mode === 'full') {
      return Object.assign({}, r, { action: existing ? 'update-full' : 'create', existing: existing });
    }
    return Object.assign({}, r, { action: existing ? 'update' : 'skip-notfound', existing: existing });
  });

  var conflictGroups = importStockPlan.filter(function(r) { return r.collisionRows.length > 1; });
  var summaryEl = document.getElementById('conflictStockSummary');
  var explainEl = document.getElementById('conflictStockExplain');
  var bodyEl = document.getElementById('conflictStockBody');
  var procBtn = document.getElementById('btnProcesarImportStock');

  if (conflictGroups.length === 0) {
    if (explainEl) explainEl.style.display = 'none';
    var willCreateRows = importStockPlan.filter(function(r) { return r.action === 'create'; });
    var willUpdateRows = importStockPlan.filter(function(r) { return r.action === 'update-full' || r.action === 'update'; });
    var willSkipRows   = importStockPlan.filter(function(r) { return r.action === 'skip-notfound'; });
    var willCreate = willCreateRows.length;
    var willUpdate = willUpdateRows.length;
    var willSkip   = willSkipRows.length;
    if (summaryEl) {
      summaryEl.innerHTML = '✓ No se encontraron códigos repetidos.<br>'
        + (mode === 'full'
          ? ('<strong>' + willCreate + '</strong> se crearán' + (willUpdate > 0 ? ' &middot; <strong>' + willUpdate + '</strong> se actualizarán' : ''))
          : ('<strong>' + willUpdate + '</strong> se actualizarán' + (willSkip > 0 ? ' &middot; <strong>' + willSkip + '</strong> no encontrados (se omiten)' : '')));
    }
    // Se muestra la lista puntual de qué códigos se van a ACTUALIZAR
    // (productos que ya existían) — antes solo aparecía el número,
    // sin decir cuáles son. La lista de "se crearán" no se detalla acá
    // porque en modo 'full' suele ser la mayoría del archivo (cientos
    // de filas), y eso sí saturaría el modal.
    var detailHtml = '';
    if (willUpdateRows.length > 0) {
      detailHtml += '<div class="import-update-detail"><strong>Se actualizarán:</strong><ul class="import-update-list">'
        + willUpdateRows.map(function(r) {
            var existingName = (r.existing && r.existing.name) || r.name || '';
            return '<li><span class="mono">' + escapeHtml(r.code) + '</span>'
              + (existingName ? ' — ' + escapeHtml(existingName) : '')
              + '</li>';
          }).join('')
        + '</ul></div>';
    }
    if (willSkipRows.length > 0) {
      detailHtml += '<div class="import-update-detail"><strong>No encontrados (se omiten):</strong><ul class="import-update-list">'
        + willSkipRows.map(function(r) { return '<li><span class="mono">' + escapeHtml(r.code) + '</span></li>'; }).join('')
        + '</ul></div>';
    }
    detailHtml += buildExcludedRowsHtml();
    if (bodyEl) bodyEl.innerHTML = detailHtml;
    if (procBtn) { procBtn.disabled = false; procBtn.textContent = 'Procesar importación'; }
    return;
  }

  if (explainEl) {
    explainEl.style.display = 'block';
    explainEl.innerHTML = '<strong>¿Por qué se repiten?</strong> Para guardar un código como clave del sistema, se lo pasa a MAYÚSCULAS y los espacios se convierten en guiones. Dos textos que en el Excel se ven distintos —un espacio de más, mayúscula/minúscula, un guion en otro lugar— pueden terminar en la misma clave. Por eso estas filas quedaron agrupadas: editá el código de la que no corresponda, u omitila.';
  }
  if (summaryEl) {
    var totalRows = conflictGroups.reduce(function(sum, g) { return sum + g.collisionRows.length; }, 0);
    summaryEl.innerHTML = '<strong style="color:#B91C1C">' + conflictGroups.length + ' conflicto(s)</strong> · ' + totalRows + ' filas afectadas — resolvé todas para poder continuar.';
  }

  var html = '';
  conflictGroups.forEach(function(g) {
    html += '<div class="import-conflict-group">'
      + '<div class="import-conflict-group-title">Código en conflicto: <span class="mono">' + escapeHtml(g.normalizedCode) + '</span></div>';
    g.collisionRows.forEach(function(orig) {
      var origName = orig.name || (g.existing ? g.existing.name : '') || '—';
      var meta = escapeHtml(origName)
        + (orig.stock !== undefined ? ' · Cant. ' + orig.stock : '')
        + (orig.price !== undefined ? ' · S/ ' + orig.price.toFixed(2) : '');
      html += '<div class="import-conflict-row">'
        + '<input type="text" class="import-conflict-input" value="' + escapeHtml(orig.code) + '" '
        + 'onchange="updateImportRowCode(' + orig.idx + ', this.value)" title="Código original en el archivo: ' + escapeHtml(orig.originalCode) + ' — editá para que esta fila deje de chocar con la otra">'
        + '<span class="import-conflict-meta">' + meta + '</span>'
        + '<button type="button" class="btn-import-omit" onclick="toggleImportRowExclude(' + orig.idx + ')">Omitir esta fila</button>'
        + '</div>';
    });
    html += '</div>';
  });

  html += buildExcludedRowsHtml();

  if (bodyEl) bodyEl.innerHTML = html;
  if (procBtn) { procBtn.disabled = true; procBtn.textContent = 'Resolvé los conflictos para continuar'; }
}

async function processImportStock() {
  var mode = importStockMode;
  var toCreate = importStockPlan.filter(function(r) { return r.action === 'create'; });
  var toUpdate = importStockPlan.filter(function(r) { return r.action === 'update'; });
  var toUpdateFull = importStockPlan.filter(function(r) { return r.action === 'update-full'; });
  var skipped  = importStockPlan.filter(function(r) { return r.action === 'skip-notfound'; }).length;

  if (toCreate.length === 0 && toUpdate.length === 0 && toUpdateFull.length === 0) {
    var doneMsg = document.getElementById('importStockDoneMsg');
    if (doneMsg) doneMsg.textContent = 'No hay registros nuevos para procesar.';
    showImportStockStep('stepDoneStock');
    return;
  }

  var btn = document.getElementById('btnProcesarImportStock');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

  try {
    var batchSize = 25;
    // Antes: 'both'/'stock'/'price' llamaban a addStock/saveProduct sin
    // try/catch por fila, dentro de un Promise.all. Si UNA fila fallaba
    // (ej. un código raro que se coló, un rebote de Firebase), todo el
    // Promise.all del lote rechazaba y se cortaba la importación entera
    // acá abajo (catch de 'Error al guardar'), dejando los lotes
    // anteriores YA escritos en Firebase pero sin reportar nada de eso.
    // Como el modal quedaba en el paso de conflicto con el botón
    // reactivado, un reintento volvía a sumar stock (addStock es
    // aditivo) sobre filas que ya se habían sumado. Ahora los 4 modos
    // usan el mismo patrón que 'full': try/catch por fila, se sigue con
    // el resto del lote pase lo que pase, y se reporta cuántas fallaron.
    var realCreated = 0, realUpdated = 0, realFailed = 0;
    var failedCodes = [];

    if (mode === 'full') {
      var fullRows = toCreate.concat(toUpdateFull);
      for (var i = 0; i < fullRows.length; i += batchSize) {
        var chunk = fullRows.slice(i, i + batchSize);
        await Promise.all(chunk.map(async function(r) {
          try {
            if (r.action === 'create') {
              // Producto nuevo: no hay stock previo con qué sumar, se
              // crea directo con la cantidad y precio del archivo.
              await saveProduct(r.code, { name: r.name, desc: r.desc || '', price: r.price, stock: r.stock, category: 'general' }, undefined, true);
              realCreated++;
            } else {
              // Producto que YA existe: TODO se reemplaza por lo que
              // trae el archivo — nombre, descripción, precio Y
              // cantidad. Antes la cantidad se SUMABA (vía addStock)
              // en vez de reemplazarse, lo que hacía que re-importar
              // el mismo Excel varias veces (ej. para corregir un
              // precio) fuera acumulando stock de más cada vez. Ahora
              // "Importar todo" es idempotente: importar el mismo
              // archivo 5 veces seguidas deja el mismo resultado que
              // importarlo 1 vez. (Si lo que se quiere es SUMAR una
              // entrega nueva de mercadería, para eso están los modos
              // "Cantidad y precio" / "Solo cantidad", que sí suman.)
              await saveProduct(r.code, { name: r.name, desc: r.desc || '', price: r.price, stock: r.stock, category: (r.existing && r.existing.category) || 'general' });
              realUpdated++;
            }
          } catch (innerErr) {
            realFailed++;
            failedCodes.push(r.code);
          }
        }));
      }
    } else if (mode === 'both') {
      for (var i = 0; i < toUpdate.length; i += batchSize) {
        var chunk = toUpdate.slice(i, i + batchSize);
        await Promise.all(chunk.map(async function(r) {
          try {
            await Promise.all([ addStock(r.code, r.stock), saveProduct(r.code, { price: r.price }) ]);
            realUpdated++;
          } catch (innerErr) {
            realFailed++;
            failedCodes.push(r.code);
          }
        }));
      }
    } else if (mode === 'stock') {
      for (var i = 0; i < toUpdate.length; i += batchSize) {
        var chunk = toUpdate.slice(i, i + batchSize);
        await Promise.all(chunk.map(async function(r) {
          try {
            await addStock(r.code, r.stock);
            realUpdated++;
          } catch (innerErr) {
            realFailed++;
            failedCodes.push(r.code);
          }
        }));
      }
    } else if (mode === 'price') {
      for (var i = 0; i < toUpdate.length; i += batchSize) {
        var chunk = toUpdate.slice(i, i + batchSize);
        await Promise.all(chunk.map(async function(r) {
          try {
            await saveProduct(r.code, { price: r.price });
            realUpdated++;
          } catch (innerErr) {
            realFailed++;
            failedCodes.push(r.code);
          }
        }));
      }
    }

    var parts = [];
    if (realCreated > 0) parts.push(realCreated + ' producto(s) creado(s)');
    if (realUpdated > 0) parts.push(realUpdated + ' producto(s) actualizado(s)');
    if (skipped > 0) parts.push(skipped + ' omitido(s)');
    if (realFailed > 0) {
      parts.push(realFailed + ' con error — no se guardaron (' + failedCodes.slice(0, 5).join(', ') + (failedCodes.length > 5 ? '…' : '') + ')');
    }

    var doneMsg = document.getElementById('importStockDoneMsg');
    if (doneMsg) doneMsg.textContent = (parts.length ? parts.join(', ') : 'Nada para procesar') + '.';
    // Se muestra 'stepDoneStock' pase lo que pase (incluso con fallos
    // parciales), igual que ya hacía 'full'. Esto oculta el botón
    // "Procesar importación" (ver showImportStockStep), así que no
    // queda forma de reintentar sobre el mismo plan y duplicar lo que
    // ya se guardó bien — si algo falló, hay que rehacer la importación
    // con esos códigos.
    showImportStockStep('stepDoneStock');

    if (typeof loadProducts === 'function') {
      loadProducts();
    }
  } catch (err) {
    alert('Error al guardar: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Procesar importación'; }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}