// =========================================================
// Musical Fever — Sidebar navigation
// =========================================================

// ── Guardar/compartir archivo XLSX ──────────────────────
// El navigator.share() del navegador es poco confiable dentro del
// WebView de Android (canShare puede devolver false sin avisar).
// Por eso, dentro del APK usamos los plugins NATIVOS de Capacitor
// (Filesystem + Share), que sí funcionan de forma consistente.
// En desarrollo/desktop (localhost en el navegador) usamos la
// descarga clásica del navegador.
async function saveWorkbook(wb, filename) {
  const isNative = window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform();

  if (isNative) {
    try {
      const { Filesystem, Share } = Capacitor.Plugins;
      const base64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const result = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: 'CACHE'
      });
      await Share.share({ title: filename, url: result.uri, dialogTitle: 'Guardar o compartir' });
    } catch (err) {
      const msg = (err && err.message) || '';
      if (/cancel/i.test(msg)) return; // el usuario cerró el panel de compartir
      alert('No se pudo guardar el archivo: ' + (msg || 'error desconocido'));
    }
    return;
  }

  XLSX.writeFile(wb, filename); // navegador de escritorio
}

document.addEventListener('DOMContentLoaded', () => {
  const items = document.querySelectorAll('.nav-item[data-page]');

  items.forEach(item => {
    item.addEventListener('click', e => {
      const page = item.dataset.page;
      if (!page) return;
      // Si existe el router de la SPA (index.html), lo usamos —
      // así no se recarga la página. Si no existe (todavía estás
      // en una página suelta como historial.html), cae a la
      // navegación normal del navegador.
      if (window.Router) {
        e.preventDefault();
        Router.go(page);
      } else {
        window.location.href = `${page}.html`;
      }
    });
  });

  // Marcar la sección activa — en la SPA lo hace el Router; esto
  // es el respaldo para páginas sueltas que todavía no se migraron.
  if (!window.Router) {
    const current = window.location.pathname.split('/').pop().replace('.html', '') || 'pedidos';
    document.querySelectorAll(`.nav-item[data-page="${current}"]`).forEach(el => {
      el.classList.add('active');
    });
  }

  // ── Ocultar la barra inferior mientras el teclado está abierto ──
  // En WebViews (Capacitor/Android) los elementos position:fixed no se
  // reposicionan de forma confiable cuando aparece el teclado virtual,
  // por lo que la barra queda flotando sobre el teclado. La solución más
  // estable es ocultarla en base al foco real de los campos de texto.
  const FIELD_SELECTOR = 'input, textarea, select';
  const isMobileViewport = () => window.matchMedia('(max-width: 768px)').matches;

  document.addEventListener('focusin', e => {
    if (isMobileViewport() && e.target.matches(FIELD_SELECTOR)) {
      document.body.classList.add('keyboard-open');
    }
  });

  document.addEventListener('focusout', e => {
    if (e.target.matches(FIELD_SELECTOR)) {
      document.body.classList.remove('keyboard-open');
    }
  });

  // ── Enter/Ir: cerrar el teclado Y ejecutar la acción del campo ──
  // Quitar el foco (blur) hace que el teclado virtual se oculte en
  // Android/Capacitor. Además de eso, buscamos "lo que sigue" según
  // el contexto del campo: agregar el artículo en Nueva Nota,
  // disparar el botón principal si el campo está dentro de un modal
  // abierto (Guardar cambios / Registrar producto / Procesar
  // importación...), o simplemente confirmar el filtro/búsqueda que
  // ya se aplica en vivo con oninput. Cubrimos keydown, keypress
  // (algunos teclados de Android solo disparan uno de los dos) y el
  // evento nativo "search" del botón de lupa en inputs type="search".
  const isVisible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  const runEnterAction = e => {
    const isEnter = e.key === 'Enter' || e.keyCode === 13 || e.which === 13;
    if (!isEnter) return;
    const el = e.target;
    if (!el.matches('input, textarea')) return;

    // Si el propio campo ya intercepta Enter por su cuenta (p. ej. el
    // buscador de productos de Nueva Nota, que navega/selecciona
    // sugerencias con las flechas y Enter), respetamos ese
    // comportamiento y solo cerramos el teclado.
    if (e.defaultPrevented) {
      el.blur();
      return;
    }

    e.preventDefault();
    el.blur();

    // Nueva Nota: Enter en cantidad o precio agrega el artículo.
    if ((el.id === 'addQty' || el.id === 'addPrice') && typeof addItem === 'function') {
      addItem();
      return;
    }

    // Campo dentro de un modal abierto: dispara el botón principal
    // visible del pie del modal (Guardar cambios, Registrar
    // producto, Procesar importación, etc.).
    const modal = el.closest('.modal-overlay.open .modal');
    if (modal) {
      const footer  = modal.querySelector('.modal-footer');
      const primary = footer && footer.querySelector('.btn-primary');
      if (isVisible(primary)) primary.click();
      return;
    }

    // Buscadores y filtros (searchInput, filterDesde/Hasta, etc.):
    // ya filtran en vivo con oninput/onchange, así que Enter solo
    // necesita confirmar cerrando el teclado, lo cual ya hicimos.
  };
  document.addEventListener('keydown', runEnterAction);
  document.addEventListener('keypress', runEnterAction);
  document.addEventListener('search', e => e.target.blur());

  // ── Ocultar botones del topbar mientras se scrollea (tablet/móvil) ──
  // En pantallas ≤1280px el topbar pasa a dos filas: título arriba,
  // botones de acción (Seleccionar/Importar/Exportar/Agregar) abajo.
  // Esa fila de botones le resta espacio de lectura a la lista de
  // abajo. Mientras el usuario scrollea activamente, se ocultan esos
  // botones (queda solo el buscador); apenas el scroll se detiene
  // (sin evento "scroll" nuevo durante SCROLL_IDLE_MS), reaparecen
  // solos. El listener va en el document con "capture" porque el
  // evento "scroll" no burbujea — así se captura sin importar qué
  // vista (.page-content) esté montada en cada momento.
  const SCROLL_IDLE_MS = 500;
  const isCompactTopbarViewport = () => window.matchMedia('(max-width: 1280px)').matches;
  let scrollIdleTimer = null;

  document.addEventListener('scroll', e => {
    const target = e.target;
    if (!target || !target.classList || !target.classList.contains('page-content')) return;
    if (!isCompactTopbarViewport()) return;
    // BUG REAL: al enfocar o escribir en un buscador (ej. "RUC o razón
    // social…" de Notas de Pedido), el teclado virtual aparece/cambia
    // de tamaño y el navegador reacomoda la página para mantener el
    // campo visible — eso dispara un evento "scroll" real aunque el
    // usuario no haya deslizado nada. Sin este chequeo, ese scroll
    // "fantasma" activaba topbar-scrolling y escondía de golpe los
    // botones (incluido "Nuevo cliente"), que volvían a aparecer solos
    // 500ms después: se sentía como que la pantalla "se buguea" o
    // "sube y baja" mientras se escribe. Si hay un campo de texto
    // enfocado, no es un scroll intencional del usuario — se ignora.
    const active = document.activeElement;
    if (active && active.matches(FIELD_SELECTOR)) return;

    // Esta regla oculta "todo lo del topbar EXCEPTO el buscador"
    // (ver CSS: body.topbar-scrolling .topbar-actions > *:not(.search-wrap)),
    // pensada para vistas como Stock/Notas de Pedido donde el buscador
    // se queda visible como referencia. Pero en vistas sin buscador en
    // el topbar (Nueva Nota: solo el N° de nota + "Volver"; Registros:
    // solo "Nuevo vendedor") no queda NADA visible — se ocultaba
    // literalmente todo, incluido "Volver", y volvía a aparecer solo
    // 500ms después: se veía como que esa barra "desaparecía y
    // volvía sola" al hacer scroll. Si no hay buscador que sirva de
    // referencia, no tiene sentido ocultar nada: se deja el topbar
    // siempre visible en esas vistas.
    if (!document.querySelector('.topbar-actions .search-wrap')) return;

    document.body.classList.add('topbar-scrolling');
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      document.body.classList.remove('topbar-scrolling');
    }, SCROLL_IDLE_MS);
  }, true);
});

