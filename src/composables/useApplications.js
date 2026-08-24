// src/composables/useApplications.js
// ─────────────────────────────────────────────────────────────────────────────
//  Postulaciones a partidos públicos.
//
//  Alguien de AFUERA del grupo se ofrece a jugar un partido publicado. Es
//  deliberadamente distinto de una inscripción (`useRegistration.js`):
//
//    registration → ocupa cupo, mueve currentPlayers, ya estás adentro
//    application  → es una solicitud; no ocupa nada hasta que te acepten
//
//  Cuando el organizador acepta, NO se escribe la registration desde acá: lo
//  hace la Cloud Function `onApplicationAccepted` (Admin SDK), que corre la
//  misma transacción de cupos que el alta normal y retira las postulaciones
//  del mismo jugador a otros partidos que se solapen en horario.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import {
  doc,
  collection,
  collectionGroup,
  setDoc,
  addDoc,
  updateDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

export const APPLICATION_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
}

// Tope de caracteres del mensaje de presentación. Las reglas validan lo mismo
// (applications create) — si cambia acá, cambiarlo allá.
export const MAX_APPLICATION_MESSAGE = 300

// Las reglas exigen un `limit` acotado al listar postulaciones propias, igual
// que MATCH_QUERY_LIMIT para `matches`.
export const APPLICATION_QUERY_LIMIT = 50

// Chat 1-a-1 de la postulación. El tope de mensajes es de la query, no del
// chat: son conversaciones cortas de coordinación, no un WhatsApp.
export const MAX_CHAT_MESSAGES = 100
export const MAX_CHAT_MESSAGE_LENGTH = 1000

export const APPLICATION_ERRORS = {
  NOT_AUTHENTICATED: 'Necesitás una cuenta para postularte.',
  ALREADY_MEMBER: 'Ya sos parte de este grupo — anotate directamente en la lista.',
  NOT_PUBLIC: 'Este partido no está abierto a postulaciones.',
  ALREADY_APPLIED: 'Ya te postulaste a este partido.',
}

