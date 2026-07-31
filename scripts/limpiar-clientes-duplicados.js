// =========================================================
// Musical Fever — Detección y limpieza de clientes duplicados
//
// Motivo: antes del fix en import-clientes.js, un cliente cuyo
// RUC estaba guardado en Firebase con un formato "sucio" (espacio,
// guion, u otro carácter no numérico en la key) no era detectado
// como duplicado al reimportarlo, y terminaba creando un SEGUNDO
// nodo con la key limpia. Este script detecta esos pares y te deja
// elegir qué hacer con cada uno.
//
// Corre UNA SOLA VEZ, a mano, con tu propia credencial local:
//   FIREBASE_SERVICE_ACCOUNT_PATH=./tu-credencial.json node scripts/limpiar-clientes-duplicados.js
//
// Por defecto solo REPORTA (no borra nada). Para que borre de
// verdad los duplicados "sucios" quedándose con el más reciente,
// corré con --fix:
//   FIREBASE_SERVICE_ACCOUNT_PATH=./tu-credencial.json node scripts/limpiar-clientes-duplicados.js --fix
//
// IMPORTANTE: no se automatiza vía GitHub Actions a propósito —
// esto se corre una vez para sanear datos históricos, no es una
// tarea recurrente como la limpieza de historial.
// =========================================================

const admin = require('firebase-admin');
const fs = require('fs');

const APLICAR_FIX = process.argv.includes('--fix');

const credPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!credPath || !fs.existsSync(credPath)) {
  console.error('[error] Definí FIREBASE_SERVICE_ACCOUNT_PATH apuntando a tu JSON de credencial de servicio.');
  console.error('Ejemplo: FIREBASE_SERVICE_ACCOUNT_PATH=./cred.json node scripts/limpiar-clientes-duplicados.js');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://basefv-6baf2-default-rtdb.firebaseio.com',
});

const db = admin.database();
const refClients = db.ref('clients');

function normalizeRuc(ruc) {
  return String(ruc || '').trim().replace(/\D/g, '').slice(0, 11);
}

async function limpiarClientesDuplicados() {
  console.log(`[dup-clientes] Modo: ${APLICAR_FIX ? 'FIX (va a borrar)' : 'SOLO REPORTE (no borra nada)'}`);

  const snapshot = await refClients.once('value');
  const val = snapshot.val() || {};
  const keys = Object.keys(val);

  console.log(`[dup-clientes] Total de clientes en Firebase: ${keys.length}`);

  // Agrupar por RUC normalizado
  const grupos = {};
  for (const key of keys) {
    const rucNorm = normalizeRuc(key);
    if (!grupos[rucNorm]) grupos[rucNorm] = [];
    grupos[rucNorm].push({ key, data: val[key] });
  }

  const duplicados = Object.entries(grupos).filter(([, entries]) => entries.length > 1);

  if (duplicados.length === 0) {
    console.log('[dup-clientes] ✅ No se encontraron duplicados. Todo limpio.');
    return;
  }

  console.log(`[dup-clientes] ⚠️  Se encontraron ${duplicados.length} RUC con más de un registro:\n`);

  let eliminados = 0;

  for (const [rucNorm, entries] of duplicados) {
    console.log(`RUC ${rucNorm}:`);
    entries.forEach(e => {
      const suciedad = e.key !== rucNorm ? '  ⚠️  key con formato sucio' : '';
      console.log(`  - key="${e.key}" nombre="${e.data.nombre || '(sin nombre)'}"${suciedad}`);
    });

    if (APLICAR_FIX) {
      // Se queda con la key ya limpia (== rucNorm) si existe; si ninguna
      // está limpia, no toca nada automáticamente (requiere revisión manual).
      const limpia = entries.find(e => e.key === rucNorm);
      const sucias = entries.filter(e => e.key !== rucNorm);

      if (limpia && sucias.length > 0) {
        for (const s of sucias) {
          await refClients.child(s.key).remove();
          eliminados++;
          console.log(`  ❌ Eliminado key sucia "${s.key}" (se conservó "${limpia.key}")`);
        }
      } else {
        console.log('  ⏭️  No hay una key limpia clara entre estas — revisar a mano, no se tocó.');
      }
    }
    console.log('');
  }

  if (APLICAR_FIX) {
    console.log(`[dup-clientes] Eliminados: ${eliminados}`);
  } else {
    console.log('[dup-clientes] Esto fue solo un reporte. Corré de nuevo con --fix para aplicar la limpieza automática donde haya una key limpia clara.');
  }
}

limpiarClientesDuplicados()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[dup-clientes] Error:', err);
    process.exit(1);
  });
