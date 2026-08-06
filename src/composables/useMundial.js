// src/composables/useMundial.js
// ─────────────────────────────────────────────────────────────────────────────
// "Mundial personal": modo de juego individual y opcional. El jugador lo
// activa desde su perfil; a partir de ahí, cada resultado real que carga en
// CUALQUIER partido (de cualquier grupo) lo hace avanzar de fase de forma
// automática — la lógica de avance vive server-side en la Cloud Function
// advancePlayerMundial (functions/index.js), disparada por onPlayerStatsWritten.
// Este composable solo hace 2 escrituras de cliente: activar uno nuevo, y
// pedirle al servidor que resuelva un coin flip pendiente (revealMundialCoinFlip).
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

// Orden de fases para renderizar el progreso en la UI.
export const PHASE_ORDER = ['groups', 'round_of_32', 'round_of_16', 'quarter', 'semi', 'final']

export const PHASE_LABELS = {
  groups: 'Fase de grupos',
  round_of_32: 'Dieciseisavos',
  round_of_16: 'Octavos',
  quarter: 'Cuartos',
  semi: 'Semifinal',
  final: 'Final',
  champion: 'Campeón',
  eliminated: 'Eliminado',
}

function emptyMundial() {
  return {
    active: false,
    phase: null,
    startedAt: null,
    endedAt: null,
    groupMatchResults: [],
    pendingCoinFlip: null,
    titles: 0,
    runsPlayed: 0,
    lastResult: null,
  }
}

export function useMundial() {
  const authStore = useAuthStore()
  const loading = ref(false)
  const error = ref(null)

  // Estado actual del Mundial del propio usuario (no existe hasta la 1ra activación).
  async function getMyMundial() {
    const uid = authStore.user?.uid
    if (!uid) return emptyMundial()
    const snap = await getDoc(doc(db, 'users', uid))
    return { ...emptyMundial(), ...(snap.data()?.mundial ?? {}) }
  }

  // Activa un Mundial nuevo. Solo permitido si no hay uno activo (además de
  // esta validación de UX, firestore.rules lo exige server-side).
  async function activateMundial() {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('Usuario no autenticado')

    loading.value = true
    error.value = null
    try {
      const current = await getMyMundial()
      if (current.active) throw new Error('Ya tenés un Mundial en curso.')

      await updateDoc(doc(db, 'users', uid), {
        mundial: {
          active: true,
          phase: 'groups',
          startedAt: serverTimestamp(),
          endedAt: null,
          groupMatchResults: [],
          pendingCoinFlip: null,
          titles: current.titles ?? 0,
          runsPlayed: (current.runsPlayed ?? 0) + 1,
          lastResult: null,
        },
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // Resuelve el coin flip pendiente (si hay uno). El outcome ya fue decidido
  // y congelado server-side — esto solo revela lo que ya estaba definido.
  async function revealCoinFlip() {
    loading.value = true
    error.value = null
    try {
      const fn = httpsCallable(functions, 'revealMundialCoinFlip')
      const result = await fn()
      return result.data // { outcome, type, nextPhase }
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
    getMyMundial,
    activateMundial,
    revealCoinFlip,
  }
}
