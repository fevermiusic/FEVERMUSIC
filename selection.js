/* ═══════════════════════════════════════════════════════
   Musical Fever — Módulo de "modo selección"
   ═══════════════════════════════════════════════════════
   Los checkboxes de selección masiva permanecen OCULTOS
   hasta que el usuario:
     a) presiona el botón "Seleccionar", o
     b) hace una pulsación larga (long-press) sobre una
        fila/tarjeta — funciona igual en mouse y en touch.

   Reutilizado en Stock (tabla + tarjetas) y en Pedidos
   (tabla de clientes), evitando duplicar la misma lógica
   en cada página.
   ═══════════════════════════════════════════════════════ */

/**
 * Crea un controlador de modo selección.
 * @param {Object} opts
 * @param {string[]} opts.containers  Selectores de los contenedores que reciben la clase .selecting
 * @param {string}   [opts.buttonId]  id del botón "Seleccionar" (para el estado .active)
 * @param {string}   [opts.labelId]   id del <span> con el texto del botón
 * @param {Function} [opts.onExit]    callback al salir del modo (para limpiar selección)
 */
function createSelectionMode(opts) {
  let active = false;

  function apply() {
    (opts.containers || []).forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.classList.toggle('selecting', active));
    });
    if (opts.buttonId) {
      const btn = document.getElementById(opts.buttonId);
      if (btn) btn.classList.toggle('active', active);
    }
    if (opts.labelId) {
      const label = document.getElementById(opts.labelId);
      if (label) label.textContent = active ? 'Cancelar' : 'Seleccionar';
    }
  }

  return {
    isOn: () => active,
    set(on) {
      if (active === on) return;
      active = on;
      apply();
      if (!active && typeof opts.onExit === 'function') opts.onExit();
    },
    toggle() { this.set(!active); }
  };
}

/**
 * Pulsación larga genérica (mouse + touch vía Pointer Events).
 * Se cancela si el usuario suelta antes de tiempo o si arrastra el dedo/mouse
 * más de 10px (para no interferir con scroll).
 */
function attachLongPress(el, callback, ms) {
  ms = ms || 420;
  // Tolerancia de movimiento más amplia que en mouse: un dedo tiembla
  // más que un cursor, y con 10px se cancelaba el long-press seguido.
  const MOVE_TOLERANCE = 16;
  let timer = null, pressTimer = null, moved = false, startX = 0, startY = 0;

  const clear = () => {
    if (timer)      { clearTimeout(timer);      timer = null; }
    if (pressTimer) { clearTimeout(pressTimer);  pressTimer = null; }
    el.classList.remove('lp-pressing');
  };

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button, input, a')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    moved = false; startX = e.clientX; startY = e.clientY;
    // Feedback visual (resalta el elemento) apenas se nota que es
    // una pulsación sostenida, para que el usuario sepa que "va en
    // camino" antes de que se active la selección.
    pressTimer = setTimeout(() => { if (!moved) el.classList.add('lp-pressing'); }, 90);
    timer = setTimeout(() => { if (!moved) { callback(e); clear(); } }, ms);
  });
  el.addEventListener('pointermove', e => {
    if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) {
      moved = true; clear();
    }
  });
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointerleave', clear);
  el.addEventListener('pointercancel', clear);
  // Evita que el navegador muestre su menú contextual nativo en el long-press
  el.addEventListener('contextmenu', e => e.preventDefault());
}

/**
 * Conecta una fila/tarjeta seleccionable:
 *  - En modo selección, un click normal marca/desmarca su checkbox.
 *  - Fuera de modo selección, un click no hace nada especial (no interfiere
 *    con botones de editar u otros controles internos).
 *  - Un long-press SIEMPRE activa el modo selección y marca el elemento.
 *
 * @param {HTMLElement} el              Fila <tr> o tarjeta con un .row-checkbox dentro
 * @param {Object} selectionCtrl        Instancia de createSelectionMode
 * @param {Function} onToggle           callback(cb) ejecutado cuando cambia el estado del checkbox
 */
function wireSelectableRow(el, selectionCtrl, onToggle) {
  const getCb = () => el.querySelector('.row-checkbox');

  el.addEventListener('click', e => {
    if (e.target.closest('button, input, a')) return;
    if (!selectionCtrl.isOn()) return;
    const cb = getCb();
    if (cb) { cb.checked = !cb.checked; onToggle(cb); }
  });

  attachLongPress(el, () => {
    const cb = getCb();
    if (!cb) return;
    selectionCtrl.set(true);
    cb.checked = true;
    onToggle(cb);
  });
}