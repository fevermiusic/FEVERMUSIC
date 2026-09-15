// =========================================================
// Musical Fever — /api/change-username (Vercel, plan gratuito)
// =========================================================
// Mismo motivo y mismo patrón que change-password.js: cambiarle el
// correo interno (usuario@fever.local) de OTRO usuario en Firebase
// Auth requiere el Admin SDK, así que viaja por este endpoint en
// vez de hacerse desde el cliente.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: 'https://fever-83517-default-rtdb.firebaseio.com',
  });
}

const ALLOWED_ORIGIN = '*';
const USERNAME_AUTH_DOMAIN = 'fever.local';

// Debe reflejar exactamente la misma normalización que usa el
// cliente en firebase.js (normalizeUsername), para que el "usuario"
// guardado en /users/{uid} y el correo interno de Auth coincidan.
function normalizeUsername(usuario) {
  return String(usuario || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
}

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

  const { uid, nuevoUsuario } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'Falta el uid del usuario a modificar.' });
  }
  const usuarioNormalizado = normalizeUsername(nuevoUsuario);
  if (!usuarioNormalizado) {
    return res.status(400).json({ error: 'El usuario debe tener al menos una letra o número.' });
  }
  if (uid === decoded.uid) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio usuario desde aquí.' });
  }

  try {
    const db = admin.database();

    const callerSnap = await db.ref('users').child(decoded.uid).once('value');
    const callerProfile = callerSnap.val();
    if (!callerProfile || callerProfile.rol !== 'admin' || callerProfile.activo === false) {
      return res.status(403).json({ error: 'Solo un admin activo puede cambiar el usuario.' });
    }

    const targetSnap = await db.ref('users').child(uid).once('value');
    if (!targetSnap.exists()) {
      return res.status(404).json({ error: 'Ese usuario ya no existe.' });
    }

    const nuevoAuthEmail = usuarioNormalizado + '@' + USERNAME_AUTH_DOMAIN;

    try {
      await admin.auth().updateUser(uid, { email: nuevoAuthEmail });
    } catch (err) {
      if (err && err.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'Ese usuario ya está en uso — elige otro.' });
      }
      throw err;
    }

    await db.ref('users').child(uid).update({ usuario: usuarioNormalizado });

    return res.status(200).json({ ok: true, usuario: usuarioNormalizado });
  } catch (err) {
    console.error('change-username — error inesperado:', err);
    return res.status(500).json({ error: 'No se pudo cambiar el usuario. Revisa los logs en Vercel.' });
  }
};
