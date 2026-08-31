// src/composables/useMvpVoting.js
// ─────────────────────────────────────────────────────────────────────────────
// Votación de MVP: cada jugador vota (sin autovoto) a quien crea que fue el
// mejor del partido. La votación queda abierta sin límite de tiempo hasta que
// alguien con permiso (dueño/admin del grupo, o admin global) la cierra — ahí
// la Cloud Function closeMvpVoting cuenta los votos y fija mvpUserId/mvpName.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

export function useMvpVoting() {
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
      await setDoc(doc(db, 'matches', matchId, 'mvpVotes', uid), {
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
    const snap = await getDoc(doc(db, 'matches', matchId, 'mvpVotes', uid))
    return snap.exists() ? snap.data().votedForUserId : null
  }

  // Recuento de votos del partido: Map<votedForUserId, cantidad>.
  //
  // Es un getDocs de una sola vez, NO un onSnapshot: mientras la votación está
  // abierta las reglas ni siquiera dejan listar esta colección (voto secreto),
  // así que esto solo se usa para pintar el podio de una votación ya cerrada
  // — y un resultado cerrado no cambia más, no hay nada que escuchar en vivo.
  async function fetchTally(matchId) {
    const snap = await getDocs(collection(db, 'matches', matchId, 'mvpVotes'))
    const tally = new Map()
    snap.docs.forEach((d) => {
      const target = d.data().votedForUserId
      if (target) tally.set(target, (tally.get(target) ?? 0) + 1)
    })
    return tally
  }

  // Cierra la votación: cuenta los votos server-side y fija el MVP del partido.
  async function closeMvpVoting(matchId) {
    loading.value = true
    error.value = null
    try {
      const fn = httpsCallable(functions, 'closeMvpVoting')
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
    fetchTally,
    closeMvpVoting,
  }
}
