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
  writeBatch,
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
  GUEST_OTHER_MATCH:
    'Como invitado solo podés anotarte al partido del link que te compartieron. Creá una cuenta para sumarte a los demás.',
  GUEST_CANNOT_ADD: 'Como invitado solo podés anotarte a vos mismo.',
}

// Ventana de acceso anticipado (OG / owner / admin del grupo): 30 minutos
export const EARLY_ACCESS_MS = 30 * 60 * 1000

/**
 * Milisegundos de adelanto que le corresponden a ESTE partido para quien
 * tiene acceso anticipado. Normalmente 30 min; 0 si el partido se creó con
 * "abrir la lista ahora" (`instantOpen`), donde la gracia del anticipo no
 * existe: la lista se abrió en el momento y arrancan todos juntos.
 * Centralizado acá porque el cálculo del umbral se repite en registerEntry,
 * canRegister y msUntilOpen — y las tres tienen que coincidir.
 */
export function earlyAccessMsFor(match) {
  return match?.instantOpen === true ? 0 : EARLY_ACCESS_MS
}

/**
 * ÚNICA fuente de verdad del "¿cuándo puede este usuario tocar este partido?".
 *
 * Antes esto vivía duplicado en canRegister, msUntilOpen y canSeeRegistrations,
 * y las tres divergieron: msUntilOpen no chequeaba membresía ni modo invitado,
 * así que canSeeRegistrations (que se apoya en él) dejaba ver la lista de
 * inscriptos de un grupo ajeno. Ahora las tres consumen esto.
 *
 * @returns {{ allowed: boolean, threshold: number }}
 *   allowed   → el usuario tiene derecho a este partido (membresía / link de
 *               invitado / creador). Si es false, no hay umbral que esperar:
 *               nunca se le habilita.
 *   threshold → epoch ms a partir del cual se le abre la lista.
 */
