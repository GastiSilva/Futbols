// src/composables/useLeaderboard.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable para el ranking global de goleadores y asistidores.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { db } from 'src/services/firebase'

export function useLeaderboard() {
  const scorers = ref([])
  const assisters = ref([])
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

  function stopListening() {
    unsubScorers?.()
    unsubAssisters?.()
  }

  return { scorers, assisters, subscribeScorers, subscribeAssisters, stopListening }
}
