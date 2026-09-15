// =========================================================
// Musical Fever — Guardia de sesión y roles
// Se carga en TODAS las páginas protegidas (Stock, Pedidos,
// Nueva Nota, Historial), después de firebase.js.
// =========================================================
//
// Antes el rol se decidía comparando el correo contra una lista fija
// (ADMIN_EMAILS) y asumiendo "si no es admin, es la única cuenta de
// vendedor". Ahora cada persona tiene su propia cuenta, y el rol real
// vive en la base de datos, en /users/{uid}:
//   { nombre, email, rol: 'admin' | 'vendedor', activo: true|false }
//
// Por qué se revisa esto en cada carga de página (no solo al hacer
// login): si un admin desactiva a alguien mientras esa persona ya
// tiene la app abierta en su celular, su sesión de Firebase Auth
// técnicamente sigue siendo válida — lo que la bloquea de verdad es
// que aquí, y en las reglas del servidor, se exige activo === true.
// En cuanto esa persona recargue o navegue a otra pantalla, se le
// cierra la sesión automáticamente.

// Antes: se ocultaba TODA la página (visibility:hidden) mientras se
// confirmaba la sesión, hecho desde este mismo script. El problema es
// que este archivo se carga con "defer", así que corre DESPUÉS de que
// el HTML ya se parseó — en teoría no debería pintarse nada visible
// todavía, pero no está 100% garantizado en todos los navegadores/
// dispositivos. Ahora el ocultamiento inicial lo hace un script
// bloqueante (sin defer) al principio del <head> de index.html, que
// SIEMPRE corre antes que cualquier otra cosa. Este archivo solo se
// encarga de decidir cuándo volver a mostrar la página: nunca antes
// de tener una sesión confirmada como válida.
//
// Mientras se confirma la sesión se muestra un spinner centrado en
// vez de una pantalla en blanco — se ve intencional, no roto — y si
// por algún motivo la sesión nunca termina de confirmarse (más de
// 8 segundos), se trata como si NO hubiera sesión y se manda a
// login: sin confirmación = fuera, nunca se asume que sí hay sesión.

const authLoadingOverlay = document.createElement('div');
authLoadingOverlay.id = 'authLoadingOverlay';
authLoadingOverlay.style.cssText =
  'position:fixed;inset:0;z-index:99999;background:#F0F3F9;' +
  'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;';
authLoadingOverlay.innerHTML =
  '<div style="width:34px;height:34px;border:3px solid #E2E8F4;border-top-color:#16181D;border-radius:50%;animation:authSpin .7s linear infinite"></div>' +
  '<style>@keyframes authSpin{to{transform:rotate(360deg)}}</style>';

function showAuthOverlay() {
  // Vuelve a mostrar la página (el spinner cubre todo con fondo
  // opaco), pero el contenido real de la app sigue sin poder verse
  // porque aún no se resolvió la sesión — solo se ve el spinner.
  document.documentElement.style.visibility = '';
  if (!document.body.contains(authLoadingOverlay)) {
    document.body.appendChild(authLoadingOverlay);
  }
}
function hideAuthOverlay() {
  if (authLoadingOverlay.parentNode) authLoadingOverlay.remove();
}

if (document.body) {
  showAuthOverlay();
} else {
  document.addEventListener('DOMContentLoaded', showAuthOverlay);
}

// Si en 8 segundos la sesión no se resolvió (problema de red, o
// —muy común al probar con doble clic en el archivo, file://—
// la sesión guardada de Firebase no siempre se puede leer ahí),
// se trata como sesión inválida y se manda a login. Nunca se deja
// la app accesible sin una confirmación positiva.
const authTimeout = setTimeout(() => {
  window.location.href = 'login.html';
}, 8000);

// Debe coincidir EXACTO con el correo que tus reglas de Firebase
// reconocen como admin (ver firebase-database.rules.json) — se usa
// solo para crear el perfil de esa cuenta la primera vez que
// inicia sesión, no para decidir permisos (eso lo hacen las reglas).
const ADMIN_BOOTSTRAP_EMAIL = 'fevermiusiclog@gmail.com';

let currentUserRole = null; // 'admin' | 'vendedor'
let currentUserName = null; // nombre para mostrar y para marcar "quién hizo esto"
let currentUserUid  = null;

// Motivo por el que se manda de vuelta a login.html, para mostrar un
// mensaje claro en vez de un simple "vuelve a intentar" genérico.
function redirectToLogin(motivo) {
  window.location.href = 'login.html' + (motivo ? ('?motivo=' + encodeURIComponent(motivo)) : '');
}

