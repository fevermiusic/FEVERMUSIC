MUSICAL FEVER — Cambios aplicados (actualizado)
==================================================

★★★ EL BUG PRINCIPAL — por qué nada cargaba y vendedor/admin se veían igual ★★★

En router.js, cada vista se inicializa así:
    stock: { init: () => window.Stock && Stock.init() }

Pero en stock.js, pedidos-logic.js, historial-logic.js y
nueva-nota-logic.js, los objetos estaban declarados como:
    const Stock = { ... }

Un "const" (o "let") en la raíz de un <script> normal NO se cuelga de
window (a diferencia de "var"). Por eso window.Stock, window.Pedidos,
window.Historial y window.NuevaNota SIEMPRE eran undefined, la
condición "window.Stock && Stock.init()" nunca se cumplía, y
Stock.init() / Pedidos.init() / Historial.init() / NuevaNota.init()
NUNCA se ejecutaban al cambiar de sección.

Esto explica TODO lo que veíamos:
  - Los datos "no cargaban" -> en realidad sí llegaban a Firebase,
    pero nadie llamaba a la función que los pinta en pantalla.
  - Vendedor y Admin se veían igual -> applyStockRoleRestrictions()
    (que oculta botones para vendedor) vive DENTRO de Stock.init(),
    que nunca corría. Lo mismo aplica a las restricciones de
    Pedidos.

FIX: se cambió "const Stock = {" -> "window.Stock = {" (y lo mismo
para Pedidos, Historial, NuevaNota) en los 4 archivos.

---

Resto de cambios de esta sesión (ya incluidos):

1. router.js
   - Las 4 vistas están incrustadas como texto (VIEWS_HTML) en vez
     de cargarse con fetch() — funciona con doble clic (file://),
     con servidor, y en Capacitor/Android.
   - Si editas algo en views/*.html, hay que volver a pegar ese HTML
     dentro de VIEWS_HTML en router.js para que se refleje.

2. base.css
   - #viewRoot ahora tiene flex:1 — ya no queda un margen en blanco
     a la derecha del contenido.

3. auth-guard.js
   - La comparación de email para el rol (admin/vendedor) ignora
     mayúsculas y espacios.

4. firebase.js
   - Las lecturas de /products, /clients y /orders avisan con
     alert()+console.error() si Firebase falla, en vez de quedarse
     "Cargando…" en silencio para siempre.

5. stock.js
   - renderProducts() ya no truena si la tabla de escritorio
     (#productTableBody) no existe en el DOM (ej. vista móvil).

9. firebase.js
   - deleteProduct() ahora borra el nodo de Firebase DE VERDAD
     (.remove()), en vez de solo marcarlo deleted:true + stock:0 y
     dejarlo escondido. Antes de este cambio, un producto "eliminado"
     seguía existiendo en la base de datos y se veía en la consola de
     Firebase, aunque la app lo ocultara.
   - Para que esto no perdiera el aviso en tiempo real a otros
     dispositivos (razón original del borrado lógico), se agregó un
     listener 'child_removed' sobre /products y /clients completos:
     cuando alguien borra un producto de verdad, cualquier pantalla
     abierta (Stock, Nueva Nota) lo saca de la lista al instante, sin
     esperar la resincronización de cada 3 horas.
   - IMPORTANTE: los productos que ya habías "eliminado" ANTES de este
     fix siguen en Firebase como fantasmas (deleted:true, stock:0) —
     ver LIMPIAR-FANTASMAS-LEEME.txt para borrarlos de una sola vez.

Cómo probarlo
=============
1. Descomprime reemplazando tu carpeta musical-fever-spa actual.
2. Doble clic en index.html.
3. Entra con la cuenta vendedor: Stock y Pedidos ya deberían
   mostrar SOLO lo permitido para ese rol (sin Importar, Exportar,
   Seleccionar, Agregar producto, etc. según corresponda).
4. Entra con la cuenta admin: deberías ver todo, con datos reales.

---
Actualización adicional:

7. stock.js
   - El botón "Editar" de cada producto ahora también se oculta
     para el rol vendedor en la tabla de escritorio (antes solo se
     ocultaba en la vista de tarjetas/móvil). Se agregó la clase
     compartida "stock-edit-btn" a ambos botones y se amplió la
     regla CSS que los oculta.

8. views/historial-view.html (y por lo tanto router.js, que lo
   trae incrustado)
   - Se reemplazó el logo "Corporación Fever S.A.C." (cursiva)
     por el logo circular de tambor "Musical Fever Instruments"
     proporcionado. Este logo se usa tanto en la vista previa de
     "Detalle de la nota" como en el PDF exportado (historial-actions.js
     lo toma directamente de esa imagen).
