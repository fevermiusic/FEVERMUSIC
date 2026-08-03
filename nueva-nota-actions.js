// ── Botón "Volver" del topbar ──────────────────────────
// Antes era un <a href="pedidos.html"> normal: al hacer click, el
// navegador intentaba cargar ese archivo directamente (fuera de la
// SPA), lo cual falla porque ya no existe como archivo independiente
// (todo vive embebido en index.html). Ahora usa el router interno,
// igual que confirmOrder(): si se estaba editando una nota (viene de
// Historial), vuelve a Historial; si es una nota nueva (viene de
// Pedidos), vuelve a Pedidos.
function goBackFromNota() {
  const destino = editingOrderId ? 'historial' : 'pedidos';
  if (window.Router) {
    Router.go(destino);
  } else {
    window.location.href = destino + '.html';
  }
}

// ── Cargadores diferidos (lazy) ────────────────────────
function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// =========================================================
// Musical Fever — Nueva Nota · Acciones
// Exportar Excel, confirmar y guardar pedido en Firebase
// =========================================================


async function exportExcel() {
  if (items.length === 0) return alert('Agrega artículos antes de exportar.');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  const subtotal = round2(items.reduce((s, i) => s + i.subtotal, 0));
  const discAmt  = round2(subtotal * (discountPct / 100));
  const total    = round2(subtotal - discAmt);
  const notaNum  = document.getElementById('notaNumber').textContent;
  const fileName = `nota-pedido-${notaNum}.xlsx`;

  const data = [
    ['CORPORACIÓN FEVER S.A.C. — NOTA DE PEDIDO'],
    [`Número: ${notaNum}`],
    [`Fecha: ${new Date().toLocaleDateString('es-PE')}`],
    [`Cliente: ${clientNombre || '—'}`],
    [`RUC: ${clientRuc || '—'}`],
    [],
    ['Código', 'Producto', 'Precio Unit. (S/)', 'Cantidad', 'Subtotal (S/)'],
    ...items.map(i => [i.code, i.name, i.price, i.qty, i.subtotal]),
    [],
    ['', '', '', 'Subtotal', subtotal],
  ];
  if (discountPct > 0) data.push(['', '', '', `Descuento (${discountPct}%)`, -discAmt]);
  data.push(['', '', '', 'TOTAL', total]);

  const ws     = XLSX.utils.aoa_to_sheet(data);
  ws['!cols']  = [{ wch: 12 }, { wch: 36 }, { wch: 16 }, { wch: 10 }, { wch: 14 }];
  const wb     = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Nota de Pedido');

  try {
    const xlsxArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob       = new Blob([xlsxArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const file       = new File([blob], fileName, { type: blob.type });

    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: `Nota de Pedido ${notaNum}`, text: `Nota de Pedido ${notaNum} — Corporación Fever S.A.C.` });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }

  XLSX.writeFile(wb, fileName);
}

