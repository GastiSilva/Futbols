// functions/mundial-rules.js
// ─────────────────────────────────────────────────────────────────────────────
// Reglas puras del "Mundial personal" — modo de juego individual y opcional
// donde cada jugador avanza de fase según los resultados reales de los
// partidos que juega mientras lo tiene activo (cualquier partido, de
// cualquier grupo). Sin I/O: recibe el estado actual + un resultado, y
// devuelve la transición a aplicar. La escritura a Firestore vive en
// index.js (advancePlayerMundial / revealMundialCoinFlip).
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto')

const PHASE_AFTER_GROUPS = 'round_of_32'
const KNOCKOUT_ORDER = ['round_of_32', 'round_of_16', 'quarter', 'semi', 'final']

// ── Fase de grupos ──────────────────────────────────────────────────────────
// Se evalúa SIEMPRE con los 3 resultados reales (nunca se corta antes, aunque
// ya esté matemáticamente decidido con 2) — así lo pidió el usuario, fiel al
// enunciado "los primeros 3 partidos".
function evaluateGroupPhase(results) {
  if (results.length < 3) return { type: 'noop_group_result' }

  const wins = results.filter((r) => r === 'W').length
  const draws = results.filter((r) => r === 'E').length
  const losses = results.filter((r) => r === 'L').length

  if (wins >= 2 || (draws === 2 && wins === 1)) {
    return { type: 'classify_knockout' }
  }
  if (wins === 1 && draws === 1 && losses === 1) {
    return { type: 'pending_coin_flip', kind: 'groups_4pts' }
  }
  return { type: 'eliminated' }
}

// ── Eliminación directa (octavos → cuartos → semis → final) ────────────────
function evaluateKnockoutPhase(phase, result) {
  if (result === 'L') return { type: 'eliminated' }
  if (result === 'E') return { type: 'pending_coin_flip', kind: 'knockout_draw' }

  // result === 'W'
  if (phase === 'final') return { type: 'champion' }
  const idx = KNOCKOUT_ORDER.indexOf(phase)
  const nextPhase = KNOCKOUT_ORDER[idx + 1]
  return { type: 'advance_knockout', nextPhase }
}

/**
 * Dado el estado actual del Mundial de un jugador (con active:true) y el
 * resultado real de un partido recién guardado, calcula la transición.
 *
 * @param {object} mundial - users/{uid}.mundial actual
 * @param {'W'|'E'|'L'} result
 * @param {string} matchId - id del partido que originó el resultado (seed del coin flip)
 * @param {string} uid - dueño del Mundial (seed del coin flip)
 * @returns {{
 *   type: 'noop_group_result' | 'classify_knockout' | 'eliminated' |
 *         'advance_knockout' | 'champion' | 'pending_coin_flip',
 *   kind?: 'groups_4pts' | 'knockout_draw',
 *   nextPhase?: string,
 *   patch: object,
 * }}
 */
function computeMundialTransition(mundial, result, matchId, uid) {
  if (mundial.phase === 'groups') {
    const groupMatchResults = [...(mundial.groupMatchResults ?? []), result]
    const outcome = evaluateGroupPhase(groupMatchResults)

    if (outcome.type === 'noop_group_result') {
      return { type: 'noop_group_result', patch: { 'mundial.groupMatchResults': groupMatchResults } }
    }
    if (outcome.type === 'classify_knockout') {
      return {
        type: 'classify_knockout',
        patch: {
          'mundial.groupMatchResults': groupMatchResults,
          'mundial.phase': PHASE_AFTER_GROUPS,
        },
      }
    }
    if (outcome.type === 'pending_coin_flip') {
      return {
        type: 'pending_coin_flip',
        kind: outcome.kind,
        patch: {
          'mundial.groupMatchResults': groupMatchResults,
          'mundial.pendingCoinFlip': buildPendingCoinFlip(mundial, outcome.kind, matchId, uid),
        },
      }
    }
    // eliminated
    return {
      type: 'eliminated',
      patch: {
        'mundial.groupMatchResults': groupMatchResults,
      },
    }
  }

  // Fases de eliminación directa
  const outcome = evaluateKnockoutPhase(mundial.phase, result)

  if (outcome.type === 'advance_knockout') {
    return { type: 'advance_knockout', nextPhase: outcome.nextPhase, patch: { 'mundial.phase': outcome.nextPhase } }
  }
  if (outcome.type === 'champion') {
    return { type: 'champion', patch: {} }
  }
  if (outcome.type === 'pending_coin_flip') {
    return {
      type: 'pending_coin_flip',
      kind: outcome.kind,
      patch: { 'mundial.pendingCoinFlip': buildPendingCoinFlip(mundial, outcome.kind, matchId, uid) },
    }
  }
  // eliminated
  return { type: 'eliminated', patch: {} }
}

// ── Coin flip: seed determinístico congelado en el momento de la ambigüedad ─
// Depende de datos que el cliente no controla (uid, matchId, startedAt del
// Mundial activo) — el resultado queda decidido ANTES de que el cliente sepa
// que existe un sorteo pendiente; la animación solo lo revela.
function generateCoinFlipSeed(uid, matchId, startedAtMillis) {
  return crypto.createHash('sha256').update(`${uid}:${matchId}:${startedAtMillis}`).digest('hex')
}

function resolveCoinFlipOutcome(seed) {
  return parseInt(seed.slice(0, 8), 16) % 2 === 0 ? 'advance' : 'eliminate'
}

function buildPendingCoinFlip(mundial, kind, matchId, uid) {
  const startedAtMillis = mundial.startedAt?.toMillis?.() ?? mundial.startedAt?._seconds * 1000 ?? 0
  const seed = generateCoinFlipSeed(uid, matchId, startedAtMillis)
  return {
    kind,
    seed,
    outcome: resolveCoinFlipOutcome(seed),
    matchId,
    resolved: false,
  }
}

/**
 * Aplica el outcome ya congelado de un coin flip resuelto (llamado desde
 * revealMundialCoinFlip). Reusa las mismas transiciones que un resultado
 * real: 'advance' se comporta como clasificar/avanzar, 'eliminate' como
 * quedar eliminado.
 *
 * @param {object} mundial - estado actual, con pendingCoinFlip.outcome ya fijado
 * @returns {{ type: string, nextPhase?: string, patch: object }}
 */
function resolvePendingCoinFlip(mundial) {
  const { kind, outcome } = mundial.pendingCoinFlip

  if (outcome === 'eliminate') {
    return { type: 'eliminated', patch: {} }
  }

  // outcome === 'advance'
  if (kind === 'groups_4pts') {
    return { type: 'classify_knockout', patch: { 'mundial.phase': PHASE_AFTER_GROUPS } }
  }
  // knockout_draw
  if (mundial.phase === 'final') {
    return { type: 'champion', patch: {} }
  }
  const idx = KNOCKOUT_ORDER.indexOf(mundial.phase)
  const nextPhase = KNOCKOUT_ORDER[idx + 1]
  return { type: 'advance_knockout', nextPhase, patch: { 'mundial.phase': nextPhase } }
}

module.exports = {
  computeMundialTransition,
  evaluateGroupPhase,
  evaluateKnockoutPhase,
  generateCoinFlipSeed,
  resolveCoinFlipOutcome,
  resolvePendingCoinFlip,
  KNOCKOUT_ORDER,
}
