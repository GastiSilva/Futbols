// src/utils/badges.js
// ─────────────────────────────────────────────────────────────────────────────
//  Catálogo de insignias mensuales.
//
//  Una insignia es un HECHO HISTÓRICO congelado: "Fulano fue el goleador de
//  agosto en tal grupo". No se recalcula ni se pierde — por eso vive como
//  documento en users/{uid}/badges y no como un `computed` sobre las stats.
//
//  ⚠️ Las claves de BADGE_TYPES tienen que coincidir EXACTAMENTE con las de
//  functions/index.js (BADGE_DEFS). El backend decide QUIÉN gana; este archivo
//  solo decide CÓMO se ve. Si divergen, la insignia se otorga pero se dibuja
//  como desconocida.
// ─────────────────────────────────────────────────────────────────────────────

export const BADGE_TYPES = {
  TOP_SCORER: 'topScorer',
  TOP_ASSISTS: 'topAssists',
  TOP_MVP: 'topMvp',
  ALWAYS_THERE: 'alwaysThere',
}

// `unit` se usa para armar el subtítulo ("12 goles"), en singular y plural.
//
// `art` es la ilustración del premio (PNG con transparencia, 128px, en
// public/badges/). Reemplaza al ícono de Material que había antes: un trofeo
// dibujado se lee como un premio, un glifo monocromo se lee como un ítem de
// menú. `color` sobrevive como color de acento del contorno, no de relleno.
export const BADGE_DEFS = {
  [BADGE_TYPES.TOP_SCORER]: {
    label: 'Botín de Oro',
    art: 'badges/botin-oro.png',
    color: 'amber-8',
    unit: ['gol', 'goles'],
    blurb: 'El que más goles metió en el mes.',
  },
  [BADGE_TYPES.TOP_ASSISTS]: {
    label: 'Pies de Seda',
    // El mismo botín, virado a rojo plateado: el asistidor hace lo mismo que
    // el goleador pero para otro, así que comparte forma y cambia el metal.
    art: 'badges/botin-rubi.png',
    color: 'red-8',
    unit: ['asistencia', 'asistencias'],
    blurb: 'El que más asistencias dio en el mes.',
  },
  [BADGE_TYPES.TOP_MVP]: {
    label: 'Figura del Mes',
    art: 'badges/copa-mvp.png',
    color: 'amber-9',
    unit: ['MVP', 'MVPs'],
    blurb: 'El que más veces fue elegido la figura del partido.',
  },
  // Medalla, no trofeo: premia CONSTANCIA, no rendimiento. Si fuera otra copa
  // más, la vitrina sería una repisa de trofeos donde ninguno se distingue.
  [BADGE_TYPES.ALWAYS_THERE]: {
    label: 'Presente',
    art: 'badges/medalla-presente.png',
    color: 'green-8',
    unit: ['partido', 'partidos'],
    blurb: 'No faltó a ningún partido del grupo en el mes.',
    // El valor es cuántos partidos tuvo el grupo, y los jugó todos: "5 de 5"
    // dice eso mucho mejor que "5 partidos", que se leería como un conteo suelto.
    format: (value, unit) => `${value} de ${value} ${unit}`,
  },
}

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * '2026-08' → 'agosto 2026'. Period es un string y no un Timestamp a propósito:
 * es la CLAVE del premio (entra en el id del documento), no un instante.
 */
export function formatPeriod(period) {
  if (typeof period !== 'string') return ''
  const [year, month] = period.split('-')
  const idx = Number(month) - 1
  if (!MONTH_NAMES[idx]) return period
  return `${MONTH_NAMES[idx]} ${year}`
}

/**
 * Texto de una insignia, listo para pintar.
 *
 * `showGroup` es un tema de PRIVACIDAD, no de estética: ProfileViewPage oculta
 * `statsByGroup` a los desconocidos porque expone el mapa social de la persona
 * (en qué grupos juega). Una insignia que dijera "Goleador — Los Pibes del
 * Martes" filtraría exactamente eso por la ventana. Al desconocido se le
 * muestra el premio sin el nombre del grupo.
 */
export function describeBadge(badge, { showGroup = false } = {}) {
  const def = BADGE_DEFS[badge?.type]
  if (!def) return null

  const value = Number(badge.value) || 0
  const unit = value === 1 ? def.unit[0] : def.unit[1]
  const amount = def.format ? def.format(value, unit) : `${value} ${unit}`

  const parts = [amount, formatPeriod(badge.period)]
  if (showGroup && badge.groupName) parts.push(badge.groupName)

  return {
    label: def.label,
    art: def.art,
    color: def.color,
    blurb: def.blurb,
    detail: parts.filter(Boolean).join(' · '),
  }
}