// ── Confirmar y guardar pedido ──────────────────────────
function confirmOrder() {
  if (!clientRuc || !clientNombre) return alert('Asigna un cliente antes de confirmar.');
  if (items.length === 0)          return alert('Agrega al menos un artículo.');

  const isEdit = !!editingOrderId;
  const btn = document.querySelector('[onclick="confirmOrder()"]');
  if (btn) { btn.disabled = true; btn.textContent = isEdit ? 'Guardando…' : 'Confirmando…'; }

  const subtotal = round2(items.reduce((s, i) => s + i.subtotal, 0));
  const discAmt  = round2(subtotal * (discountPct / 100));
  const total    = round2(subtotal - discAmt);
  const now      = new Date();

  const orderData = {
    numero:       document.getElementById('notaNumber').textContent,
    ruc:          clientRuc,
    cliente:      clientNombre,
    fecha:        isEdit ? (editingOriginalMeta.fecha || now.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit' })) : now.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit' }),
    hora:         isEdit ? (editingOriginalMeta.hora  || now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })) : now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
    items:        items.map(i => ({ code: i.code, name: i.name, desc: i.desc || '', price: i.price, qty: i.qty, itemDiscountPct: i.itemDiscountPct || 0 })),
    subtotal,
    descuentoPct: discountPct,
    total,
    // Cuántas veces se ha editado esta nota desde que se creó — se
    // usa en Historial para marcar visualmente las notas editadas.
    editCount:    isEdit ? (editingOriginalEditCount + 1) : 0,
    // Quién hizo esto — con cuentas individuales por vendedor, esto
    // es lo que le permite al admin rastrear una nota hasta la
    // persona exacta que la creó o la editó (antes era imposible:
    // todos los vendedores compartían una sola cuenta).
    // Al EDITAR se conserva quien la creó originalmente (aunque la
    // esté editando otra persona, típicamente el admin) — si no, la
    // nota se le "robaba" al vendedor que la vendió: desaparecía de
    // su Historial y quedaba mal categorizada en el filtro por
    // vendedor, solo por haber sido corregida por alguien más.
    creadoPor:    isEdit ? (editingOriginalCreadoPor || { uid: currentUserUid, nombre: currentUserName })
                          : { uid: currentUserUid, nombre: currentUserName }
  };

  if (isEdit) {
    // Reconciliar stock: primero se devuelven las cantidades que
    // tenía la nota ORIGINAL (como si se cancelara), y recién
    // después se descuentan las cantidades NUEVAS. El resultado neto
    // es la diferencia real, sin importar si se agregaron, quitaron
    // o cambiaron cantidades de productos respecto a la versión
    // anterior de la nota.
    // Se confirma que la nota siga existiendo ANTES de tocar el
    // stock. Si se revisara solo al final (como antes), y la nota ya
    // hubiera sido borrada por la limpieza automática por antigüedad
    // (30 días) mientras se editaba, el stock ya habría quedado
    // ajustado según esta edición aunque no hubiera ningún registro
    // donde guardarla.
    orderExists(editingOrderId).then(exists => {
      if (!exists) {
        throw new Error(
          'Esta nota ya no existe: probablemente el borrado automático por antigüedad (30 días) ' +
          'la eliminó mientras la editabas. Vuelve a Historial y créala de nuevo si aún corresponde.'
        );
      }
      return Promise.all(editingOriginalItems.map(i => addStock(i.code, i.qty)))
        .then(() =>
          decrementStock(items.map(i => ({ code: i.code, qty: i.qty }))).catch(err => {
            // decrementStock ya falló y no aplicó nada (es transaccional),
            // pero el addStock de arriba SÍ se aplicó — hay que revertirlo
            // para no dejar el stock inflado con cantidades "fantasma".
            return Promise.all(editingOriginalItems.map(i => addStock(i.code, -i.qty)))
              .catch(() => {}) // best-effort: si esto también falla, seguimos igual al error original
              .then(() => { throw err; });
          })
        )
        .then(() => updateOrder(editingOrderId, orderData));
    })
      .then(() => {
        alert(`✓ Nota ${orderData.numero} actualizada correctamente.`);
        if (window.Router) Router.go('historial'); else window.location.href = 'historial.html';
      })
      .catch(err => {
        alert('No se pudieron guardar los cambios: ' + err.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
      });
    return;
  }

  // Antes: se guardaba el pedido y RECIÉN DESPUÉS se intentaba
  // descontar el stock. Si el stock no alcanzaba (alguien más lo
  // vendió justo antes), el pedido ya quedaba guardado en Firebase
  // como si se hubiera confirmado, aunque el descuento fallara —
  // un "pedido fantasma". Ahora se valida y descuenta el stock
  // PRIMERO (de forma atómica, por transacción); el pedido solo se
  // guarda si el descuento de todos los productos tuvo éxito.
  //
  // Última comprobación del número de nota justo antes de guardar:
  // el número se calculó al ABRIR el formulario (ver
  // nueva-nota-logic.js), así que si alguien más confirmó otra nota
  // nueva mientras este formulario seguía abierto, ese correlativo
  // ya pudo quedar ocupado. Se revisa y, si ya fue tomado, se le
  // asigna el siguiente disponible antes de guardar (en vez de crear
  // dos notas con el mismo número).
  (isEdit
    ? Promise.resolve()
    : orderNumberTaken(orderData.numero).then(taken => {
        if (!taken) return;
        return generateNextOrderNumber(new Date().getFullYear()).then(freshNum => {
          orderData.numero = freshNum;
          document.getElementById('notaNumber').textContent = freshNum;
        });
      })
  )
  .then(() => decrementStock(items.map(i => ({ code: i.code, qty: i.qty }))))
    .then(() =>
      saveOrder(orderData).catch(err => {
        // saveOrder falló DESPUÉS de que el stock ya se descontó.
        // Sin este rollback, el stock quedaría perdido sin que exista
        // ningún pedido que lo respalde (el mismo tipo de inconsistencia
        // "fantasma" que el descuento-primero buscaba evitar, pero en
        // sentido inverso). Se revierte el descuento antes de propagar
        // el error original.
        return Promise.all(items.map(i => addStock(i.code, i.qty)))
          .catch(() => {}) // best-effort: si el rollback también falla, seguimos con el error original
          .then(() => { throw err; });
      })
    )
    .then(() => {
      alert(`✓ Pedido ${orderData.numero} confirmado correctamente.`);
      if (window.Router) Router.go('pedidos'); else window.location.href = 'pedidos.html';
    })
    .catch(err => {
      alert('No se pudo confirmar el pedido: ' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = 'Confirmar pedido'; }
    });
}