// ── Botón físico/gesto de "atrás" en Android (Capacitor) ──────
// Por defecto, sin este listener, Android simplemente cierra la app
// entera al presionar atrás — sin importar si hay un teclado abierto,
// un modal abierto, o en qué sección de la SPA estás. Eso es lo que
// se sentía "poco profesional": cerraba el teclado bien la primera
// vez, pero la segunda vez mataba la app entera en vez de navegar.
//
// Aquí interceptamos ese botón y decidimos qué hacer en capas,
// de más específico a más general:
//   1) Modal abierto           -> cerrar el modal
//   2) Modo selección activo (Seleccionar/Cancelar) -> lo apaga, sin navegar
//   3) Panel "más filtros" abierto (Historial, móvil) -> lo cierra
//   4) Teclado abierto (campo con foco) -> solo quitar el foco
//   5) Pantalla "Nueva Nota"   -> actúa como el botón "Volver"
//   6) Otra sección de la SPA  -> vuelve a la pantalla principal
//   7) Ya en la pantalla principal -> exige un segundo toque para
//      salir de verdad (patrón estándar "presiona de nuevo para salir")
document.addEventListener('DOMContentLoaded', () => {
  const isNative = window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform();
  if (!isNative || !Capacitor.Plugins || !Capacitor.Plugins.App) return;

  const HOME_PAGE = 'pedidos';
  let lastBackPressAt = 0;

  function showExitHint() {
    const existing = document.getElementById('backExitHint');
    if (existing) existing.remove();
    const hint = document.createElement('div');
    hint.id = 'backExitHint';
    hint.textContent = 'Presiona atrás de nuevo para salir';
    hint.style.cssText =
      'position:fixed;left:50%;bottom:76px;transform:translateX(-50%);' +
      'background:#16181D;color:#fff;padding:9px 16px;border-radius:999px;' +
      'font-size:12.5px;font-weight:500;z-index:99999;box-shadow:0 6px 16px rgba(0,0,0,.25)';
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 1800);
  }

  Capacitor.Plugins.App.addListener('backButton', () => {
    // 1) Modal abierto: ciérralo y no hagas nada más.
    const openModal = document.querySelector('.modal-overlay.open');
    if (openModal) {
      const closeBtn = openModal.querySelector('.modal-close');
      if (closeBtn) closeBtn.click();
      else openModal.classList.remove('open');
      return;
    }

    // 2) Modo selección activo (botón "Seleccionar" → "Cancelar" en Stock,
    // Pedidos o Historial): lo apaga y se queda en la misma sección, en vez
    // de navegar. Se revisan los tres controladores porque cada vista tiene
    // el suyo y solo uno puede estar activo a la vez.
    const activeSelection = [
      typeof stockSelection  !== 'undefined' ? stockSelection  : null,
      typeof clientSelection !== 'undefined' ? clientSelection : null,
      typeof histSelection   !== 'undefined' ? histSelection   : null
    ].find(sel => sel && sel.isOn());
    if (activeSelection) {
      activeSelection.set(false);
      return;
    }

    // 3) Panel de "más filtros" abierto en Historial (móvil): lo cierra
    // y se queda en la misma sección, en vez de navegar.
    const openFilterExtra = document.getElementById('filterExtra');
    if (openFilterExtra && openFilterExtra.classList.contains('open')) {
      if (typeof toggleFilterExtra === 'function') toggleFilterExtra();
      else openFilterExtra.classList.remove('open');
      return;
    }

    // 4) Teclado abierto: quitar el foco cierra el teclado en Android,
    // y no debe navegar ni cerrar nada más en esta misma pulsación.
    const active = document.activeElement;
    if (active && active.matches('input, textarea, select')) {
      active.blur();
      document.body.classList.remove('keyboard-open');
      return;
    }

    // 5) Nueva Nota: mismo destino que el botón "Volver" del topbar.
    if (window.Router && Router.currentPage === 'nueva-nota') {
      if (typeof goBackFromNota === 'function') {
        goBackFromNota();
      } else {
        Router.go(HOME_PAGE);
      }
      return;
    }

    // 6) Cualquier otra sección (Stock, Historial, Registros...):
    // vuelve a la pantalla principal en vez de salir de la app.
    if (window.Router && Router.currentPage && Router.currentPage !== HOME_PAGE) {
      Router.go(HOME_PAGE);
      return;
    }

    // 7) Ya en la pantalla principal: exige doble toque para salir.
    const now = Date.now();
    if (now - lastBackPressAt < 2000) {
      Capacitor.Plugins.App.exitApp();
    } else {
      lastBackPressAt = now;
      showExitHint();
    }
  });
});