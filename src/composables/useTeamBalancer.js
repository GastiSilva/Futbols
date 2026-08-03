// src/composables/useTeamBalancer.js
// ─────────────────────────────────────────────────────────────────────────────
// Sugerencia de equipos balanceados (A/B) a partir de estadísticas
// individuales, posición preferida y "química" (historial de resultados
// jugando en el mismo equipo). Función pura — no toca Firestore, recibe los
// datos ya armados por el caller (PostMatchPage.vue).
//
// No es una restricción dura: la química es un bonus en la función de costo,
// no obliga a juntar a nadie. Con n ≤ 22 jugadores no hace falta un algoritmo
// exacto (DP sobre subconjuntos sería exponencial e inviable) — alcanza con
// una partición greedy + varias aleatorias, quedándose con la de menor costo.
// ─────────────────────────────────────────────────────────────────────────────
import { getPosition } from 'src/utils/positions'

const W_STRENGTH = 10
const W_POSITION = 3
const W_CHEMISTRY = 2
const DEFAULT_ITERATIONS = 200

// Tope de involucramiento en gol por partido usado para normalizar a [0,1].
const GOAL_INVOLVEMENT_CAP = 1.5
// Tope de partidos-juntos considerados al ponderar química (evita sobre-pesar duplas muy repetidas).
const CHEMISTRY_GAMES_CAP = 5

// ── Fuerza individual ─────────────────────────────────────────────────────
// 60% win-rate, 30% involucramiento en gol por partido, 10% experiencia.
// Sin historial (matchesPlayed === 0) → 0.5 (neutro, no penaliza falta de datos).
function playerStrength(player) {
  const s = player.stats ?? {}
  const matchesPlayed = s.matchesPlayed ?? 0
  if (matchesPlayed === 0) return 0.5

  const winRate = (s.wins ?? 0) / matchesPlayed
  const goalInvolvement = ((s.goals ?? 0) + (s.assists ?? 0)) / matchesPlayed
  const goalInvolvementNorm = Math.min(goalInvolvement / GOAL_INVOLVEMENT_CAP, 1)
  const experienceFactor = Math.min(matchesPlayed / 10, 1)

  return 0.6 * winRate + 0.3 * goalInvolvementNorm + 0.1 * experienceFactor
}

// ── Zona de posición preferida (primer código elegido, o null) ────────────
function playerZone(player) {
  const code = (player.preferredPositions ?? [])[0]
  if (!code) return null
  return getPosition(code)?.zone ?? null
}

// ── Química entre dos jugadores (0 si nunca compartieron equipo) ──────────
function pairChemistryScore(a, b) {
  const chem = a.chemistry?.get(b.userId)
  if (!chem || !chem.gamesTogether) return 0
  const winRateTogether = chem.winsTogether / chem.gamesTogether
  return winRateTogether * (Math.min(chem.gamesTogether, CHEMISTRY_GAMES_CAP) / CHEMISTRY_GAMES_CAP)
}

function teamChemistryScore(team) {
  let score = 0
  for (let i = 0; i < team.length; i++) {
    for (let j = i + 1; j < team.length; j++) {
      score += pairChemistryScore(team[i], team[j])
    }
  }
  return score
}

function positionImbalance(teamA, teamB) {
  const zones = ['arco', 'defensa', 'medio', 'ataque']
  const countByZone = (team) => {
    const counts = Object.fromEntries(zones.map((z) => [z, 0]))
    team.forEach((p) => {
      const z = playerZone(p)
      if (z) counts[z] += 1
    })
    return counts
  }
  const countsA = countByZone(teamA)
  const countsB = countByZone(teamB)
  return zones.reduce((sum, z) => sum + Math.abs(countsA[z] - countsB[z]), 0)
}

function cost(teamA, teamB) {
  const strengthDiff = Math.abs(
    teamA.reduce((sum, p) => sum + playerStrength(p), 0) -
    teamB.reduce((sum, p) => sum + playerStrength(p), 0),
  )
  const posImbalance = positionImbalance(teamA, teamB)
  const chemistryScore = teamChemistryScore(teamA) + teamChemistryScore(teamB)

  return W_STRENGTH * strengthDiff + W_POSITION * posImbalance - W_CHEMISTRY * chemistryScore
}

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Draft serpiente: ordena por fuerza descendente y reparte alternando A/B/B/A
// para que ambos equipos arranquen con fuerza agregada similar.
function greedyPartition(players, teamSize) {
  const sorted = players.slice().sort((a, b) => playerStrength(b) - playerStrength(a))
  const teamA = []
  const teamB = []
  sorted.forEach((p, i) => {
    const round = Math.floor(i / 2)
    const pickA = round % 2 === 0 ? i % 2 === 0 : i % 2 === 1
    ;(pickA ? teamA : teamB).push(p)
  })
  return balanceSizes(teamA, teamB, teamSize)
}

function randomPartition(players, teamSize) {
  const shuffled = shuffle(players)
  return { teamA: shuffled.slice(0, teamSize), teamB: shuffled.slice(teamSize) }
}

// Si greedyPartition dejó los equipos desparejos en tamaño (n impar / draft
// serpiente puede desbalancear), mueve jugadores del más grande al más chico.
function balanceSizes(teamA, teamB, teamSize) {
  const a = teamA.slice()
  const b = teamB.slice()
  while (a.length > teamSize && b.length < a.length - 1) b.push(a.pop())
  while (b.length > teamSize + 1 && a.length < b.length - 1) a.push(b.pop())
  return { teamA: a, teamB: b }
}

/**
 * Sugiere una partición A/B balanceada por fuerza + posición, con química
 * como bonus (no restricción dura).
 *
 * @param {Array<{
 *   userId: string,
 *   displayName: string,
 *   stats?: { goals, assists, matchesPlayed, wins, draws, losses },
 *   preferredPositions?: string[],
 *   chemistry?: Map<string, { gamesTogether, winsTogether, drawsTogether, lossesTogether }>,
 * }>} players
 * @param {number} [iterations]
 * @returns {{ teamA: Array, teamB: Array }} misma forma de los objetos de entrada, particionados
 */
export function suggestTeams(players, iterations = DEFAULT_ITERATIONS) {
  if (!Array.isArray(players) || players.length < 2) {
    return { teamA: players ?? [], teamB: [] }
  }

  const teamSize = Math.floor(players.length / 2)
  let best = null
  let bestCost = Infinity

  for (let iter = 0; iter < iterations; iter++) {
    const { teamA, teamB } = iter === 0
      ? greedyPartition(players, teamSize)
      : randomPartition(players, teamSize)

    const c = cost(teamA, teamB)
    if (c < bestCost) {
      bestCost = c
      best = { teamA, teamB }
    }
  }

  return best
}

export function useTeamBalancer() {
  return { suggestTeams }
}
