// src/utils/podium.js
// ─────────────────────────────────────────────────────────────────────────────
// Podio de una votación cerrada (MVP / Muralla).
//
// El ganador ya lo fija la Cloud Function que cierra la votación; esto es solo
// para MOSTRAR. Existe porque una votación con un solo nombre premiado deja
// afuera a los que quedaron cerquísima: el que salió segundo por un voto se
// entera de exactamente nada. Con tres puestos, la misma votación reconoce a
// más gente sin inventar premios nuevos ni tocar las stats.
//
// Los empates COMPARTEN puesto (dos primeros, después un tercero) — es lo que
// ya pasa en la lógica de cierre, donde un empate arriba deja el partido sin
// MVP. Desempatar por orden alfabético o por quién votó antes sería inventar
// un resultado que la votación no dio.
// ─────────────────────────────────────────────────────────────────────────────

export const PODIUM_PLACES = 3

export const PODIUM_MEDALS = ['🥇', '🥈', '🥉']

/**
 * Convierte un recuento de votos en los primeros PODIUM_PLACES puestos.
 * @param {Map<string, number>} tally  votedForUserId → cantidad de votos
 * @returns {Array<{userId: string, votes: number, place: number}>}
 */
export function buildPodium(tally) {
  const ordenados = [...tally.entries()].sort((a, b) => b[1] - a[1])

  const podio = []
  let puesto = 0
  let votosDelPuestoActual = null

  for (const [userId, votes] of ordenados) {
    // Mismo número de votos ⇒ mismo puesto; recién con menos votos se avanza.
    if (votes !== votosDelPuestoActual) {
      puesto += 1
      votosDelPuestoActual = votes
    }
    if (puesto > PODIUM_PLACES) break
    podio.push({ userId, votes, place: puesto })
  }

  return podio
}
