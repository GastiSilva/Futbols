// src/utils/errors.js
// ─────────────────────────────────────────────────────────────────────────────
// Traductor ÚNICO de errores para mostrarle al usuario.
//
// Antes cada pantalla mostraba `err.message` tal cual: si el error era nuestro
// ("Ya estás anotado") se leía bien, pero si venía de Firebase el jugador veía
// "Missing or insufficient permissions." en inglés, o —peor— la inscripción lo
// tapaba todo con "Error de concurrencia", que casi nunca era el problema real.
//
// `errorMessage(err)` resuelve las tres familias:
//   - Errores nuestros (new Error('texto en castellano')) → se respetan.
//   - Errores de Firebase (traen `code`) → un texto claro por código.
//   - Errores de programación (TypeError, etc.) → mensaje genérico; el detalle
//     técnico NO se le muestra al usuario pero sí queda en la consola.
// Siempre se loguea el error original con su código: es lo que permite saber
// qué pasó de verdad cuando alguien manda una captura.
// ─────────────────────────────────────────────────────────────────────────────

const GENERIC = 'Algo salió mal. Probá de nuevo en un momento.'

// Firestore y Cloud Functions comparten los códigos (gRPC). Las Functions los
// traen con prefijo "functions/".
const FIREBASE_MESSAGES = {
  'permission-denied': 'No tenés permiso para hacer esto.',
  unauthenticated: 'Tu sesión venció. Volvé a iniciar sesión.',
  unavailable: 'No hay conexión con el servidor. Revisá tu internet y probá de nuevo.',
  'deadline-exceeded': 'El servidor tardó demasiado en responder. Revisá tu internet y probá de nuevo.',
  'not-found': 'Lo que buscás ya no existe (puede que lo hayan borrado).',
  'already-exists': 'Eso ya existe.',
  aborted: 'Mucha gente tocó lo mismo a la vez y no se pudo guardar. Probá de nuevo.',
  'resource-exhausted': 'Demasiados intentos seguidos. Esperá un minuto y probá de nuevo.',
  'failed-precondition': 'No se puede hacer esto en este momento.',
  'invalid-argument': 'Hay datos inválidos. Revisá lo que cargaste.',
  'out-of-range': 'Hay datos fuera de rango. Revisá lo que cargaste.',
  cancelled: 'La operación se canceló.',
  internal: 'Falló el servidor. Probá de nuevo en un momento.',
  unknown: GENERIC,
  'data-loss': GENERIC,
  unimplemented: GENERIC,
}

const AUTH_MESSAGES = {
  'auth/network-request-failed': 'No hay conexión. Revisá tu internet y probá de nuevo.',
  'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
  'auth/popup-closed-by-user': 'Cerraste la ventana de inicio de sesión antes de terminar.',
  'auth/cancelled-popup-request': 'Cerraste la ventana de inicio de sesión antes de terminar.',
  'auth/popup-blocked': 'El navegador bloqueó la ventana de inicio de sesión. Habilitá las ventanas emergentes.',
  'auth/invalid-credential': 'Email o contraseña incorrectos.',
  'auth/wrong-password': 'Email o contraseña incorrectos.',
  'auth/user-not-found': 'No hay ninguna cuenta con ese email.',
  'auth/invalid-email': 'El email no es válido.',
  'auth/email-already-in-use': 'Ya hay una cuenta con ese email. Iniciá sesión.',
  'auth/weak-password': 'La contraseña es muy corta (mínimo 6 caracteres).',
  'auth/requires-recent-login': 'Por seguridad, volvé a iniciar sesión y repetí la acción.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada.',
}

// Errores de JavaScript: son bugs nuestros, su texto no le sirve al usuario.
const PROGRAMMING_ERRORS = ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError']

// Código "pelado" (sin el prefijo functions/ o firestore/).
export function errorCode(err) {
  const code = err?.code
  if (typeof code !== 'string') return null
  return code.replace(/^(functions|firestore)\//, '')
}

/**
 * Texto claro para mostrarle al usuario a partir de cualquier error.
 * @param {unknown} err
 * @param {{ fallback?: string, overrides?: Record<string, string>, context?: string }} [opts]
 *   overrides: texto específico por código para ESTA acción (ej. qué significa
 *   permission-denied al anotarse). context: etiqueta para el log de consola.
 */
export function errorMessage(err, { fallback = GENERIC, overrides = {}, context = 'error' } = {}) {
  console.error(`[${context}]`, errorCode(err) ?? '', err)

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'Estás sin conexión. Revisá tu internet y probá de nuevo.'
  }
  if (!err) return fallback

  const rawCode = err.code
  const code = errorCode(err)

  if (code && overrides[code]) return overrides[code]
  if (typeof rawCode === 'string' && rawCode.startsWith('auth/')) {
    return AUTH_MESSAGES[rawCode] ?? fallback
  }
  if (code && FIREBASE_MESSAGES[code]) {
    // Las Cloud Functions propias tiran HttpsError con el mensaje ya en
    // castellano ("Ya se reenvió el aviso hace poco…"): ese texto es más
    // preciso que el genérico del código. Solo se descarta si viene vacío o es
    // el nombre del código en inglés (lo que manda Firebase cuando la función
    // explota sin un HttpsError propio: "internal", "INTERNAL").
    if (typeof rawCode === 'string' && rawCode.startsWith('functions/')) {
      const msg = (err.message ?? '').trim()
      if (msg && msg.toLowerCase() !== code && msg.toLowerCase() !== code.replace(/-/g, ' ')) {
        return msg
      }
    }
    return FIREBASE_MESSAGES[code]
  }
  if (PROGRAMMING_ERRORS.includes(err.name)) return fallback

  // Error nuestro (new Error('…') con texto pensado para el usuario).
  const msg = typeof err === 'string' ? err : err.message
  return msg?.trim() ? msg : fallback
}
