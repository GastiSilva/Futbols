// src/composables/useMurallaVoting.js
// ─────────────────────────────────────────────────────────────────────────────
// Votación de Muralla (mejor defensor): misma mecánica que useMvpVoting.js,
// en una colección separada (matches/{id}/murallaVotes) porque es una
// votación INDEPENDIENTE — puede cerrarse antes o después que la de MVP.
// La Cloud Function closeMurallaVoting cuenta los votos y fija
// murallaUserId/murallaName.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import {
  doc,
  collection,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

export function useMurallaVoting() {
  const authStore = useAuthStore()
  const loading = ref(false)
  const error = ref(null)

  // Vota (o cambia mi voto) por votedForUserId en un partido. Nunca a mí mismo.
  async function castVote(matchId, votedForUserId) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('Usuario no autenticado')
    if (uid === votedForUserId) throw new Error('No podés votarte a vos mismo.')

    loading.value = true
    error.value = null
    try {
      await setDoc(doc(db, 'matches', matchId, 'murallaVotes', uid), {
        votedForUserId,
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // Mi voto actual en este partido (null si todavía no voté).
  async function getMyVote(matchId) {
    const uid = authStore.user?.uid
    if (!uid) return null
    const snap = await getDoc(doc(db, 'matches', matchId, 'murallaVotes', uid))
    return snap.exists() ? snap.data().votedForUserId : null
  }

  // Escucha en tiempo real todos los votos del partido — callback recibe
  // { tally: Map<votedForUserId, count>, votes: Array<{voterId, votedForUserId}> }
  function subscribeToVotes(matchId, callback) {
    return onSnapshot(collection(db, 'matches', matchId, 'murallaVotes'), (snap) => {
      const votes = snap.docs.map((d) => ({ voterId: d.id, votedForUserId: d.data().votedForUserId }))
      const tally = new Map()
      votes.forEach((v) => tally.set(v.votedForUserId, (tally.get(v.votedForUserId) ?? 0) + 1))
      callback({ tally, votes })
    })
  }

  // Cierra la votación: cuenta los votos server-side y fija la Muralla del partido.
  async function closeMurallaVoting(matchId) {
    loading.value = true
    error.value = null
    try {
      const fn = httpsCallable(functions, 'closeMurallaVoting')
      const result = await fn({ matchId })
      return result.data
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    castVote,
    getMyVote,
    subscribeToVotes,
    closeMurallaVoting,
  }
}
