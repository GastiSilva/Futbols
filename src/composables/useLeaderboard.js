// src/composables/useLeaderboard.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable para el ranking global y por grupo de goleadores y asistidores.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { collection, query, orderBy, limit, onSnapshot, getDocs, where, documentId } from 'firebase/firestore'
import { db } from 'src/services/firebase'

export function useLeaderboard() {
  const scorers = ref([])
  const assisters = ref([])
  const groupScorers = ref([])
  const groupAssisters = ref([])
  const loadingGroup = ref(false)
  let unsubScorers = null
  let unsubAssisters = null

  function subscribeScorers(top = 20) {
    const q = query(
      collection(db, 'users'),
      orderBy('stats.goals', 'desc'),
      limit(top),
    )
    unsubScorers = onSnapshot(q, (snap) => {
      scorers.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    })
  }

  function subscribeAssisters(top = 20) {
    const q = query(
      collection(db, 'users'),
      orderBy('stats.assists', 'desc'),
      limit(top),
    )
    unsubAssisters = onSnapshot(q, (snap) => {
      assisters.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    })
  }

  // ── Ranking filtrado por miembros de un grupo ─────────────────────────────
  async function fetchGroupRanking(memberIds) {
    if (!memberIds || memberIds.length === 0) {
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

      groupScorers.value = [...users].sort(
        (a, b) => (b.stats?.goals ?? 0) - (a.stats?.goals ?? 0),
      )
      groupAssisters.value = [...users].sort(
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

  function stopListening() {
    unsubScorers?.()
    unsubAssisters?.()
  }

  return {
    scorers,
    assisters,
    groupScorers,
    groupAssisters,
    loadingGroup,
    subscribeScorers,
    subscribeAssisters,
    fetchGroupRanking,
    clearGroupRanking,
    stopListening,
  }
}
