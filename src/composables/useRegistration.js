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
  getDoc,
  collection,
  runTransaction,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'
import { getEffectiveStatus } from 'src/composables/useMatch'

// ── Errores tipados para feedback de UI ───────────────────────────────────────
export const REGISTRATION_ERRORS = {
  MATCH_NOT_FOUND: 'El partido no existe.',
  ALREADY_REGISTERED: 'Ya estás anotado en este partido.',
  MATCH_NOT_OPEN: 'La inscripción aún no está habilitada.',
  MATCH_CLOSED: 'El partido ya no admite inscripciones.',
  QUOTA_EXCEEDED: 'Se han llenado todos los cupos disponibles.',
  TRANSACTION_FAILED: 'Error de concurrencia. Por favor intenta de nuevo.',
  EARLY_NO_GUESTS: 'Los invitados solo pueden anotarse cuando la lista abre para todos.',
  EARLY_TARGET_NOT_ALLOWED:
    'Esa persona no tiene acceso anticipado — podés anotarla cuando abra la lista.',
  NOT_GROUP_MEMBER: 'Este partido es de un grupo del que no formás parte.',
}

// Ventana de acceso anticipado (OG / owner / admin del grupo): 30 minutos
export const EARLY_ACCESS_MS = 30 * 60 * 1000

