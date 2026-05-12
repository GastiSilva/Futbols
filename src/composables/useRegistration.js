// src/composables/useRegistration.js
// ─────────────────────────────────────────────────────────────────────────────
//  COMPOSABLE CRÍTICO: Inscripción a partidos con Firestore Transactions
// ─────────────────────────────────────────────────────────────────────────────
//
//  PROBLEMA DE CONCURRENCIA
//  ───────────────────────
//  Si 50 usuarios hacen clic en "Anotarme" al mismo tiempo, una simple lectura
//  seguida de escritura generaría condiciones de carrera:
//    1. Usuario A lee currentPlayers = 15  ✓ hay cupo (max 16)
//    2. Usuario B lee currentPlayers = 15  ✓ hay cupo
//    3. A escribe 16 → partido lleno
//    4. B escribe 16 → ¡sobrepasa el límite!
//
//  SOLUCIÓN: runTransaction de Firestore
//  ─────────────────────────────────────
//  Una transacción garantiza que las operaciones de lectura y escritura sobre
//  el documento del partido sean atómicas. Si otro cliente modifica el
//  documento entre el read y el write, Firestore reintenta automáticamente
//  la transacción (hasta 5 veces) hasta que tenga éxito o falle de forma
//  definitiva. Esto hace imposible superar maxPlayers bajo concurrencia.
//
//  Esquema de subcolección: matches/{matchId}/registrations/{userId}
//  {
//    userId        : string,
//    displayName   : string,
//    photoURL      : string,
//    registeredAt  : Timestamp,
//    position      : number,   ← orden de llegada (1-based)
//    isOnWaitlist  : boolean,  ← true si está en lista de espera
//    team          : 'A' | 'B' | null
//  }
// ─────────────────────────────────────────────────────────────────────────────

