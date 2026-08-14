// =========================================================
// Musical Fever — /api/change-password (Vercel, plan gratuito)
// =========================================================
// Por qué vive esto en Vercel y no en Firebase: cambiarle la
// contraseña a OTRO usuario requiere el Admin SDK, que solo puede
// correr en un servidor de confianza (nunca en el navegador). La
// opción "nativa" de Firebase para eso es Cloud Functions, pero
// Firebase exige el plan Blaze (pago por uso, con tarjeta) SOLO para
// poder desplegar Functions — aunque el uso real de esto nunca
// llegara a costar nada. Vercel deja correr este mismo tipo de
// función gratis, sin tarjeta. El Admin SDK adentro es el mismo,
// solo cambia dónde vive.
//
// Seguridad: nunca confía en lo que diga el navegador sobre quién
// es — recibe el token de sesión de Firebase (idToken) que ya trae
// el navegador y lo verifica del lado del servidor con
// admin.auth().verifyIdToken(). Recién con eso confirma, leyendo
// /users/{uid} directo de la base, que quien llama es admin activo.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: 'https://fever-83517-default-rtdb.firebaseio.com',
  });
}

// Cambia esto por el dominio real donde vive tu app (GitHub Pages,
// tu dominio propio, etc.) para no dejar la API abierta a cualquier
// sitio. Mientras pruebas puedes dejar '*', pero antes de que quede
// en producción de verdad conviene restringirlo.
const ALLOWED_ORIGIN = '*';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return res.status(401).json({ error: 'Falta el token de sesión.' });

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o vencida — vuelve a iniciar sesión.' });
  }

  const { uid, nuevaPassword } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'Falta el uid del usuario a modificar.' });
  }
  if (!nuevaPassword || typeof nuevaPassword !== 'string' || nuevaPassword.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  if (uid === decoded.uid) {
    return res.status(400).json({ error: 'Para tu propia contraseña, usa el cambio de cuenta normal.' });
  }

  try {
    const db = admin.database();

    const callerSnap = await db.ref('users').child(decoded.uid).once('value');
    const callerProfile = callerSnap.val();
    if (!callerProfile || callerProfile.rol !== 'admin' || callerProfile.activo === false) {
      return res.status(403).json({ error: 'Solo un admin activo puede cambiar contraseñas.' });
    }

    const targetSnap = await db.ref('users').child(uid).once('value');
    if (!targetSnap.exists()) {
      return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    }

    await admin.auth().updateUser(uid, { password: nuevaPassword });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('change-password — error inesperado:', err);
    return res.status(500).json({ error: 'No se pudo cambiar la contraseña. Revisa los logs en Vercel.' });
  }
};
