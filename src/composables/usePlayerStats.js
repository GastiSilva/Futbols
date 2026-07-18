// src/composables/usePlayerStats.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable para cargar estadísticas individuales post-partido y actualizar
// los contadores acumulados en 'users' usando Firestore Batch Writes.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import {
  doc,
  collection,
  writeBatch,
  serverTimestamp,
  getDocs,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'

// Esquema de una entrada de estadísticas individuales:
// matches/{matchId}/playerStats/{userId}
// { userId, displayName, goals, assists, team: 'A'|'B'|null, groupId }
//
// IMPORTANTE: el acumulador en users/{uid} (stats + statsByGroup) lo actualiza
// la Cloud Function `onPlayerStatsWritten` por DIFERENCIA (idempotente). El
// cliente NUNCA escribe el perfil de otro usuario — así cualquier miembro del
// grupo puede cargar el resultado sin poder inflar stats ajenas ni duplicar
// al re-guardar.

// Resultado del jugador según su equipo y el marcador del partido.
// 'W' = ganó, 'E' = empató, 'L' = perdió, null = sin marcador o sin equipo.
// Se guarda EN la fila para que el acumulador (CF) lo cuente por diferencia y
// quede correcto aunque después se edite el marcador (se recalcula al re-guardar).
export function computeResult(team, scoreA, scoreB) {
  if (scoreA == null || scoreB == null) return null
  if (team !== 'A' && team !== 'B') return null
  if (scoreA === scoreB) return 'E'
  const teamAWon = scoreA > scoreB
  if (team === 'A') return teamAWon ? 'W' : 'L'
  return teamAWon ? 'L' : 'W'
}

export function usePlayerStats() {
  const loading = ref(false)
  const error = ref(null)

  /**
   * Guarda las estadísticas individuales de un partido dentro del propio partido.
   * Solo se escriben jugadores con cuenta (userId presente); los invitados no
   * acumulan stats porque no tienen perfil.
   *
   * @param {string} matchId
   * @param {Array<{ userId, displayName, goals, assists, team }>} statsArray
   * @param {string | null} groupId
   * @param {{ scoreA: number|null, scoreB: number|null }} score  Marcador para
   *        derivar el resultado (W/E/L) de cada jugador según su equipo.
   */
  async function savePlayerStats(matchId, statsArray, groupId = null, score = {}) {
    loading.value = true
    error.value = null

    const { scoreA = null, scoreB = null } = score

    try {
      // Firestore Batch: máximo 500 operaciones por batch
      const batch = writeBatch(db)

      for (const entry of statsArray) {
        if (!entry.userId) continue // invitados sin cuenta: no acumulan

        const statRef = doc(db, 'matches', matchId, 'playerStats', entry.userId)
        batch.set(statRef, {
          userId: entry.userId,
          displayName: entry.displayName ?? null,
          goals: entry.goals ?? 0,
          assists: entry.assists ?? 0,
          mvp: entry.mvp === true, // MVP del partido (acumula stats.mvps vía CF)
          team: entry.team ?? null,
          result: computeResult(entry.team ?? null, scoreA, scoreB), // W/E/L/null
          groupId: groupId ?? null,
          savedAt: serverTimestamp(),
        })
      }

      await batch.commit()
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Obtiene las estadísticas individuales de un partido ya finalizado.
   * @param {string} matchId
   */
  async function fetchPlayerStats(matchId) {
    const snap = await getDocs(collection(db, 'matches', matchId, 'playerStats'))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }

  return { loading, error, savePlayerStats, fetchPlayerStats }
}