export function useApplications() {
  const authStore = useAuthStore()

  const applications = ref([])       // postulaciones de UN partido (vista organizador)
  const myApplications = ref([])     // mis postulaciones (vista postulante)
  const loading = ref(false)
  const error = ref(null)

  const unsubscribes = new Map()

  // ── Postularse a un partido publicado ──────────────────────────────────────
  async function applyToMatch(matchId, message = '') {
    const user = authStore.user
    if (!user || authStore.isGuest) throw new Error(APPLICATION_ERRORS.NOT_AUTHENTICATED)

    loading.value = true
    error.value = null
    try {
      await setDoc(doc(db, 'matches', matchId, 'applications', user.uid), {
        applicantId: user.uid,
        applicantName: user.nickname || user.displayName || 'Jugador',
        applicantPhotoURL: user.photoURL ?? null,
        status: APPLICATION_STATUS.PENDING,
        message: (message ?? '').trim().slice(0, MAX_APPLICATION_MESSAGE),
        createdAt: serverTimestamp(),
        resolvedAt: null,
        resolvedBy: null,
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Retirar la propia postulación (mientras siga pendiente) ────────────────
  async function withdrawApplication(matchId) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error(APPLICATION_ERRORS.NOT_AUTHENTICATED)

    loading.value = true
    error.value = null
    try {
      await updateDoc(doc(db, 'matches', matchId, 'applications', uid), {
        status: APPLICATION_STATUS.WITHDRAWN,
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Resolver una postulación (organizador) ─────────────────────────────────
  // `accept` dispara la Cloud Function que crea la inscripción real. Desde el
  // cliente solo se mueve el `status`: escribir la registration acá abriría un
  // camino paralelo al alta transaccional de cupos.
  async function resolveApplication(matchId, applicantId, accept) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error(APPLICATION_ERRORS.NOT_AUTHENTICATED)

    loading.value = true
    error.value = null
    try {
      await updateDoc(doc(db, 'matches', matchId, 'applications', applicantId), {
        status: accept ? APPLICATION_STATUS.ACCEPTED : APPLICATION_STATUS.REJECTED,
        resolvedAt: serverTimestamp(),
        resolvedBy: uid,
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Sondeo consultivo: pulgar arriba/abajo de los ya anotados ──────────────
  // No es vinculante — decide el organizador. Sirve para que no meta a un
  // desconocido sin que el resto pueda decir nada.
  async function voteOnApplication(matchId, applicantId, vote) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error(APPLICATION_ERRORS.NOT_AUTHENTICATED)
    if (!['up', 'down'].includes(vote)) throw new Error('Voto inválido.')

    await setDoc(
      doc(db, 'matches', matchId, 'applications', applicantId, 'votes', uid),
      { vote, updatedAt: serverTimestamp() },
    )
  }

  // Conteo del sondeo de UNA postulación. Son pocos votos (los anotados de un
  // partido), así que se cuenta en el cliente en vez de mantener un agregado.
  async function fetchVoteTally(matchId, applicantId) {
    try {
      const snap = await getDocs(
        collection(db, 'matches', matchId, 'applications', applicantId, 'votes'),
      )
      let up = 0
      let down = 0
      snap.docs.forEach((d) => {
        if (d.data().vote === 'up') up += 1
        else if (d.data().vote === 'down') down += 1
      })
      return { up, down, myVote: snap.docs.find((d) => d.id === authStore.user?.uid)?.data().vote ?? null }
    } catch {
      return { up: 0, down: 0, myVote: null }
    }
  }

  // ── Chat 1-a-1 de la postulación ──────────────────────────────────────────
  // Entre el postulante y quien gestiona el partido. Es 1-a-1 a propósito: un
  // chat grupal del partido mandaría 13 notificaciones irrelevantes por cada
  // mensaje, y la conversación que hace falta es solo entre esos dos.
  const messages = ref([])

  function subscribeToMessages(matchId, applicantId) {
    const key = `msg:${matchId}:${applicantId}`
    stopListening(key)

    const q = query(
      collection(db, 'matches', matchId, 'applications', applicantId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(MAX_CHAT_MESSAGES),
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        messages.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      },
      (err) => {
        error.value = err.message
      },
    )
    unsubscribes.set(key, unsub)
    return unsub
  }

  async function sendMessage(matchId, applicantId, text) {
    const user = authStore.user
    if (!user) throw new Error(APPLICATION_ERRORS.NOT_AUTHENTICATED)

    const trimmed = (text ?? '').trim()
    if (!trimmed) return
    if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new Error(`El mensaje no puede superar los ${MAX_CHAT_MESSAGE_LENGTH} caracteres.`)
    }

    await addDoc(
      collection(db, 'matches', matchId, 'applications', applicantId, 'messages'),
      {
        senderId: user.uid,
        senderName: user.nickname || user.displayName || 'Jugador',
        text: trimmed,
        createdAt: serverTimestamp(),
      },
    )
  }

  // ── Suscripción a las postulaciones de un partido (organizador) ────────────
  function subscribeToApplications(matchId) {
    stopListening(matchId)

    const q = query(
      collection(db, 'matches', matchId, 'applications'),
      orderBy('createdAt', 'asc'),
      limit(APPLICATION_QUERY_LIMIT),
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        applications.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      },
      (err) => {
        error.value = err.message
      },
    )
    unsubscribes.set(matchId, unsub)
    return unsub
  }

  // ── Mis postulaciones (vista del postulante) ───────────────────────────────
  // collectionGroup sobre `applications` filtrando por applicantId. Las reglas
  // no pueden verificar ese `where` (limitación de Firestore), por eso exigen
  // el `limit` acotado.
  function subscribeToMyApplications() {
    const uid = authStore.user?.uid
    if (!uid || authStore.isGuest) {
      myApplications.value = []
      return () => {}
    }

    stopListening('__mine__')

    const q = query(
      collectionGroup(db, 'applications'),
      where('applicantId', '==', uid),
      limit(APPLICATION_QUERY_LIMIT),
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        myApplications.value = snap.docs.map((d) => ({
          id: d.id,
          // El matchId es el padre del padre: matches/{matchId}/applications/{uid}
          matchId: d.ref.parent.parent?.id ?? null,
          ...d.data(),
        }))
      },
      (err) => {
        error.value = err.message
      },
    )
    unsubscribes.set('__mine__', unsub)
    return unsub
  }

  function stopListening(key) {
    if (key) {
      unsubscribes.get(key)?.()
      unsubscribes.delete(key)
      return
    }
    unsubscribes.forEach((unsub) => unsub?.())
    unsubscribes.clear()
  }

  return {
    applications,
    myApplications,
    messages,
    loading,
    error,
    applyToMatch,
    withdrawApplication,
    resolveApplication,
    voteOnApplication,
    fetchVoteTally,
    subscribeToApplications,
    subscribeToMyApplications,
    subscribeToMessages,
    sendMessage,
    stopListening,
    APPLICATION_STATUS,
    APPLICATION_ERRORS,
  }
}
