// src/composables/useMatch.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable para crear, listar y observar partidos en Firestore.
// ─────────────────────────────────────────────────────────────────────────────
import { ref, computed } from 'vue'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

// ── Formatos de partido → cupos máximos ───────────────────────────────────────
export const FORMAT_OPTIONS = [
  { label: '5 vs 5  (10 jugadores)', value: '5v5', maxPlayers: 10 },
  { label: '7 vs 7  (14 jugadores)', value: '7v7', maxPlayers: 14 },
  { label: '8 vs 8  (16 jugadores)', value: '8v8', maxPlayers: 16 },
  { label: '11 vs 11  (22 jugadores)', value: '11v11', maxPlayers: 22 },
]

export function getMaxPlayers(format) {
  return FORMAT_OPTIONS.find((f) => f.value === format)?.maxPlayers ?? 10
}

// ── Estado de un partido ──────────────────────────────────────────────────────
export const MATCH_STATUS = {
  SCHEDULED: 'scheduled', // creado, lista aún cerrada
  OPEN: 'open',           // inscripciones abiertas
  CLOSED: 'closed',       // cupos llenos o cerrado manualmente
  FINISHED: 'finished',   // resultados cargados
}

/**
 * Calcula el estado efectivo de un partido en el cliente.
 * No escribe en Firestore — solo para display y lógica UI.
 *
 * Reglas:
 *  - 'finished' siempre es autoritativo
 *  - 'closed'   siempre es autoritativo
 *  - Si currentPlayers >= maxPlayers → 'closed'
 *  - Si 'scheduled' pero openAt ya pasó → 'open'
 *  - Cualquier otro caso respeta el valor de Firestore
 */
export function getEffectiveStatus(match) {
  if (!match) return null
  if (match.status === 'finished') return 'finished'
  if (match.status === 'closed') return 'closed'
  if ((match.currentPlayers ?? 0) >= (match.maxPlayers ?? Infinity)) return 'closed'
  if (match.status === 'scheduled') {
    const openAtMillis = match.openAt?.toMillis?.() ?? 0
    if (openAtMillis && Date.now() >= openAtMillis) return 'open'
  }
  return match.status
}

export function useMatch() {
  const authStore = useAuthStore()
  const matches = ref([])
  const currentMatch = ref(null)
  const loading = ref(false)
  const error = ref(null)

  let unsubscribe = null

  // ── Escucha en tiempo real los próximos partidos ──────────────────────────
  function subscribeToUpcoming() {
    const q = query(
      collection(db, 'matches'),
      where('status', 'in', [MATCH_STATUS.SCHEDULED, MATCH_STATUS.OPEN]),
      orderBy('date', 'asc'),
    )
    unsubscribe = onSnapshot(
      q,
      (snap) => {
        matches.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      },
      (err) => {
        error.value = err.message
      },
    )
    return unsubscribe
  }

  // ── Obtiene un partido por ID (una sola vez) ──────────────────────────────
  async function fetchMatch(matchId) {
    loading.value = true
    try {
      const snap = await getDoc(doc(db, 'matches', matchId))
      if (!snap.exists()) throw new Error('Partido no encontrado')
      currentMatch.value = { id: snap.id, ...snap.data() }
      return currentMatch.value
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Suscripción en tiempo real a un partido específico ────────────────────
  function subscribeToMatch(matchId) {
    unsubscribe = onSnapshot(doc(db, 'matches', matchId), (snap) => {
      if (snap.exists()) {
        currentMatch.value = { id: snap.id, ...snap.data() }
      }
    })
    return unsubscribe
  }

  // ── Crear un nuevo partido (solo admin) ───────────────────────────────────
  async function createMatch(formData) {
    loading.value = true
    error.value = null
    try {
      const maxPlayers = getMaxPlayers(formData.format)
      const date = formData.date ? Timestamp.fromDate(new Date(formData.date)) : null
      const openAt = formData.openAt ? Timestamp.fromDate(new Date(formData.openAt)) : null
      const notifyAt = formData.notifyAt ? Timestamp.fromDate(new Date(formData.notifyAt)) : null

      const matchRef = await addDoc(collection(db, 'matches'), {
        title: formData.title,
        location: formData.location ?? '',
        date,
        openAt,
        notifyAt,
        groupId: formData.groupId ?? null,
        format: formData.format,
        maxPlayers,
        currentPlayers: 0,
        status: MATCH_STATUS.SCHEDULED,
        scoreA: null,
        scoreB: null,
        createdBy: authStore.user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      return matchRef.id
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Editar un partido existente (solo admin) ──────────────────────────────
  async function updateMatch(matchId, formData) {
    loading.value = true
    error.value = null
    try {
      const maxPlayers = getMaxPlayers(formData.format)
      const date = formData.date ? Timestamp.fromDate(new Date(formData.date)) : null
      const openAt = formData.openAt ? Timestamp.fromDate(new Date(formData.openAt)) : null
      const notifyAt = formData.notifyAt ? Timestamp.fromDate(new Date(formData.notifyAt)) : null

      await updateDoc(doc(db, 'matches', matchId), {
        title: formData.title,
        location: formData.location ?? '',
        date,
        openAt,
        notifyAt,
        groupId: formData.groupId ?? null,
        format: formData.format,
        maxPlayers,
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Guardar resultado post-partido ────────────────────────────────────────
  async function saveMatchResult(matchId, { scoreA, scoreB }) {
    loading.value = true
    try {
      await updateDoc(doc(db, 'matches', matchId), {
        scoreA,
        scoreB,
        status: MATCH_STATUS.FINISHED,
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Próximo partido visible para el jugador ───────────────────────────────
  const nextMatch = computed(() => matches.value[0] ?? null)

  // ── Escucha en tiempo real los partidos de un grupo ───────────────────────
  function subscribeToGroupMatches(groupId) {
    const q = query(
      collection(db, 'matches'),
      where('groupId', '==', groupId),
      orderBy('date', 'asc'),
    )
    unsubscribe = onSnapshot(
      q,
      (snap) => {
        matches.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      },
      (err) => {
        error.value = err.message
      },
    )
    return unsubscribe
  }

  function stopListening() {
    unsubscribe?.()
    unsubscribe = null
  }

  return {
    matches,
    currentMatch,
    nextMatch,
    loading,
    error,
    subscribeToUpcoming,
    subscribeToGroupMatches,
    subscribeToMatch,
    fetchMatch,
    createMatch,
    updateMatch,
    saveMatchResult,
    stopListening,
    FORMAT_OPTIONS,
    MATCH_STATUS,
  }
}
