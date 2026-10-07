// functions/sanctions.js
// ─────────────────────────────────────────────────────────────────────────────
// Reglas del sistema de sanciones por bajas. Lógica PURA (sin Firestore): recibe
// las filas de `dropouts` y devuelve qué corresponde. Así se prueba sola
// (functions/sanctions.test.js) y las reglas no quedan enterradas en un trigger.
//
// Una "baja" es haberse anotado como TITULAR y después no estar (se bajó, o
// otro jugó en su lugar). Bajarse de suplente no cuelga a nadie, no cuenta.
//
// Ventana: los últimos 2 meses, POR GRUPO. La sanción se dispara si:
//   · 4 bajas, o
//   · 2 bajas tardías, o
//   · 3 bajas y al menos una tardía.
// "Tarde" = menos de 24hs antes del partido, o que lo hayan tenido que
// reemplazar (no vino). Bajarse con 5 días o más de anticipación NO cuenta: es
// avisar con tiempo, justo lo que la app quiere fomentar.
//
// Cumplir la sanción (anotarse una vez en "modo sanción") reinicia el conteo:
// las bajas anteriores a ese momento dejan de contar (`countedFromMs`).
// ─────────────────────────────────────────────────────────────────────────────

const HOUR_MS = 3600000
const DAY_MS = 24 * HOUR_MS

const SANCTION_WINDOW_MS = 60 * DAY_MS // "2 meses"
const SANCTION_FREE_HOURS = 120 // 5 días: con esta anticipación la baja no cuenta
const LATE_HOURS = 24 // por debajo de esto es "tarde"

const MAX_BAJAS = 4
const MAX_TARDES = 2
const MAX_BAJAS_WITH_LATE = 3

/**
 * @param {Array<{ kind, hoursBeforeMatch, wasStarter, droppedAtMs }>} rows
 *        filas de `dropouts` de UN usuario en UN grupo
 * @param {number} nowMs
 * @param {number} countedFromMs  las bajas con droppedAtMs <= esto ya se "pagaron"
 * @returns {{ bajas: number, tardes: number, triggers: boolean, reason: string|null }}
 */
function evaluateSanction(rows, nowMs, countedFromMs = 0) {
  let bajas = 0
  let tardes = 0

  for (const r of rows) {
    if (r.wasStarter === false) continue // suplente: no dejó a nadie colgado
    const at = r.droppedAtMs ?? 0
    if (at <= countedFromMs) continue // ya cumplida una sanción posterior
    if (nowMs - at > SANCTION_WINDOW_MS) continue // fuera de los 2 meses

    const hours = r.hoursBeforeMatch
    // Sin dato de anticipación no se puede juzgar: no se castiga a ciegas.
    if (typeof hours !== 'number') continue
    if (hours >= SANCTION_FREE_HOURS) continue // avisó con 5 días o más

    bajas += 1
    if (r.kind === 'replaced' || hours < LATE_HOURS) tardes += 1
  }

  let reason = null
  if (bajas >= MAX_BAJAS) reason = 'bajas'
  else if (tardes >= MAX_TARDES) reason = 'tardes'
  else if (bajas >= MAX_BAJAS_WITH_LATE && tardes >= 1) reason = 'mixta'

  return { bajas, tardes, triggers: reason !== null, reason }
}

/**
 * Orden de una lista con sanciones: los sancionados van DETRÁS de los demás
 * (cada grupo conserva su orden de llegada). Con lugar de sobra no cambia nada
 * —todos son titulares igual—; recién cuando la lista se llena y entra alguien
 * sin sanción, el sancionado queda del lado de los suplentes.
 *
 * @param {Array<{ penalized?: boolean, position?: number|null }>} regs
 */
function sortWithPenalties(regs) {
  const pos = (r) => (typeof r.position === 'number' ? r.position : Number.MAX_SAFE_INTEGER)
  return [...regs].sort((a, b) => {
    const pa = a.penalized === true ? 1 : 0
    const pb = b.penalized === true ? 1 : 0
    if (pa !== pb) return pa - pb
    return pos(a) - pos(b)
  })
}

module.exports = {
  SANCTION_WINDOW_MS,
  SANCTION_FREE_HOURS,
  LATE_HOURS,
  evaluateSanction,
  sortWithPenalties,
}