function registrationAccessFor(match, authStore) {
  const denied = { allowed: false, threshold: Infinity }
  if (!match) return denied

  const openAt = match.openAt?.toMillis?.() ?? 0

  // Invitado anónimo: solo el partido de su link, y recién desde openAt
  // (nunca en la ventana anticipada). No pertenece a ningún grupo, así que
  // no pasa por la validación de membresía.
  if (authStore.isGuest) {
    if (match.id !== authStore.guestMatchId) return denied
    return { allowed: true, threshold: openAt }
  }

  // El creador no espera: para él la lista está abierta desde el momento cero.
  if (match.createdBy && match.createdBy === authStore.user?.uid) {
    return { allowed: true, threshold: 0 }
  }

  // Partido de grupo: solo miembros. Un admin global NO tiene bypass para
  // participar en partidos de grupos ajenos (sí para verlos en superAdminMode).
  if (match.groupId && !authStore.isMemberOfGroup(match.groupId)) return denied

  // Acceso anticipado (OG / owner / admin del grupo): 30 min antes, salvo en
  // partidos de apertura inmediata, donde no hay adelanto para nadie.
  const hasEarlyAccess = authStore.isOgInGroup(match.groupId)
  const threshold = hasEarlyAccess ? openAt - earlyAccessMsFor(match) : openAt
  return { allowed: true, threshold }
}

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
        const uid = authStore.user?.uid
        // Un invitado anónimo se anota como isGuest con userId null, así que
        // buscarlo por userId no lo encontraría nunca y se quedaría sin el
        // botón de cancelar. Su docId ES su uid (ver registerEntry), que es
        // además lo que las reglas usan para atarlo a SU inscripción.
        userRegistration.value = authStore.isGuest
          ? (regs.find((r) => r.id === uid) ?? null)
          : (regs.find((r) => r.userId === uid) ?? null)
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
    // docId de la inscripción:
    //  - miembro con cuenta        → su uid (una inscripción por persona)
    //  - invitado ANÓNIMO (link)   → su propio uid anónimo. Así las reglas
    //    pueden verificar que el contador de cupos que mueve corresponde a SU
    //    inscripción y no a la de otro (guestHasEntryInMatch). Además le impide
    //    anotarse dos veces al mismo partido, que antes era posible.
    //  - invitado SIN cuenta       → docId autogenerado, porque una misma
    //    persona puede anotar a varios invitados distintos.
    const isAnonSelfGuest = entry.isGuest && authStore.isGuest
    const regRef = entry.isGuest
      ? (isAnonSelfGuest
          ? doc(db, 'matches', matchId, 'registrations', user.uid)
          : doc(collection(db, 'matches', matchId, 'registrations')))
      : doc(db, 'matches', matchId, 'registrations', entry.targetUserId)

    try {
      const result = await runTransaction(db, async (transaction) => {
        // ── 1. LECTURAS (siempre primero en una transacción de Firestore) ──
        const matchSnap = await transaction.get(matchRef)
        // El invitado anónimo también se lee: ahora su docId es su uid, así que
        // se puede detectar (y rechazar) que se anote dos veces al mismo partido.
        const regSnap = entry.isGuest && !isAnonSelfGuest ? null : await transaction.get(regRef)

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

        // Invitado anónimo (link compartido): no es miembro de ningún grupo,
        // así que la validación de membresía de abajo lo rechazaría. Se lo
        // exceptúa SOLO para el partido cuyo link lo trajo (guestMatchId) y
        // SOLO desde openAt — nunca en la ventana anticipada, igual que
        // cualquier otro invitado. Que se anote a otra persona no tiene
        // sentido: solo puede anotarse a sí mismo.
        const isAnonGuest = authStore.isGuest
        if (isAnonGuest) {
          if (matchId !== authStore.guestMatchId) {
            throw new Error(REGISTRATION_ERRORS.GUEST_OTHER_MATCH)
          }
          if (now < openAtMillis) {
            throw new Error(REGISTRATION_ERRORS.EARLY_NO_GUESTS)
          }
          if (!entry.isGuest) {
            throw new Error(REGISTRATION_ERRORS.GUEST_CANNOT_ADD)
          }
        }

        if (!creatorSelf && !isAnonGuest) {
          // Partido de grupo: solo miembros de ese grupo pueden anotarse o
          // anotar a otra persona. Un admin global NO tiene bypass acá — un
          // admin del sistema no debe poder sumarse a partidos de grupos
          // ajenos, solo puede participar como cualquier usuario normal (ver
          // "Modo superadmin" para visibilidad de solo lectura). Los
          // partidos sin grupo (groupId null) son globales y quedan abiertos.
          if (match.groupId) {
            const callerMemberSnap = await transaction.get(
              doc(db, 'groups', match.groupId, 'members', user.uid),
            )
            if (!callerMemberSnap.exists()) {
              throw new Error(REGISTRATION_ERRORS.NOT_GROUP_MEMBER)
            }
          }

          const hasEarlyAccess = authStore.isOgInGroup(match.groupId) || isCreator
          const earlyMs = earlyAccessMsFor(match)
          const threshold = hasEarlyAccess ? openAtMillis - earlyMs : openAtMillis
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
          } else if (!isSelf && !entry.isGuest && match.groupId) {
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
        // Formato libre (maxPlayers null): nunca hay lista de espera, todos
        // entran como titulares. `newPosition > null` sería true en JS (null
        // se coerciona a 0), así que hay que chequear explícitamente.
        const currentCount = match.currentPlayers ?? 0
        const newPosition = currentCount + 1
        const isOnWaitlist = match.maxPlayers != null && newPosition > match.maxPlayers

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
  //
  // Caso invitado anónimo (entró por un link compartido): se anota como
  // INVITADO (isGuest: true, userId null) aunque tenga una sesión de Firebase.
  // Es a propósito — así queda igual que un invitado anotado a mano por otro
  // jugador: aparece en la lista pero no acumula estadísticas ni recibe MVP,
  // que es exactamente lo que se le prometió en la pantalla de invitación.
  // El uid anónimo igual queda en `addedBy`, así puede darse de baja solo.
  function joinMatch(matchId) {
    const user = authStore.user
    if (!user) throw new Error('Usuario no autenticado')

    if (authStore.isGuest) {
      const name = (user.displayName ?? '').trim()
      if (!name) throw new Error('Necesitamos tu nombre para anotarte en la lista.')
      return registerEntry(matchId, {
        targetUserId: null,
        isGuest: true,
        guestName: name,
        displayName: name,
        photoURL: null,
      })
    }

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

  // Cancela la inscripción del propio usuario. El docId es su uid en los dos
  // casos —usuario con cuenta e invitado anónimo del link—, así que no hace
  // falta distinguir: ver el docId del invitado en registerEntry.
  function leaveMatch(matchId) {
    const user = authStore.user
    if (!user) throw new Error('Usuario no autenticado')
    return removeRegistration(matchId, user.uid)
  }

  // ── ASIGNAR EQUIPOS (antes de jugar) ──────────────────────────────────────
  // Graba team: 'A'|'B' en cada registration — es lo que después se ve en la
  // lista dividida por equipo (MatchDetailPage) y en "Compartir lista". Queda
  // editable: se puede volver a llamar (o reasignar a mano) en cualquier
  // momento antes de cargar el resultado. Permiso: solo quien tiene acceso
  // anticipado en el grupo del partido (OG/owner/admin) o admin global —
  // reforzado también en las reglas de Firestore (solo pueden tocar `team`).
  /**
   * @param {string} matchId
   * @param {Array<{ registrationId: string, team: 'A'|'B'|null }>} assignments
   */
  async function assignTeams(matchId, assignments) {
    loading.value = true
    error.value = null
    try {
      const batch = writeBatch(db)
      assignments.forEach(({ registrationId, team }) => {
        batch.update(doc(db, 'matches', matchId, 'registrations', registrationId), { team })
      })
      await batch.commit()
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
   * Con estado 'full' (cupo lleno) sigue permitido → entra como suplente.
   * @param {{ openAt: Timestamp, status: string, createdBy: string }} match
   */
  function canRegister(match) {
    if (!match) return false
    const effectiveStatus = getEffectiveStatus(match)
    if (effectiveStatus === 'closed' || effectiveStatus === 'finished') return false
    if (userRegistration.value) return false

    const { allowed, threshold } = registrationAccessFor(match, authStore)
    return allowed && Date.now() >= threshold
  }

  /**
   * Milisegundos restantes para que abra la inscripción (para countdown).
   * @param {{ openAt: Timestamp, createdBy: string }} match
   */
  function msUntilOpen(match) {
    const { allowed, threshold } = registrationAccessFor(match, authStore)
    // Sin derecho al partido (no sos del grupo, o sos invitado de otro link):
    // no hay countdown que mostrar y la lista nunca se le abre.
    if (!allowed) return Infinity
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
    const earlyMs = earlyAccessMsFor(match)
    if (earlyMs === 0) return false  // apertura inmediata: no existe la ventana
    const now = Date.now()
    return now >= openAt - earlyMs && now < openAt
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
    assignTeams,
    canRegister,
    msUntilOpen,
    canSeeRegistrations,
    isInEarlyWindow,
    subscribeToRegistrations,
    stopListening,
    REGISTRATION_ERRORS,
  }
}
