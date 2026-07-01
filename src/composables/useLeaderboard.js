// src/composables/useLeaderboard.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable para el ranking de goleadores y asistidores POR GRUPO.
// El ranking siempre requiere un grupo: cada grupo lleva su propio conteo
// de goles/asistencias (statsByGroup.{groupId}) independiente del total
// individual del jugador.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { collection, query, getDocs, where, documentId } from 'firebase/firestore'
import { db } from 'src/services/firebase'

export function useLeaderboard() {
  const groupScorers = ref([])
  const groupAssisters = ref([])
  const loadingGroup = ref(false)

  // ── Ranking filtrado por miembros de un grupo ─────────────────────────────
  // Usa las estadísticas específicas de ESE grupo (statsByGroup.{groupId}),
  // no el acumulado individual total — cada grupo lleva su propio conteo.
  async function fetchGroupRanking(memberIds, groupId) {
    if (!memberIds || memberIds.length === 0 || !groupId) {
      groupScorers.value = []
      groupAssisters.value = []
      return
    }
    loadingGroup.value = true
    try {
      // Firestore 'in' soporta hasta 30 elementos por consulta
      const chunks = []
      for (let i = 0; i < memberIds.length; i += 30) {
        chunks.push(memberIds.slice(i, i + 30))
      }

      let users = []
      for (const chunk of chunks) {
        const q = query(
          collection(db, 'users'),
          where(documentId(), 'in', chunk),
        )
        const snap = await getDocs(q)
        users.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      }

      // Normaliza: cada jugador expone sus stats DE ESTE GRUPO en `.stats`
      const usersWithGroupStats = users.map((u) => ({
        ...u,
        stats: u.statsByGroup?.[groupId] ?? { goals: 0, assists: 0, matchesPlayed: 0 },
      }))

      groupScorers.value = [...usersWithGroupStats].sort(
        (a, b) => (b.stats?.goals ?? 0) - (a.stats?.goals ?? 0),
      )
      groupAssisters.value = [...usersWithGroupStats].sort(
        (a, b) => (b.stats?.assists ?? 0) - (a.stats?.assists ?? 0),
      )
    } finally {
      loadingGroup.value = false
    }
  }

  function clearGroupRanking() {
    groupScorers.value = []
    groupAssisters.value = []
  }

  return {
    groupScorers,
    groupAssisters,
    loadingGroup,
    fetchGroupRanking,
    clearGroupRanking,
  }
}