const authReady = new Promise(resolve => {
  firebase.auth().onAuthStateChanged(async user => {
    clearTimeout(authTimeout);
    if (!user) {
      redirectToLogin();
      return;
    }

    let profile;
    try {
      profile = await getUserProfile(user.uid);
    } catch (err) {
      // Sin conexión a la base para confirmar el perfil = no se
      // asume nada, se trata igual que "sin sesión válida".
      redirectToLogin('error-conexion');
      return;
    }

    // Auto-arranque del admin: las reglas de Firebase (ver
    // firebase-database.rules.json) reconocen al admin por su
    // correo fijo, no por este perfil — así que en cuanto esa
    // cuenta inicia sesión por primera vez, ya tiene permiso de
    // escribir su propio registro en /users. Esto evita tener que
    // crearlo a mano en la consola la primera vez.
    if (!profile && user.email === ADMIN_BOOTSTRAP_EMAIL) {
      try {
        await refUsers.child(user.uid).set({
          nombre: 'Admin', correo: user.email, rol: 'admin', activo: true, creadoEn: Date.now(),
        });
        profile = await getUserProfile(user.uid);
      } catch (err) {
        // Si el auto-arranque falla (ej. sin red), sigue el camino
        // normal de abajo: sin perfil, no se deja pasar.
      }
    }

    // Cuenta de Firebase Auth que existe pero no tiene un perfil en
    // /users/{uid} (por ejemplo, se creó a mano en la consola y se
    // olvidaron de darle un rol) — no se asume ningún rol por
    // defecto, se bloquea hasta que el admin la configure bien.
    if (!profile || (profile.rol !== 'admin' && profile.rol !== 'vendedor')) {
      await firebase.auth().signOut();
      redirectToLogin('sin-perfil');
      return;
    }

    // activo !== false (no "=== true") a propósito: así, si alguna
    // cuenta antigua no tiene el campo "activo" explícito todavía,
    // no queda bloqueada por accidente. Pero en cuanto el admin la
    // apague una vez (activo:false), sí se respeta de inmediato.
    if (profile.activo === false) {
      await firebase.auth().signOut();
      redirectToLogin('deshabilitada');
      return;
    }

    currentUserRole = profile.rol;
    currentUserName = profile.nombre || user.email;
    currentUserUid  = user.uid;
    document.documentElement.classList.add('role-' + currentUserRole);
    hideAuthOverlay();

    // Vigilancia en tiempo real: si el admin desactiva esta cuenta
    // MIENTRAS la persona ya está usando la app (no al recargar, sino
    // en el momento mismo), este listener se entera de inmediato —
    // sin esperar a que la persona haga clic en nada ni a que un
    // guardado falle. En cuanto ve activo:false, la saca al instante:
    // overlay bloqueante + signOut + redirect a login. Así ningún
    // botón queda "vivo" un segundo de más después de ser desactivado.
    refUsers.child(user.uid).on('value', snap => {
      const liveProfile = snap.val();
      if (liveProfile && liveProfile.activo === false) {
        refUsers.child(user.uid).off('value');
        showAuthOverlay(); // bloquea la pantalla ya mismo, antes de que el signOut termine
        firebase.auth().signOut().then(() => {
          redirectToLogin('deshabilitada');
        });
      }
    });

    // Si la página tiene la tarjeta de usuario del sidebar, la
    // actualiza con el nombre y rol real, y la conecta para cerrar sesión.
    const userCard = document.querySelector('.user-card');
    if (userCard) {
      const nameEl = userCard.querySelector('.user-name');
      const roleEl = userCard.querySelector('.user-role');
      const avatarEl = userCard.querySelector('.avatar');
      if (nameEl)   nameEl.textContent = currentUserName;
      if (roleEl)   roleEl.textContent = currentUserRole === 'admin' ? 'Admin' : 'Vendedor';
      if (avatarEl) avatarEl.textContent = currentUserName.slice(0, 2).toUpperCase();
      userCard.style.cursor = 'pointer';
      userCard.title = 'Opciones de cuenta';
    }

    resolve({ user, role: currentUserRole, name: currentUserName, uid: currentUserUid });
  });
});

function isAdmin() {
  return currentUserRole === 'admin';
}

function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  if (typeof stopRealtimeWatchers === 'function') stopRealtimeWatchers();
  firebase.auth().signOut().then(() => {
    window.location.href = 'login.html';
  });
}

// Cambiar de cuenta: cierra la sesión actual y manda a la pantalla
// de login (login.html), sin la confirmación de "logout"
// normal — es una acción intencional de cambio, no un cierre final.
function switchAccount() {
  if (typeof stopRealtimeWatchers === 'function') stopRealtimeWatchers();
  firebase.auth().signOut().then(() => {
    window.location.href = 'login.html';
  });
}

// ── Menú de cuenta (tarjeta inferior del sidebar) ──────────────
// Al hacer clic en la tarjeta o en su flecha se abre un menú con
// dos opciones: "Cambiar de cuenta" y "Cerrar sesión". Antes un
// solo clic en la tarjeta cerraba sesión de inmediato.
document.addEventListener('DOMContentLoaded', () => {
  const userCard       = document.querySelector('.user-card');
  const userMenuToggle = document.getElementById('userMenuToggle');
  const userMenu       = document.getElementById('userMenu');
  const switchAccountBtn = document.getElementById('switchAccountBtn');

  if (!userCard || !userMenu) return;

  function openMenu() {
    userMenu.style.display = 'block';
    userCard.classList.add('menu-open');
  }
  function closeMenu() {
    userMenu.style.display = 'none';
    userCard.classList.remove('menu-open');
  }
  function toggleMenu(e) {
    e.stopPropagation();
    if (userMenu.style.display === 'none') openMenu(); else closeMenu();
  }

  userCard.addEventListener('click', toggleMenu);
  if (userMenuToggle) userMenuToggle.addEventListener('click', toggleMenu);

  if (switchAccountBtn) {
    switchAccountBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeMenu();
      switchAccount();
    });
  }

  document.addEventListener('click', e => {
    if (!userCard.contains(e.target) && !userMenu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
  });
});

// ── Botón de cerrar sesión visible (barra inferior de escritorio y
// móvil, dentro del menú de cuenta). Funciona igual para admin y
// vendedor — logout() no depende del rol, solo cierra la sesión
// de Firebase.
document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logoutBtn');
  const logoutNavItem = document.getElementById('logoutNavItem');

  if (logoutBtn) {
    logoutBtn.addEventListener('click', e => {
      e.stopPropagation(); // evita que el click también dispare el de .user-card
      logout();
    });
  }
  if (logoutNavItem) {
    logoutNavItem.addEventListener('click', e => {
      e.preventDefault();
      logout();
    });
  }
});