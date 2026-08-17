// src/utils/notifications.js
// ─────────────────────────────────────────────────────────────────────────────
//  Categorías de notificación push y sus valores por defecto.
//
//  Cada push que manda la app pertenece a UNA categoría. El usuario las apaga
//  o prende desde su perfil; el filtro real lo aplica el backend en
//  `collectTokensFromUserDocs` (functions/index.js), que es el único punto por
//  el que pasan todos los envíos.
//
//  ⚠️ Estas claves y sus defaults tienen que coincidir EXACTAMENTE con
//  NOTIFICATION_CATEGORIES / NOTIFICATION_DEFAULTS en functions/index.js. Si
//  divergen, el usuario ve un interruptor que no corresponde a lo que el
//  backend consulta: apaga algo y le sigue llegando.
// ─────────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_CATEGORIES = {
  MY_GROUPS: 'myGroups',
  PUBLIC_NEARBY: 'publicNearby',
  APPLICATIONS: 'applications',
  CHAT: 'chat',
}

// Default de cada categoría cuando el usuario nunca la configuró.
// `publicNearby` nace APAGADA a propósito: es la única que avisa sobre partidos
// de gente que el usuario no conoce, así que es opt-in explícito.
export const NOTIFICATION_DEFAULTS = {
  [NOTIFICATION_CATEGORIES.MY_GROUPS]: true,
  [NOTIFICATION_CATEGORIES.PUBLIC_NEARBY]: false,
  [NOTIFICATION_CATEGORIES.APPLICATIONS]: true,
  [NOTIFICATION_CATEGORIES.CHAT]: true,
}

// Cómo se muestran en el perfil. El orden es el de la lista en pantalla.
export const NOTIFICATION_OPTIONS = [
  {
    key: NOTIFICATION_CATEGORIES.MY_GROUPS,
    label: 'Mis grupos',
    description: 'Se abre una lista, recordatorios, se liberó un cupo, entrás de suplente.',
  },
  {
    key: NOTIFICATION_CATEGORIES.APPLICATIONS,
    label: 'Postulaciones',
    description: 'Alguien se quiere sumar a tu partido, o te aceptaron en uno.',
  },
  {
    key: NOTIFICATION_CATEGORIES.CHAT,
    label: 'Chat del partido',
    description: 'Mensajes nuevos en los partidos donde estás anotado.',
  },
  {
    key: NOTIFICATION_CATEGORIES.PUBLIC_NEARBY,
    label: 'Partidos abiertos',
    description: 'Cuando se publica un partido que busca jugadores. Viene apagado.',
  },
]

/**
 * Completa las preferencias guardadas con los defaults de las categorías que
 * el usuario nunca tocó. Devuelve siempre un objeto con TODAS las claves, así
 * los toggles de la UI nunca quedan en `undefined` (que Quasar renderiza como
 * apagado aunque el default sea prendido).
 */
export function withNotificationDefaults(prefs) {
  const result = { ...NOTIFICATION_DEFAULTS }
  if (prefs && typeof prefs === 'object') {
    Object.keys(NOTIFICATION_DEFAULTS).forEach((key) => {
      if (typeof prefs[key] === 'boolean') result[key] = prefs[key]
    })
  }
  return result
}
