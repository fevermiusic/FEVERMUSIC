// =========================================================
// Musical Fever — Limpieza automática del Historial
// Corre diariamente vía GitHub Actions (ver .github/workflows)
//
// Cada pedido es evaluado de forma INDIVIDUAL según su propio
// timestamp de creación. No hay una fecha de corte global: se
// borra únicamente el/los pedido(s) que, en cada corrida, ya
// superaron su propio tiempo de vida.
//
// =========================================================

const admin = require('firebase-admin');

// --- VALOR DE PRODUCCIÓN ---
const RETENCION_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

// ── Credenciales (vienen del secret de GitHub, ver workflow) ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://basefv-6baf2-default-rtdb.firebaseio.com',
});

const db = admin.database();
const refOrders = db.ref('orders');

async function limpiarHistorial() {
  const retencionLabel = RETENCION_MS < 60 * 60 * 1000
    ? `${(RETENCION_MS / 60000).toFixed(1)} minutos`
    : `${(RETENCION_MS / (24 * 60 * 60 * 1000)).toFixed(1)} días`;
  console.log(`[limpieza] Iniciando revisión — retención: ${retencionLabel}`);

  const snapshot = await refOrders.once('value');
  const val = snapshot.val() || {};
  const ids = Object.keys(val);

  console.log(`[limpieza] Total de pedidos en Firebase: ${ids.length}`);

  const ahora = Date.now();
  let eliminados = 0;
  let revisados = 0;

  for (const id of ids) {
    const pedido = val[id];
    const timestamp = pedido.timestamp || 0;
    const edadMs = ahora - timestamp;

    revisados++;

    // ── Reloj individual: solo se borra si ESTE pedido, por
    // sí mismo, ya superó su propio límite de retención ──
    if (edadMs >= RETENCION_MS) {
      await refOrders.child(id).remove();
      eliminados++;
      console.log(`[limpieza] ❌ Eliminado ${id} — ${(edadMs / 60000).toFixed(1)} min de antigüedad`);
    }
  }

  console.log(`[limpieza] Revisados: ${revisados} | Eliminados: ${eliminados}`);
  console.log('[limpieza] Finalizado correctamente.');
}

limpiarHistorial()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[limpieza] Error:', err);
    process.exit(1);
  });