export function useRegistration() {
  const authStore = useAuthStore()
  const registrations = ref([])   // lista completa en tiempo real
  const userRegistration = ref(null)
  const loading = ref(false)
  const error = ref(null)

  let unsubscribe = null
  let unsubscribes = new Map()  // Para múltiples suscripciones simultaneas

  // ── Suscripción en tiempo real a la lista de inscriptos ──────────────────
  function subscribeToRegistrations(matchId, onRegistrationsChange) {
    // Si ya hay una suscripción para este match, desuscríbete primero
    if (unsubscribes.has(matchId)) {
      unsubscribes.get(matchId)()
      unsubscribes.delete(matchId)
    }

    const regCol = collection(db, 'matches', matchId, 'registrations')
    const q = query(regCol, orderBy('position', 'asc'))

    const unsub = onSnapshot(q, (snap) => {
      const regs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      
      // Si se proporciona un callback, lo usa
      if (onRegistrationsChange && typeof onRegistrationsChange === 'function') {
        onRegistrationsChange(regs)
      } else {
        // Si no, mantiene el comportamiento anterior (para compatibilidad)
        registrations.value = regs
        userRegistration.value =
          regs.find((r) => r.userId === authStore.user?.uid) ?? null
      }
    })

    // Si hay callback, guarda la suscripción para poder desuscribirse después
    if (onRegistrationsChange) {
      unsubscribes.set(matchId, unsub)
    } else {
      unsubscribe = unsub
    }

    return unsub
  }

  // ── INSCRIPCIÓN ATÓMICA (corazón del composable) ─────────────────────────
  /**
   * Registra a una persona en el partido de forma atómica.
   * Usa runTransaction para evitar condiciones de carrera bajo alta concurrencia.
   *
   * Soporta tres casos:
   *   - El propio usuario (joinMatch)
   *   - Un invitado sin cuenta (addGuestToMatch) → docId autogenerado, userId null
   *   - Otro miembro existente (addMemberToMatch) → docId = uid del anotado
   *
   * @param {string} matchId
   * @param {{ targetUserId: string|null, isGuest: boolean, guestName: string|null,
   *           displayName: string, photoURL: string|null }} entry
   * @returns {{ position: number, isOnWaitlist: boolean }}
   * @throws Error con mensaje tipado de REGISTRATION_ERRORS
   */
  async function registerEntry(matchId, entry) {
    loading.value = true
    error.value = null

    const user = authStore.user
    if (!user) throw new Error('Usuario no autenticado')

    const matchRef = doc(db, 'matches', matchId)
    // Invitado → docId autogenerado; usuario/miembro → docId = uid (1 por persona)
    const regRef = entry.isGuest
      ? doc(collection(db, 'matches', matchId, 'registrations'))
      : doc(db, 'matches', matchId, 'registrations', entry.targetUserId)

    try {
      const result = await runTransaction(db, async (transaction) => {
        // ── 1. LECTURAS (siempre primero en una transacción de Firestore) ──
        const matchSnap = await transaction.get(matchRef)
        const regSnap = entry.isGuest ? null : await transaction.get(regRef)

        // ── 2. VALIDACIONES ───────────────────────────────────────────────
        if (!matchSnap.exists()) throw new Error(REGISTRATION_ERRORS.MATCH_NOT_FOUND)

        const match = matchSnap.data()

        // Validación 100% por reloj — el status no bloquea la inscripción.
        // Reglas de la ventana anticipada (30 min antes de openAt):
        //  - El creador del partido se anota a SÍ MISMO desde el momento cero.
        //  - Con acceso anticipado (OG / owner / admin del grupo, o creador)
        //    se puede entrar 30 min antes.
        //  - En esa ventana solo se puede anotar a gente que TAMBIÉN tenga
        //    acceso anticipado: nada de invitados ni miembros comunes.
        const now = Date.now()
        const openAtMillis = match.openAt?.toMillis() ?? 0
        const isSelf = !entry.isGuest && entry.targetUserId === user.uid
        const isCreator = match.createdBy === user.uid
        const creatorSelf = isCreator && isSelf

        const isGlobalAdmin = authStore.isAdmin

        if (!creatorSelf) {
          // Partido de grupo: solo miembros de ese grupo pueden anotarse o
          // anotar a otra persona (un admin global puede siempre). Los
          // partidos sin grupo (groupId null) son globales y quedan abiertos.
          if (match.groupId && !isGlobalAdmin) {
            const callerMemberSnap = await transaction.get(
              doc(db, 'groups', match.groupId, 'members', user.uid),
            )
            if (!callerMemberSnap.exists()) {
              throw new Error(REGISTRATION_ERRORS.NOT_GROUP_MEMBER)
            }
          }

          const hasEarlyAccess = authStore.isOgInGroup(match.groupId) || isCreator
          const threshold = hasEarlyAccess ? openAtMillis - EARLY_ACCESS_MS : openAtMillis
          if (now < threshold) {
            throw new Error(REGISTRATION_ERRORS.MATCH_NOT_OPEN)
          }

          // Dentro de la ventana anticipada (todavía no llegó openAt)
          if (now < openAtMillis) {
            if (entry.isGuest) {
              throw new Error(REGISTRATION_ERRORS.EARLY_NO_GUESTS)
            }
            if (!isSelf) {
              // El anotado debe tener acceso anticipado en el grupo del partido
              if (!match.groupId) {
                throw new Error(REGISTRATION_ERRORS.EARLY_TARGET_NOT_ALLOWED)
              }
              const memberSnap = await transaction.get(
                doc(db, 'groups', match.groupId, 'members', entry.targetUserId),
              )
              const member = memberSnap.exists() ? memberSnap.data() : null
              const targetHasEarlyAccess =
                !!member && (member.og === true || ['owner', 'admin'].includes(member.role))
              if (!targetHasEarlyAccess) {
                throw new Error(REGISTRATION_ERRORS.EARLY_TARGET_NOT_ALLOWED)
              }
            }
          } else if (!isSelf && !entry.isGuest && match.groupId && !isGlobalAdmin) {
            // Ventana abierta: si se anota a otro miembro, ese miembro
            // también debe pertenecer al grupo del partido.
            const targetMemberSnap = await transaction.get(
              doc(db, 'groups', match.groupId, 'members', entry.targetUserId),
            )
            if (!targetMemberSnap.exists()) {
              throw new Error(REGISTRATION_ERRORS.NOT_GROUP_MEMBER)
            }
          }
        }

        if (match.status === 'closed' || match.status === 'finished') {
          throw new Error(REGISTRATION_ERRORS.MATCH_CLOSED)
        }
        if (regSnap && regSnap.exists()) {
          throw new Error(REGISTRATION_ERRORS.ALREADY_REGISTERED)
        }

        // ── 3. CÁLCULO DE POSICIÓN ────────────────────────────────────────
        const currentCount = match.currentPlayers ?? 0
        const newPosition = currentCount + 1
        const isOnWaitlist = newPosition > match.maxPlayers

        // ── 4. ESCRITURAS ATÓMICAS ────────────────────────────────────────
        transaction.update(matchRef, {
          currentPlayers: newPosition,
          updatedAt: serverTimestamp(),
        })

        transaction.set(regRef, {
          userId: entry.isGuest ? null : entry.targetUserId,
          displayName: entry.displayName,
          photoURL: entry.photoURL ?? null,
          isGuest: !!entry.isGuest,
          guestName: entry.isGuest ? entry.guestName : null,
          addedBy: user.uid,
          addedByName: user.nickname || user.displayName || null,
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

  // Inscribe al usuario autenticado. En la lista aparece con su APODO
  // (nickname del perfil) si lo tiene; si no, con su nombre de Google.
  function joinMatch(matchId) {
    const user = authStore.user
    if (!user) throw new Error('Usuario no autenticado')
    return registerEntry(matchId, {
      targetUserId: user.uid,
      isGuest: false,
      guestName: null,
      displayName: user.nickname || user.displayName,
      photoURL: user.photoURL,
    })
  }

  // Anota a un invitado sin cuenta (solo un nombre).
  function addGuestToMatch(matchId, guestName) {
    const name = (guestName ?? '').trim()
    if (!name) throw new Error('El nombre del invitado es obligatorio.')
    return registerEntry(matchId, {
      targetUserId: null,
      isGuest: true,
      guestName: name,
      displayName: name,
      photoURL: null,
    })
  }

  // Anota a otro miembro existente de la app. También aparece con su apodo
  // si lo tiene configurado en su perfil (se lee de users/{uid}).
  async function addMemberToMatch(matchId, member) {
    if (!member?.userId) throw new Error('Miembro inválido.')

    let displayName = member.displayName
    try {
      const snap = await getDoc(doc(db, 'users', member.userId))
      const nickname = snap.exists() ? snap.data().nickname : null
      if (nickname) displayName = nickname
    } catch {
      // sin acceso al perfil → se usa el nombre del miembro del grupo
    }

    return registerEntry(matchId, {
      targetUserId: member.userId,
      isGuest: false,
      guestName: null,
      displayName,
      photoURL: member.photoURL ?? null,
    })
  }

  // ── DESINSCRIPCIÓN ────────────────────────────────────────────────────────
  /**
   * Cancela la inscripción del usuario en el partido.
   * Decrementa el contador y, si hay jugadores en lista de espera,
   * actualiza la posición del siguiente en la fila.
   *
   * @param {string} matchId
   */
  async function removeRegistration(matchId, registrationId) {
    loading.value = true
    error.value = null

    const matchRef = doc(db, 'matches', matchId)
    const regRef = doc(db, 'matches', matchId, 'registrations', registrationId)

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
        const newCount = Math.max(0, (match.currentPlayers ?? 1) - 1)

        // Decrementa el contador
        // NOTA: no se actualiza status aquí — las Firestore Rules no lo permiten
        // para usuarios regulares. getEffectiveStatus() lo maneja en el cliente.
        transaction.update(matchRef, {
          currentPlayers: newCount,
          updatedAt: serverTimestamp(),
        })

        // Elimina la inscripción
        transaction.delete(regRef)

        // Nota: la re-numeración de posiciones y la PROMOCIÓN AUTOMÁTICA del
        // primer suplente la hace la Cloud Function `onRegistrationDeleted`
        // (functions/index.js) — también le manda la notificación FCM al
        // suplente que entra como titular.
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // Cancela la inscripción del propio usuario (docId = su uid).
  function leaveMatch(matchId) {
    const user = authStore.user
    if (!user) throw new Error('Usuario no autenticado')
    return removeRegistration(matchId, user.uid)
  }

  // ── Estado del botón "Anotarme" ───────────────────────────────────────────
  /**
   * Determina si el botón de inscripción debe estar habilitado.
   * Con estado 'full' (cupo lleno) sigue permitido → entra como suplente.
   * @param {{ openAt: Timestamp, status: string, createdBy: string }} match
   */
  function canRegister(match) {
    if (!match) return false
    const effectiveStatus = getEffectiveStatus(match)
    if (effectiveStatus === 'closed' || effectiveStatus === 'finished') return false
    if (userRegistration.value) return false

    // El creador del partido puede anotarse desde el momento cero
    if (match.createdBy === authStore.user?.uid) return true

    // Partido de grupo: solo miembros de ese grupo (o admin global)
    if (match.groupId && !authStore.isAdmin && !authStore.isMemberOfGroup(match.groupId)) {
      return false
    }

    const now = Date.now()
    const openAt = match.openAt?.toMillis?.() ?? 0

    // Acceso anticipado (OG / owner / admin del grupo): umbral 30 min antes.
    const hasEarlyAccess = authStore.isOgInGroup(match.groupId)
    const threshold = hasEarlyAccess ? openAt - EARLY_ACCESS_MS : openAt

    return now >= threshold
  }

  /**
   * Milisegundos restantes para que abra la inscripción (para countdown).
   * @param {{ openAt: Timestamp, createdBy: string }} match
   */
  function msUntilOpen(match) {
    // El creador no espera: para él la lista está siempre abierta
    if (match?.createdBy === authStore.user?.uid) return 0

    const openAt = match?.openAt?.toMillis?.() ?? 0
    const hasEarlyAccess = authStore.isOgInGroup(match?.groupId)
    const threshold = hasEarlyAccess ? openAt - EARLY_ACCESS_MS : openAt

    return Math.max(0, threshold - Date.now())
  }

  /**
   * ¿Puede VER quién ya está anotado? Mismo umbral que la propia inscripción
   * de cada uno: el creador siempre, un OG desde que abre SU ventana (30 min
   * antes), un miembro común recién a la hora oficial. Es "engaño visual" a
   * propósito — un miembro no debe ver que ya hay gente anotada mientras para
   * él la lista todavía figura cerrada; cuando le toca a él, ya la ve poblada.
   * @param {{ openAt: Timestamp, createdBy: string, groupId: string|null }} match
   */
  function canSeeRegistrations(match) {
    if (!match) return false
    return msUntilOpen(match) <= 0
  }

  /**
   * ¿Estamos en la ventana anticipada del partido? (openAt - 30 min ≤ ahora < openAt)
   * En esta ventana solo pueden anotarse (y ser anotados) quienes tienen
   * acceso anticipado — nada de invitados.
   */
  function isInEarlyWindow(match) {
    const openAt = match?.openAt?.toMillis?.() ?? 0
    if (!openAt) return false
    const now = Date.now()
    return now >= openAt - EARLY_ACCESS_MS && now < openAt
  }

  function stopListening() {
    unsubscribe?.()
    unsubscribe = null
    unsubscribes.forEach(unsub => unsub?.())
    unsubscribes.clear()
  }

  return {
    registrations,
    userRegistration,
    loading,
    error,
    joinMatch,
    addGuestToMatch,
    addMemberToMatch,
    leaveMatch,
    removeRegistration,
    canRegister,
    msUntilOpen,
    canSeeRegistrations,
    isInEarlyWindow,
    subscribeToRegistrations,
    stopListening,
    REGISTRATION_ERRORS,
  }
}