import { ref } from 'vue'
import {
  doc,
  collection,
  runTransaction,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  deleteDoc,
  getDoc,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

// ── Errores tipados para feedback de UI ───────────────────────────────────────
export const REGISTRATION_ERRORS = {
  MATCH_NOT_FOUND: 'El partido no existe.',
  ALREADY_REGISTERED: 'Ya estás anotado en este partido.',
  MATCH_NOT_OPEN: 'La inscripción aún no está habilitada.',
  MATCH_CLOSED: 'El partido ya no admite inscripciones.',
  QUOTA_EXCEEDED: 'Se han llenado todos los cupos disponibles.',
  TRANSACTION_FAILED: 'Error de concurrencia. Por favor intenta de nuevo.',
}

export function useRegistration() {
  const authStore = useAuthStore()
  const registrations = ref([])   // lista completa en tiempo real
  const userRegistration = ref(null)
  const loading = ref(false)
  const error = ref(null)

  let unsubscribe = null

  // ── Suscripción en tiempo real a la lista de inscriptos ──────────────────
  function subscribeToRegistrations(matchId) {
    const regCol = collection(db, 'matches', matchId, 'registrations')
    const q = query(regCol, orderBy('position', 'asc'))

    unsubscribe = onSnapshot(q, (snap) => {
      registrations.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      userRegistration.value =
        registrations.value.find((r) => r.userId === authStore.user?.uid) ?? null
    })
    return unsubscribe
  }

  // ── INSCRIPCIÓN ATÓMICA (corazón del composable) ─────────────────────────
  /**
   * Inscribe al usuario autenticado en el partido de forma atómica.
   * Usa runTransaction para evitar condiciones de carrera bajo alta concurrencia.
   *
   * @param {string} matchId - ID del partido
   * @returns {{ position: number, isOnWaitlist: boolean }} resultado de la inscripción
   * @throws Error con mensaje tipado de REGISTRATION_ERRORS
   */
  async function joinMatch(matchId) {
    loading.value = true
    error.value = null

    const user = authStore.user
    if (!user) throw new Error('Usuario no autenticado')

    const matchRef = doc(db, 'matches', matchId)
    const regRef = doc(db, 'matches', matchId, 'registrations', user.uid)

    try {
      const result = await runTransaction(db, async (transaction) => {
        // ── 1. LECTURAS (siempre primero en una transacción de Firestore) ──
        const matchSnap = await transaction.get(matchRef)
        const regSnap = await transaction.get(regRef)

      // ── 2. VALIDACIONES ───────────────────────────────────────────────
        if (!matchSnap.exists()) throw new Error(REGISTRATION_ERRORS.MATCH_NOT_FOUND)

        const match = matchSnap.data()
        
        // Ventana de tiempo para OG
        const now = Date.now()
        const openAtMillis = match.openAt?.toMillis() ?? 0
        const isOG = authStore.user?.role === 'og'
        const isOgWindowOpen = isOG && now >= (openAtMillis - 30 * 60 * 1000)

        // Si está programado, solo pasa si estamos en la ventana del OG
        if (match.status === 'scheduled' && !isOgWindowOpen) {
          throw new Error(REGISTRATION_ERRORS.MATCH_NOT_OPEN)
        }
        
        if (match.status === 'closed' || match.status === 'finished') {
          throw new Error(REGISTRATION_ERRORS.MATCH_CLOSED)
        }
        if (regSnap.exists()) {
          throw new Error(REGISTRATION_ERRORS.ALREADY_REGISTERED)
        }

        // ── 3. CÁLCULO DE POSICIÓN ────────────────────────────────────────
        //  currentPlayers es el contador atómico en el documento del partido.
        //  Siempre lo leemos desde la transacción para garantizar consistencia.
        const currentCount = match.currentPlayers ?? 0
        const newPosition = currentCount + 1
        const isOnWaitlist = newPosition > match.maxPlayers

        // ── 4. ESCRITURAS ATÓMICAS ────────────────────────────────────────

        // 4a. Incrementa el contador en el documento del partido
        //     (NO usamos increment() de FieldValue porque dentro de una
        //      transacción debemos leer el valor actual y calcular nosotros)
        transaction.update(matchRef, {
          currentPlayers: newPosition,
          // Cierra el partido automáticamente si se llenaron los cupos
          ...(newPosition === match.maxPlayers && { status: 'closed' }),
          updatedAt: serverTimestamp(),
        })

        // 4b. Crea el documento de inscripción del usuario
        transaction.set(regRef, {
          userId: user.uid,
          displayName: user.displayName,
          photoURL: user.photoURL,
          registeredAt: serverTimestamp(),
          position: newPosition,
          isOnWaitlist,
          team: null,
        })

        return { position: newPosition, isOnWaitlist }
      })

      return result
    } catch (err) {
      // Si el error ya es uno de los nuestros, lo relanzamos tal cual
      const isKnownError = Object.values(REGISTRATION_ERRORS).includes(err.message)
      error.value = isKnownError ? err.message : REGISTRATION_ERRORS.TRANSACTION_FAILED
      throw new Error(error.value)
    } finally {
      loading.value = false
    }
  }

  // ── DESINSCRIPCIÓN ────────────────────────────────────────────────────────
  /**
   * Cancela la inscripción del usuario en el partido.
   * Decrementa el contador y, si hay jugadores en lista de espera,
   * actualiza la posición del siguiente en la fila.
   *
   * @param {string} matchId
   */
  async function leaveMatch(matchId) {
    loading.value = true
    error.value = null

    const user = authStore.user
    const matchRef = doc(db, 'matches', matchId)
    const regRef = doc(db, 'matches', matchId, 'registrations', user.uid)

    try {
      await runTransaction(db, async (transaction) => {
        const [matchSnap, regSnap] = await Promise.all([
          transaction.get(matchRef),
          transaction.get(regRef),
        ])

        if (!matchSnap.exists() || !regSnap.exists()) {
          throw new Error('Inscripción no encontrada.')
        }

        const match = matchSnap.data()
        const reg = regSnap.data()
        const newCount = Math.max(0, (match.currentPlayers ?? 1) - 1)

        // Decrementa el contador y reabre si estaba cerrado por cupo
        transaction.update(matchRef, {
          currentPlayers: newCount,
          ...(match.status === 'closed' &&
            newCount < match.maxPlayers && { status: 'open' }),
          updatedAt: serverTimestamp(),
        })

        // Elimina la inscripción
        transaction.delete(regRef)

        // Nota: Re-numerar las posiciones de los jugadores posteriores
        // se recomienda hacer con una Cloud Function para no sobrecargar
        // la transacción (Firestore limita a 500 ops por transacción).
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Estado del botón "Anotarme" ───────────────────────────────────────────
  /**
   * Determina si el botón de inscripción debe estar habilitado.
   * @param {{ openAt: Timestamp, status: string }} match
   */
  function canRegister(match) {
    if (!match) return false
    if (match.status === 'closed' || match.status === 'finished') return false
    if (userRegistration.value) return false

    const now = Date.now()
    const openAt = match.openAt?.toMillis?.() ?? 0
    const isOG = authStore.user?.role === 'og'
    
    // Si es OG, el umbral es 30 mins antes. Si no, es la hora normal.
    const threshold = isOG ? openAt - (30 * 60 * 1000) : openAt
    
    return match.status === 'open' || now >= threshold
  }

  /**
   * Milisegundos restantes para que abra la inscripción (para countdown).
   * @param {{ openAt: Timestamp }} match
   */
  function msUntilOpen(match) {
    const openAt = match?.openAt?.toMillis?.() ?? 0
    const isOG = authStore.user?.role === 'og'
    const threshold = isOG ? openAt - (30 * 60 * 1000) : openAt
    
    return Math.max(0, threshold - Date.now())
  }

  function stopListening() {
    unsubscribe?.()
    unsubscribe = null
  }

  return {
    registrations,
    userRegistration,
    loading,
    error,
    joinMatch,
    leaveMatch,
    canRegister,
    msUntilOpen,
    subscribeToRegistrations,
    stopListening,
    REGISTRATION_ERRORS,
  }
}
