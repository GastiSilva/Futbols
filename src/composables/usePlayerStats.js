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
  increment,
  serverTimestamp,
  getDocs,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'

// Esquema de una entrada de estadísticas individuales:
// matches/{matchId}/playerStats/{userId}
// { userId, displayName, goals, assists, team: 'A'|'B' }

export function usePlayerStats() {
  const loading = ref(false)
  const error = ref(null)

  /**
   * Guarda las estadísticas individuales de un partido y acumula en 'users'.
   * Usa writeBatch para garantizar atomicidad (todo o nada).
   * Acumula tanto el total individual (stats) como el desglose por grupo
   * (statsByGroup.{groupId}), si el partido pertenece a un grupo.
   *
   * @param {string} matchId
   * @param {Array<{ userId, displayName, goals, assists, team }>} statsArray
   * @param {string | null} groupId
   */
  async function savePlayerStats(matchId, statsArray, groupId = null) {
    loading.value = true
    error.value = null

    try {
      // Firestore Batch: máximo 500 operaciones por batch
      // Si statsArray > 250 jugadores deberías dividirlo (poco probable en fútbol amateur)
      const batch = writeBatch(db)

      for (const entry of statsArray) {
        // 1. Escribe el documento de stats dentro del partido
        const statRef = doc(db, 'matches', matchId, 'playerStats', entry.userId)
        batch.set(statRef, {
          userId: entry.userId,
          displayName: entry.displayName,
          goals: entry.goals ?? 0,
          assists: entry.assists ?? 0,
          team: entry.team ?? null,
          savedAt: serverTimestamp(),
        })

        // 2. Incrementa las estadísticas acumuladas en el perfil del usuario
        const userRef = doc(db, 'users', entry.userId)
        const updates = {
          'stats.goals': increment(entry.goals ?? 0),
          'stats.assists': increment(entry.assists ?? 0),
          'stats.matchesPlayed': increment(1),
          updatedAt: serverTimestamp(),
        }

        // 3. Además, acumula el desglose por grupo (si el partido es de un grupo)
        if (groupId) {
          updates[`statsByGroup.${groupId}.goals`] = increment(entry.goals ?? 0)
          updates[`statsByGroup.${groupId}.assists`] = increment(entry.assists ?? 0)
          updates[`statsByGroup.${groupId}.matchesPlayed`] = increment(1)
        }

        batch.update(userRef, updates)
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
