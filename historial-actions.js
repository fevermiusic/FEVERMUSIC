// loadScript() ya está definido en nueva-nota-actions.js — ambos
// archivos conviven en la misma página en la SPA, así que se
// reusa esa misma función en vez de declararla dos veces.

// =========================================================
// Musical Fever — Historial Actions
// Ver nota, compartir (Capacitor), descargar (Capacitor),
// exportar PDF, exportar Excel
// =========================================================

// ── Variables de la nota actual ────────────────────────
let currentNotaNumero = '';
let currentOrderData  = null;

// ── Preguntar qué hacer con el stock al eliminar ───────
// Antes, eliminar SIEMPRE devolvía el stock, asumiendo que toda nota
// borrada fue un error. Pero no es lo mismo "me equivoqué de
// cliente" que "hice clic en Eliminar sin querer sobre una venta que
// sí ocurrió de verdad" — en ese segundo caso, devolver el stock
// automáticamente sería el error contrario: inflar el inventario por
// una venta real. Por eso ahora se pregunta explícitamente, en vez
// de asumir. Para simples correcciones de datos (cliente, cantidad,
// precio) sigue existiendo "Editar" — eliminar es solo para cuando
// la nota en sí no debe seguir existiendo.
// Devuelve una Promise que resuelve a: 'restore' | 'keep' | null (canceló)
function askDeleteStockMode(numero, count) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.style.zIndex = '9999';
    const label = count > 1 ? `${count} notas seleccionadas` : `la nota ${numero}`;
    overlay.innerHTML = `
      <div class="modal delete-choice-modal" style="max-width:460px">
        <div class="dcm-header">
          <span class="dcm-icon-wrap" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>
          </span>
          <div class="dcm-header-text">
            <h3 class="dcm-title">Eliminar ${escapeHtml(label)}</h3>
            <p class="dcm-subtitle">Esto decide qué pasa con el stock de los productos.</p>
          </div>
        </div>
        <div class="dcm-options">
          <button type="button" class="dcm-option" id="btnDelRestore">
            <span class="dcm-option-icon dcm-option-icon--restore" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
            </span>
            <span class="dcm-option-text">
              <span class="dcm-option-title">Fue un error</span>
              <span class="dcm-option-desc">Cliente equivocado, nota duplicada, etc. El stock vuelve al inventario.</span>
            </span>
          </button>
          <button type="button" class="dcm-option" id="btnDelKeep">
            <span class="dcm-option-icon dcm-option-icon--keep" aria-hidden="true">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></svg>
            </span>
            <span class="dcm-option-text">
              <span class="dcm-option-title">La venta sí ocurrió</span>
              <span class="dcm-option-desc">Solo se quita el registro. El stock no se toca.</span>
            </span>
          </button>
        </div>
        <button type="button" class="dcm-cancel" id="btnDelCancel">Cancelar</button>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    function cleanup(result) {
      overlay.remove();
      document.body.style.overflow = '';
      resolve(result);
    }
    overlay.querySelector('#btnDelRestore').onclick = () => cleanup('restore');
    overlay.querySelector('#btnDelKeep').onclick    = () => cleanup('keep');
    overlay.querySelector('#btnDelCancel').onclick  = () => cleanup(null);
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(null); });
  });
}

// ── Ver nota ───────────────────────────────────────────
function verNota(orderId) {
  const o = ordersCache.find(x => x.id === orderId);
  if (!o) return;
  currentNotaNumero = o.numero;
  currentOrderData  = o;


  document.getElementById('vNotaNum').textContent  = o.numero;
  document.getElementById('vFecha').textContent    = o.fecha;
  document.getElementById('vHora').textContent     = o.hora;
  document.getElementById('vNombre').textContent   = o.cliente;
  document.getElementById('vRuc').textContent      = o.ruc;

  const vendedorRow = document.getElementById('vVendedorRow');
  if (o.creadoPor && o.creadoPor.nombre) {
    document.getElementById('vVendedor').textContent = o.creadoPor.nombre;
    vendedorRow.style.display = '';
  } else {
    vendedorRow.style.display = 'none';
  }

  const items = o.items || [];
  document.getElementById('vBody').innerHTML = items.map(item => {
    const subtotal = item.price * item.qty;
    return `
      <tr>
        <td data-label="Código" style="font-family:monospace;font-size:11px;color:#64748b">${escapeHtml(item.code)}</td>
        <td data-label="Producto" style="font-size:12.5px;font-weight:500">${escapeHtml(item.name)}${item.desc ? `<div style="font-size:11px;font-weight:400;color:#94a3b8;margin-top:2px">${escapeHtml(item.desc)}</div>` : ''}</td>
        <td class="right" data-label="P. Unit." style="font-family:monospace;font-size:12.5px"><span class="curr">S/ </span>${fmt(item.price)}</td>
        <td class="right" data-label="Cant." style="font-family:monospace;font-size:12.5px">${item.qty}</td>
        <td class="right" data-label="Desc. %" style="font-family:monospace;font-size:12.5px;color:${item.itemDiscountPct ? '#059669' : '#94a3b8'}">${item.itemDiscountPct ? `−${item.itemDiscountPct}%` : '—'}</td>
        <td class="right" data-label="Subtotal" style="font-family:monospace;font-size:12.5px;font-weight:600"><span class="curr">S/ </span>${fmt(subtotal)}</td>
      </tr>
    `;
  }).join('');

  let totalsHtml = `<div class="print-total-row"><span>Subtotal</span><span>S/ ${fmt(o.subtotal)}</span></div>`;
  if (o.descuentoPct > 0) {
    const discAmt = o.subtotal * (o.descuentoPct / 100);
    totalsHtml += `<div class="print-total-row" style="color:#059669"><span>Descuento (${o.descuentoPct}%)</span><span>−S/ ${fmt(discAmt)}</span></div>`;
  }
  totalsHtml += `<div class="print-total-row final"><span>TOTAL</span><span style="color:#2563EB">S/ ${fmt(o.total)}</span></div>`;
  document.getElementById('vTotals').innerHTML = totalsHtml;

  document.getElementById('verModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeVerModal() {
  const modal = document.getElementById('verModal');
  if (!modal) return; // la vista de Historial no está montada ahora mismo
  modal.classList.remove('open');
  document.body.style.overflow = '';
  const menu = document.getElementById('downloadMenu');
  if (menu) menu.classList.remove('open');
}

function outsideCloseVer(e) {
  if (e.target === document.getElementById('verModal')) closeVerModal();
}

// ── Eliminar nota (admin y vendedor) ────────────────────
function deleteCurrentNota() {
  if (!currentOrderData) return;
  const o = currentOrderData;

  askDeleteStockMode(o.numero, 1).then(mode => {
    if (!mode) return; // canceló, no se borra nada

    const itemsToRestore = mode === 'restore' ? o.items : null;

    deleteOrder(o.id, itemsToRestore).then(() => {
      ordersCache    = ordersCache.filter(x => x.id !== o.id);
      filteredOrders = filteredOrders.filter(x => x.id !== o.id);
      closeVerModal();
      if (typeof applyFilters === 'function') applyFilters();
    }).catch(err => {
      console.error('[Historial] Error eliminando nota:', err);
      alert('No se pudo eliminar la nota. Intenta de nuevo.');
    });
  });
}

// ── Editar nota (admin y vendedor) ─────────────────────
// Reusa la vista de "Nueva Nota" pero precargada con los datos de
// la nota existente. NuevaNota.init() detecta editOrderId en los
// parámetros y cambia a modo edición (ver nueva-nota-logic.js).
function editNota() {
  if (!currentOrderData) return;
  const o = currentOrderData;
  closeVerModal();
  const params = {
    ruc:          o.ruc,
    nombre:       o.cliente,
    editOrderId:  o.id,
    editNumero:   o.numero,
    editFecha:    o.fecha,
    editHora:     o.hora,
    editItems:    (o.items || []).map(i => ({ code: i.code, name: i.name, desc: i.desc || '', price: i.price, qty: i.qty, itemDiscountPct: i.itemDiscountPct || 0 })),
    editDiscount: o.descuentoPct || 0,
    editCount:    o.editCount || 0
  };
  if (window.Router) {
    Router.go('nueva-nota', { params });
  } else {
    alert('Editar notas solo está disponible dentro de la app (SPA).');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeVerModal();
});

// ── helpers canvas / Capacitor ────────────────────────
// NOTA: ya no se usa html2canvas para el PDF. El PDF ahora se
// dibuja directamente con pdf-lib (texto, líneas y formas reales,
// no una imagen rasterizada), lo que además es mucho más rápido
// en WebViews de Android (Capacitor) que renderizar un canvas.
async function captureNota() {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  const el = document.querySelector('#verModal .ver-modal-content');
  return html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
}

function setActionsLoading(loading) {
  ['btnShareNota','btnDownloadNota'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = loading;
  });
}

function isCapacitor() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function getCapacitorPlugins() {
  const p = (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : {};
  return { Share: p.Share || null, Filesystem: p.Filesystem || null, Directory: p.Directory || null };
}

// ── Descarga robusta para navegador (escritorio Y móvil) ──
// Usa Blob + Object URL en vez de toDataURL/XLSX.writeFile
// directos, que en algunos navegadores móviles (Chrome Android,
// Safari iOS) no disparan la descarga de forma confiable.
function downloadBlob(blob, fileName) {
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = fileName;
  link.rel      = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Liberar el Object URL un poco después para no romper la descarga en curso
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
}

// ── Carga pdf-lib desde CDN si aún no está disponible ────
function ensurePDFLibLoaded() {
  if (window.PDFLib) { patchPDFLibTextEncoding(); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
    s.onload  = () => { patchPDFLibTextEncoding(); resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Sanea texto para la fuente WinAnsi (Helvetica estándar) ──
// WinAnsi/Windows-1252 no cubre todo Unicode: caracteres como la barra
// de fracción "⁄" (U+2044, distinta de la barra normal "/"), comillas
// tipográficas, guiones largos, etc. rompen pdf-lib con el error
// "WinAnsi cannot encode ...". Por ejemplo "4⁄4" (tamaño de violín)
// puede colarse así al escribir en el celular con autocorrección.
// Esta función normaliza los casos comunes y, como red de seguridad,
// reemplaza cualquier caracter restante fuera de WinAnsi por "?", para
// que el PDF nunca vuelva a fallar sin importar qué escriba el usuario.
function sanitizeForPdf(input) {
  if (input === null || input === undefined) return '';
  let str = String(input);
  const map = {
    '\u2044': '/', '\u2215': '/',              // barras de fracción/división -> /
    '\u2212': '-', '\u2013': '-', '\u2014': '-', // signos menos/guiones -> -
    '\u2018': "'", '\u2019': "'",                // comillas simples tipográficas
    '\u201C': '"', '\u201D': '"',                // comillas dobles tipográficas
    '\u2026': '...',                             // puntos suspensivos
    '\u00A0': ' ',                               // espacio de no separación
    '\u2022': '-'                                // viñeta
  };
  str = str.replace(/[\u2044\u2215\u2212\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u00A0\u2022]/g, ch => map[ch]);
  return str.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

// Parchea pdf-lib una sola vez para que TODO drawText/widthOfTextAtSize
// pase por sanitizeForPdf automáticamente, sin tener que tocar cada
// llamada individual (ni las futuras que se agreguen).
let _pdfLibPatched = false;
function patchPDFLibTextEncoding() {
  if (_pdfLibPatched || !window.PDFLib || !window.PDFLib.PDFPage || !window.PDFLib.PDFFont) return;
  const PDFPageProto = window.PDFLib.PDFPage.prototype;
  const PDFFontProto = window.PDFLib.PDFFont.prototype;

  const origDrawText = PDFPageProto.drawText;
  PDFPageProto.drawText = function (text, options) {
    return origDrawText.call(this, sanitizeForPdf(text), options);
  };

  const origWidthOf = PDFFontProto.widthOfTextAtSize;
  PDFFontProto.widthOfTextAtSize = function (text, size) {
    return origWidthOf.call(this, sanitizeForPdf(text), size);
  };

  _pdfLibPatched = true;
}

// ── Construye el PDF de la nota dibujando texto y formas reales ──
// (no es una imagen: el texto es seleccionable/copiable, como un
// documento exportado de Word/PowerPoint). Esto además es mucho
// más rápido que rasterizar con html2canvas, especialmente en
// WebViews de Android (Capacitor).
async function captureNotaAsPdf() {
  if (!currentOrderData) throw new Error('No hay datos de la nota');
  const o = currentOrderData;
  await ensurePDFLibLoaded();

  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Colores (mismos tonos que el diseño en pantalla)
  const cInk    = rgb(0x0B/255, 0x11/255, 0x20/255);
  const cGray   = rgb(0x64/255, 0x74/255, 0x8B/255);
  const cGrayLt = rgb(0x94/255, 0xA3/255, 0xB8/255);
  const cBlue   = rgb(0x25/255, 0x63/255, 0xEB/255);
  const cBorder = rgb(0xE2/255, 0xE8/255, 0xF4/255);
  const cBg     = rgb(0xF7/255, 0xF9/255, 0xFC/255);
  const cBgHead = rgb(0xF0/255, 0xF3/255, 0xF9/255);
  const cGreen  = rgb(0x05/255, 0x96/255, 0x69/255);

  // A4 en puntos
  const pageWidth  = 595.28;
  const pageHeight = 841.89;
  const margin     = 44;
  const contentW   = pageWidth - margin * 2;
  const bottomLimit = 90; // no dibujar productos por debajo de este límite

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function drawRightTextOn(pg, text, rightX, yPos, size, fnt, color) {
    const w = fnt.widthOfTextAtSize(text, size);
    pg.drawText(text, { x: rightX - w, y: yPos, size, font: fnt, color });
  }

  // ── Logo (si está disponible en el DOM) embebido como PNG real ──
  const logoImg = document.querySelector('#verModal .print-header img');
  let logoDims = null, logoImage = null;
  if (logoImg && logoImg.src && logoImg.src.startsWith('data:image/png')) {
    try {
      const base64 = logoImg.src.split(',')[1];
      const bytes  = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      logoImage = await pdfDoc.embedPng(bytes);
      const targetH = 70; // antes 44 — logo aún más grande en el header del PDF
      const scale   = targetH / logoImage.height;
      logoDims = { width: logoImage.width * scale, height: targetH };
    } catch (e) { /* si falla, simplemente no se dibuja el logo */ }
  }

  // ── Header: logo a la izquierda, datos de la nota a la derecha ──
  if (logoImage && logoDims) {
    page.drawImage(logoImage, { x: margin, y: y - logoDims.height, width: logoDims.width, height: logoDims.height });
    page.drawText('Sistema de Gestion de Pedidos', {
      x: margin, y: y - logoDims.height - 14, size: 8.5, font, color: cGrayLt
    });
  } else {
    page.drawText('Musical Fever', { x: margin, y: y - 16, size: 16, font: fontBold, color: cInk });
    page.drawText('Sistema de Gestion de Pedidos', { x: margin, y: y - 30, size: 8.5, font, color: cGrayLt });
  }

  const notaNumStr = o.numero || '';
  drawRightTextOn(page, notaNumStr, pageWidth - margin, y - 12, 12.5, fontBold, cBlue);
  const fechaStr = `Fecha: ${o.fecha || ''}  -  ${o.hora || ''}`;
  drawRightTextOn(page, fechaStr, pageWidth - margin, y - 26, 9, font, cGray);

  y -= 96; // antes 70 — ajustado para el logo más grande (targetH 60)

  // ── Caja de cliente ──
  const boxH = 52;
  page.drawRectangle({ x: margin, y: y - boxH, width: contentW, height: boxH, color: cBg });
  page.drawText('CLIENTE', { x: margin + 14, y: y - 18, size: 8, font: fontBold, color: cGrayLt });
  page.drawText(o.cliente || '-', { x: margin + 14, y: y - 33, size: 12, font: fontBold, color: cInk });
  page.drawText(`RUC: ${o.ruc || '-'}`, { x: margin + 14, y: y - 45, size: 9.5, font, color: cGray });
  y -= boxH + 22;

  // ── Tabla de productos ──
  const items = o.items || [];

  // El ancho de la columna CODIGO era fijo (64pt), pero códigos largos
  // (ej. "FV3910CAM-SE") ocupan más que eso a tamaño 8.5 y el texto del
  // producto empezaba a dibujarse encima, superponiéndose y dando una
  // sensación poco profesional. Ahora se mide el código más ancho de
  // ESTA nota y la columna Producto arranca después, con un margen de
  // aire fijo — nunca se solapan sin importar qué tan largo sea el código.
  const codeFontSize = 8.5;
  const codeGap      = 14;
  let maxCodeW = 0;
  items.forEach(item => {
    const w = font.widthOfTextAtSize(String(item.code || ''), codeFontSize);
    if (w > maxCodeW) maxCodeW = w;
  });

  const colCodeX  = margin;
  const colProdX  = Math.max(margin + 64, colCodeX + 6 + maxCodeW + codeGap);
  const colPUnitR = margin + contentW - 190;
  const colCantR  = margin + contentW - 130;
  const colDiscR  = margin + contentW - 78;
  const colSubR   = margin + contentW;
  const rowH      = 22;
  const prodMaxW  = colPUnitR - colProdX - 55;

  function drawTableHeader(pg, yTop) {
    pg.drawRectangle({ x: margin, y: yTop - 20, width: contentW, height: 20, color: cBgHead });
    pg.drawText('CODIGO',   { x: colCodeX + 6, y: yTop - 14, size: 7.5, font: fontBold, color: cGray });
    pg.drawText('PRODUCTO', { x: colProdX,     y: yTop - 14, size: 7.5, font: fontBold, color: cGray });
    drawRightTextOn(pg, 'P. UNIT.', colPUnitR, yTop - 14, 7.5, fontBold, cGray);
    drawRightTextOn(pg, 'CANT.',    colCantR,  yTop - 14, 7.5, fontBold, cGray);
    drawRightTextOn(pg, 'DESC. %',  colDiscR,  yTop - 14, 7.5, fontBold, cGray);
    drawRightTextOn(pg, 'SUBTOTAL', colSubR,   yTop - 14, 7.5, fontBold, cGray);
    return yTop - 20;
  }

  // Envuelve el nombre del producto en varias líneas si es muy largo
  function wrapText(text, maxWidth, fnt, size) {
    const words = String(text || '').split(' ');
    const lines = [];
    let line = '';
    words.forEach(word => {
      const test = line ? `${line} ${word}` : word;
      if (fnt.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  y = drawTableHeader(page, y);

  for (const item of items) {
    const subtotal  = (item.price || 0) * (item.qty || 0);
    const nameLines = wrapText(item.name, prodMaxW, font, 9.5);
    const descLines = item.desc ? wrapText(item.desc, prodMaxW, font, 8) : [];
    const lineH     = 12;
    const descLineH = 10.5;
    const descGap   = descLines.length ? 3 : 0;
    const textBlockH = nameLines.length * lineH + descGap + descLines.length * descLineH;
    const cellH     = Math.max(rowH, textBlockH + 8);

    // Si no cabe en la página actual, crea una nueva página y repite el header
    if (y - cellH < bottomLimit) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      y = drawTableHeader(page, y);
    }

    const textY = y - 14;
    page.drawText(item.code || '', { x: colCodeX + 6, y: textY, size: 8.5, font, color: cGray });
    nameLines.forEach((line, i) => {
      page.drawText(line, { x: colProdX, y: textY - (i * lineH), size: 9.5, font, color: cInk });
    });
    descLines.forEach((line, i) => {
      page.drawText(line, {
        x: colProdX,
        y: textY - (nameLines.length * lineH) - descGap - (i * descLineH),
        size: 8, font, color: cGrayLt
      });
    });
    drawRightTextOn(page, `S/ ${fmt(item.price)}`, colPUnitR, textY, 9, font, cGray);
    drawRightTextOn(page, String(item.qty || 0), colCantR, textY, 9, font, cGray);
    if (item.itemDiscountPct) {
      drawRightTextOn(page, `-${item.itemDiscountPct}%`, colDiscR, textY, 9, font, cGreen);
    } else {
      drawRightTextOn(page, '—', colDiscR, textY, 9, font, cGrayLt);
    }
    drawRightTextOn(page, `S/ ${fmt(subtotal)}`, colSubR, textY, 9.5, fontBold, cInk);

    page.drawLine({
      start: { x: margin, y: y - cellH },
      end:   { x: margin + contentW, y: y - cellH },
      thickness: 0.75, color: cBorder
    });

    y -= cellH;
  }

  // Si los totales no caben debajo de la tabla, pasa a una nueva página
  const totalsBlockH = 70;
  if (y - totalsBlockH < margin) {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  } else {
    y -= 20;
  }

  // ── Totales ──
  const totalsX = margin + contentW - 220;
  let ty = y;

  page.drawText('Subtotal', { x: totalsX, y: ty, size: 9.5, font, color: cGray });
  drawRightTextOn(page, `S/ ${fmt(o.subtotal)}`, margin + contentW, ty, 9.5, font, cGray);
  ty -= 16;

  if (o.descuentoPct > 0) {
    const discAmt = (o.subtotal || 0) * (o.descuentoPct / 100);
    page.drawText(`Descuento (${o.descuentoPct}%)`, { x: totalsX, y: ty, size: 9.5, font, color: cGreen });
    drawRightTextOn(page, `-S/ ${fmt(discAmt)}`, margin + contentW, ty, 9.5, font, cGreen);
    ty -= 16;
  }

  page.drawLine({ start: { x: totalsX, y: ty + 6 }, end: { x: margin + contentW, y: ty + 6 }, thickness: 0.75, color: cBorder });
  ty -= 10;
  page.drawText('TOTAL', { x: totalsX, y: ty, size: 12.5, font: fontBold, color: cInk });
  drawRightTextOn(page, `S/ ${fmt(o.total)}`, margin + contentW, ty, 12.5, fontBold, cBlue);

  // ── Footer (en todas las páginas generadas) ──
  const footerStr = 'Musical Fever - Sistema interno de pedidos';
  const footerW   = font.widthOfTextAtSize(footerStr, 8);
  pdfDoc.getPages().forEach(pg => {
    pg.drawText(footerStr, { x: (pageWidth - footerW) / 2, y: margin / 2, size: 8, font, color: cGrayLt });
  });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

// ── Menú de selección de formato de descarga (PDF / Excel) ──
function toggleDownloadMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('downloadMenu');
  menu.classList.toggle('open');
}
document.addEventListener('click', e => {
  const menu = document.getElementById('downloadMenu');
  const btn  = document.getElementById('btnDownloadNota');
  if (menu && menu.classList.contains('open') && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    menu.classList.remove('open');
  }
});

// ── Descargar nota como PDF o Excel (Capacitor / web) ────────
async function downloadNotaAs(tipo) {
  if (!currentOrderData) return;
  document.getElementById('downloadMenu').classList.remove('open');
  setActionsLoading(true);
  try {
    if (tipo === 'pdf') {
      const pdfBlob  = await captureNotaAsPdf();
      const fileName = `nota-pedido-${currentNotaNumero}.pdf`;
      if (isCapacitor()) {
        const { Filesystem, Directory } = getCapacitorPlugins();
        if (!Filesystem) { alert('El plugin Filesystem no está disponible. Ejecuta "npx cap sync".'); return; }
        const base64 = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(pdfBlob);
        });
        const dir = Directory ? Directory.Documents : 'DOCUMENTS';
        await Filesystem.writeFile({ path: fileName, data: base64, directory: dir, recursive: true });
        alert(`✓ PDF guardado en Documentos:\n${fileName}`);
      } else {
        downloadBlob(pdfBlob, fileName);
      }
    } else {
      const o = currentOrderData;
      await ensureXLSXLoaded();

      const rows = [
        ['Musical Fever — Nota de Pedido'],
        [],
        ['N° Nota', o.numero],
        ['Fecha', o.fecha],
        ['Hora', o.hora],
        ['Cliente', sanitizeForExcel(o.cliente)],
        ['RUC', o.ruc],
        [],
        ['Código', 'Producto', 'P. Unit.', 'Cant.', 'Desc. %', 'Subtotal']
      ];

      (o.items || []).forEach(item => {
        rows.push([sanitizeForExcel(item.code), sanitizeForExcel(item.name), item.price || 0, item.qty || 0, item.itemDiscountPct || 0, (item.price || 0) * (item.qty || 0)]);
      });

      rows.push([]);
      rows.push(['', '', '', '', 'Subtotal', o.subtotal || 0]);
      if (o.descuentoPct > 0) {
        const discAmt = (o.subtotal || 0) * (o.descuentoPct / 100);
        rows.push(['', '', '', '', `Descuento (${o.descuentoPct}%)`, -discAmt]);
      }
      rows.push(['', '', '', '', 'TOTAL', o.total || 0]);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 12 }, { wch: 32 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Nota');

      const fileName = `nota-pedido-${currentNotaNumero}.xlsx`;
      await saveWorkbook(wb, fileName, `✓ Excel guardado en Documentos:\n${fileName}`);
    }
  } catch (err) {
    alert(`No se pudo generar el ${tipo === 'pdf' ? 'PDF' : 'Excel'}: ` + (err && err.message ? err.message : 'error desconocido'));
  } finally {
    setActionsLoading(false);
  }
}

// ── Compartir nota como PDF (Capacitor / web) ────────
async function shareNota() {
  setActionsLoading(true);
  try {
    const pdfBlob  = await captureNotaAsPdf();
    const fileName = `nota-pedido-${currentNotaNumero}.pdf`;

    if (isCapacitor()) {
      const { Share, Filesystem, Directory } = getCapacitorPlugins();
      if (!Share || !Filesystem) {
        alert('Los plugins Share o Filesystem no están disponibles. Ejecuta "npx cap sync".');
        return;
      }
      const base64 = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(pdfBlob);
      });
      const cacheDir  = Directory ? Directory.Cache : 'CACHE';
      await Filesystem.writeFile({ path: fileName, data: base64, directory: cacheDir, recursive: true });
      const uriResult = await Filesystem.getUri({ path: fileName, directory: cacheDir });
      await Share.share({
        title:       `Nota de Pedido ${currentNotaNumero}`,
        text:        `Nota de Pedido ${currentNotaNumero} — Musical Fever`,
        url:         uriResult.uri,
        dialogTitle: 'Compartir nota de pedido'
      });
    } else {
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
      const canShareFiles = navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share;
      if (canShareFiles) {
        await navigator.share({ files: [file], title: `Nota de Pedido ${currentNotaNumero}`, text: 'Musical Fever' });
      } else {
        downloadBlob(pdfBlob, fileName);
        alert('El PDF fue descargado. Ábrelo desde Descargas para enviarlo por WhatsApp u otra app.');
      }
    }
  } catch (err) {
    const msg = (err && err.message) ? err.message : '';
    const isCancel = (err && err.name === 'AbortError') || /share\s*canceled/i.test(msg);
    if (!isCancel) {
      alert('No se pudo compartir: ' + (msg || 'error desconocido'));
    }
  } finally {
    setActionsLoading(false);
  }
}

// ── Exportar PDF (reporte completo del historial filtrado) ──
// Dibuja el reporte directamente con pdf-lib (texto y tabla reales,
// no una imagen), con paginación automática si hay muchas notas.
async function exportPDF() {
  if (filteredOrders.length === 0) { alert('No hay registros para exportar.'); return; }

  try {
    await ensurePDFLibLoaded();
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const pdfDoc   = await PDFDocument.create();
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const cInk    = rgb(0x0B/255, 0x11/255, 0x20/255);
    const cGray   = rgb(0x64/255, 0x74/255, 0x8B/255);
    const cGrayLt = rgb(0x94/255, 0xA3/255, 0xB8/255);
    const cBlue   = rgb(0x25/255, 0x63/255, 0xEB/255);
    const cBorder = rgb(0xE2/255, 0xE8/255, 0xF4/255);
    const cBgHead = rgb(0xF0/255, 0xF3/255, 0xF9/255);
    const cRowAlt = rgb(0xF7/255, 0xF9/255, 0xFC/255);

    const pageWidth  = 841.89; // A4 apaisado, más cómodo para una tabla de 5 columnas
    const pageHeight = 595.28;
    const margin     = 40;
    const contentW   = pageWidth - margin * 2;
    const bottomLimit = 60;

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    function drawRightTextOn(pg, text, rightX, yPos, size, fnt, color) {
      const w = fnt.widthOfTextAtSize(text, size);
      pg.drawText(text, { x: rightX - w, y: yPos, size, font: fnt, color });
    }

    function drawDocHeader(pg, yTop) {
      pg.drawText('Reporte de Historial', { x: margin, y: yTop - 16, size: 16, font: fontBold, color: cInk });
      pg.drawText(`Musical Fever - ${filteredOrders.length} notas`, { x: margin, y: yTop - 32, size: 10, font, color: cGray });
      const genStr = `Generado: ${new Date().toLocaleString('es-PE')}`;
      drawRightTextOn(pg, genStr, margin + contentW, yTop - 16, 9, font, cGrayLt);
      return yTop - 50;
    }

    // Columnas (ancho total = contentW)
    const colNotaX  = margin;
    const colCliX   = margin + 90;
    const colRucX   = margin + 330;
    const colFechaX = margin + 470;
    const colTotalR = margin + contentW;

    function drawTableHeader(pg, yTop) {
      pg.drawRectangle({ x: margin, y: yTop - 22, width: contentW, height: 22, color: cBgHead });
      pg.drawText('N° NOTA',  { x: colNotaX + 8,  y: yTop - 15, size: 8.5, font: fontBold, color: cGray });
      pg.drawText('CLIENTE',  { x: colCliX,       y: yTop - 15, size: 8.5, font: fontBold, color: cGray });
      pg.drawText('RUC',      { x: colRucX,       y: yTop - 15, size: 8.5, font: fontBold, color: cGray });
      pg.drawText('FECHA',    { x: colFechaX,     y: yTop - 15, size: 8.5, font: fontBold, color: cGray });
      drawRightTextOn(pg, 'TOTAL', colTotalR - 8, yTop - 15, 8.5, fontBold, cGray);
      return yTop - 22;
    }

    y = drawDocHeader(page, y);
    y = drawTableHeader(page, y);

    const rowH = 24;
    filteredOrders.forEach((o, i) => {
      if (y - rowH < bottomLimit) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
        y = drawTableHeader(page, y);
      }
      if (i % 2 === 1) {
        page.drawRectangle({ x: margin, y: y - rowH, width: contentW, height: rowH, color: cRowAlt });
      }
      const textY = y - 16;
      page.drawText(o.numero || '', { x: colNotaX + 8, y: textY, size: 9, font: fontBold, color: cBlue });
      page.drawText(String(o.cliente || '').slice(0, 38), { x: colCliX, y: textY, size: 9, font, color: cInk });
      page.drawText(o.ruc || '', { x: colRucX, y: textY, size: 8.5, font, color: cGray });
      page.drawText(o.fecha || '', { x: colFechaX, y: textY, size: 9, font, color: cGray });
      drawRightTextOn(page, `S/ ${fmt(o.total)}`, colTotalR - 8, textY, 9.5, fontBold, cInk);

      page.drawLine({
        start: { x: margin, y: y - rowH },
        end:   { x: margin + contentW, y: y - rowH },
        thickness: 0.5, color: cBorder
      });
      y -= rowH;
    });

    // Total general
    const grandTotal = Math.round(filteredOrders.reduce((s, o) => s + (o.total || 0), 0) * 100) / 100;
    if (y - 40 < bottomLimit) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    } else {
      y -= 22;
    }
    page.drawText('Total general', { x: margin + contentW - 220, y, size: 11, font: fontBold, color: cInk });
    drawRightTextOn(page, `S/ ${fmt(grandTotal)}`, margin + contentW, y, 12.5, fontBold, cBlue);

    const footerStr = 'Musical Fever - Sistema interno de pedidos';
    const footerW   = font.widthOfTextAtSize(footerStr, 8);
    pdfDoc.getPages().forEach(pg => {
      pg.drawText(footerStr, { x: (pageWidth - footerW) / 2, y: margin / 2, size: 8, font, color: cGrayLt });
    });

    const pdfBytes = await pdfDoc.save();
    const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
    const fileName = `reporte-historial-${new Date().toISOString().slice(0,10)}.pdf`;

    if (isCapacitor()) {
      const { Filesystem, Directory } = getCapacitorPlugins();
      if (Filesystem) {
        const base64 = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        });
        const dir = Directory ? Directory.Documents : 'DOCUMENTS';
        await Filesystem.writeFile({ path: fileName, data: base64, directory: dir, recursive: true });
        alert(`✓ Reporte guardado en Documentos:\n${fileName}`);
      } else {
        alert('El plugin Filesystem no está disponible. Ejecuta "npx cap sync".');
      }
    } else {
      downloadBlob(blob, fileName);
    }
  } catch (err) {
    alert('No se pudo exportar el PDF: ' + (err && err.message ? err.message : 'error'));
  }
}

// ── Carga SheetJS desde CDN si aún no está disponible ────
function ensureXLSXLoaded() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Guarda un workbook de SheetJS como .xlsx (Capacitor / web) ──
async function saveWorkbook(wb, fileName, successMsg) {
  if (isCapacitor()) {
    const { Filesystem, Directory } = getCapacitorPlugins();
    if (Filesystem) {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const dir   = Directory ? Directory.Documents : 'DOCUMENTS';
      await Filesystem.writeFile({ path: fileName, data: wbout, directory: dir, recursive: true });
      alert(successMsg);
    } else {
      alert('El plugin Filesystem no está disponible. Ejecuta "npx cap sync".');
    }
  } else {
    // Generamos el binario nosotros mismos (array) y lo bajamos con
    // downloadBlob en vez de XLSX.writeFile, que en algunos navegadores
    // móviles (Chrome/Safari Android-iOS, WebViews) no dispara la
    // descarga de forma confiable.
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob  = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, fileName);
  }
}

// =========================================================
// Selección múltiple (reutiliza selection.js, mismo patrón que
// Stock y Pedidos) + exportar solo las notas seleccionadas.
// =========================================================
let selectedHistIds = new Set();

const histSelection = createSelectionMode({
  containers: ['.table-wrap table'],
  buttonId: 'btnSelectMode',
  labelId: 'selectModeLabel',
  onExit: () => {
    document.querySelectorAll('.hist-check').forEach(cb => { cb.checked = false; });
    const master = document.getElementById('checkAllHist');
    if (master) master.checked = false;
    updateBulkHist();
  }
});

function toggleHistSelectionMode() { histSelection.toggle(); }

function onHistCheckToggle(cb) {
  updateBulkHist();
}

function toggleAllHist(master) {
  if (master.checked) histSelection.set(true);
  document.querySelectorAll('.hist-check').forEach(cb => {
    if (cb.closest('tr').style.display !== 'none') cb.checked = master.checked;
  });
  updateBulkHist();
}

// Botón "Seleccionar todo" del bulk-bar (marca solo lo cargado en
// pantalla — si hay más notas con scroll infinito, hay que bajar
// más para que se incluyan también).
function selectAllHist() {
  document.querySelectorAll('.hist-check').forEach(cb => {
    if (cb.closest('tr').style.display !== 'none') cb.checked = true;
  });
  const master = document.getElementById('checkAllHist');
  if (master) master.checked = true;
  updateBulkHist();
}

function updateBulkHist() {
  selectedHistIds.clear();
  document.querySelectorAll('.hist-check:checked').forEach(cb => {
    selectedHistIds.add(cb.dataset.id);
    cb.closest('tr').classList.add('row-selected');
  });
  document.querySelectorAll('.hist-check:not(:checked)').forEach(cb => {
    cb.closest('tr').classList.remove('row-selected');
  });
  const bar = document.getElementById('bulkBarHist');
  if (bar) bar.classList.toggle('visible', histSelection.isOn());
  const count = document.getElementById('bulkCountHist');
  if (count) count.textContent = selectedHistIds.size + ' seleccionada' + (selectedHistIds.size !== 1 ? 's' : '');
}

// ── Eliminar SOLO las notas seleccionadas (exclusivo admin) ──
// La barra de selección masiva ya está oculta para vendedor
// (applyHistorialRoleRestrictions), pero se valida el rol también
// aquí por seguridad extra.
async function deleteSelectedHist() {
  if (typeof isAdmin === 'function' && !isAdmin()) return;
  if (selectedHistIds.size === 0) { alert('Selecciona al menos una nota.'); return; }

  const count = selectedHistIds.size;
  const mode = await askDeleteStockMode(null, count);
  if (!mode) return; // canceló, no se borra nada

  const ids = Array.from(selectedHistIds);
  try {
    await Promise.all(ids.map(id => {
      const order = ordersCache.find(o => o.id === id);
      const itemsToRestore = mode === 'restore' ? (order ? order.items : null) : null;
      return deleteOrder(id, itemsToRestore);
    }));
  } catch (err) {
    console.error('[Historial] Error eliminando notas seleccionadas:', err);
    alert('Ocurrió un error eliminando algunas notas. Revisa el historial e intenta de nuevo.');
  }

  ordersCache    = ordersCache.filter(o => !selectedHistIds.has(o.id));
  filteredOrders = filteredOrders.filter(o => !selectedHistIds.has(o.id));
  selectedHistIds.clear();
  histSelection.toggle(); // sale del modo selección (dispara onExit → limpia checkboxes/bar)
  if (typeof applyFilters === 'function') applyFilters();
}

// ── Exportar SOLO las notas seleccionadas ───────────────
async function exportSelectedExcel() {
  if (selectedHistIds.size === 0) { alert('Selecciona al menos una nota.'); return; }
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  await ensureXLSXLoaded();

  const rows = [
    ['N° Nota', 'Cliente', 'RUC', 'Fecha', 'Hora', 'Subtotal', 'Descuento %', 'Total']
  ];
  ordersCache
    .filter(o => selectedHistIds.has(o.id))
    .forEach(o => {
      rows.push([sanitizeForExcel(o.numero), sanitizeForExcel(o.cliente), o.ruc, o.fecha, o.hora, o.subtotal || 0, o.descuentoPct || 0, o.total || 0]);
    });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historial');

  const fileName = `notas-seleccionadas-${new Date().toISOString().slice(0,10)}.xlsx`;
  await saveWorkbook(wb, fileName, `✓ Excel guardado en Documentos:\n${fileName}`);
}

// ── Exportar Excel (.xlsx via SheetJS CDN) ───────────
// NOTA: se llama exportHistorialExcel (no exportExcel a secas) porque
// nueva-nota-actions.js define su PROPIA función global exportExcel()
// para exportar el carrito de "Nueva Nota". Como ambos archivos son
// <script> normales (no módulos), ambas funciones viven en el mismo
// scope global — y como nueva-nota-actions.js se carga DESPUÉS de
// historial-actions.js en index.html, su exportExcel() sobrescribía
// silenciosamente a esta, y el botón "Exportar Excel" de Historial
// terminaba ejecutando la lógica de Nueva Nota (que revisa `items`,
// el carrito, no `filteredOrders`) — por eso no exportaba nada.
async function exportHistorialExcel() {
  if (filteredOrders.length === 0) { alert('No hay registros para exportar.'); return; }
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

  await ensureXLSXLoaded();

  const rows = [
    ['N° Nota', 'Cliente', 'RUC', 'Fecha', 'Hora', 'Subtotal', 'Descuento %', 'Total']
  ];
  filteredOrders.forEach(o => {
    rows.push([sanitizeForExcel(o.numero), sanitizeForExcel(o.cliente), o.ruc, o.fecha, o.hora, o.subtotal || 0, o.descuentoPct || 0, o.total || 0]);
  });

  const ws  = XLSX.utils.aoa_to_sheet(rows);
  const wb  = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historial');

  const fileName = `reporte-historial-${new Date().toISOString().slice(0,10)}.xlsx`;
  await saveWorkbook(wb, fileName, `✓ Excel guardado en Documentos:\n${fileName}`);
}