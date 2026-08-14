// src/composables/useMatchInvite.js
// ─────────────────────────────────────────────────────────────────────────────
//  Invitación a un partido por LINK compartido.
//
//  El link (`/partidos/{id}?invitado=1`) puede caerle a tres personas distintas
//  y el objetivo es que ninguna quede en un callejón sin salida:
//
//   (a) Ya logueada y miembro del grupo → camino normal, igual que si hubiera
//       llegado por la notificación: entra directo a la ficha del partido.
//   (b) Ya logueada pero NO miembro del grupo → se anota y se la suma al grupo
//       en el mismo movimiento (el link de un partido vale como invitación al
//       grupo que lo organiza).
//   (c) Sin sesión → elige: entrar como invitado (sesión anónima, solo puede
//       anotarse y mirar Partidos) o iniciar sesión / crear cuenta, que hace el
//       circuito completo — loguea, anota y suma al grupo.
//
//  En el caso (c) el login rebota por /login y vuelve, así que la intención
//  ("estaba entrando a este partido") tiene que sobrevivir a esa navegación:
//  se guarda en sessionStorage y la consume `consumePendingInvite()` cuando la
//  sesión ya está lista. Mismo patrón que el `postVerifyRedirect` de LoginPage
//  y que las invitaciones a grupos.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { doc, getDoc, setDoc, serverTimestamp, runTransaction, increment } from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

const PENDING_INVITE_KEY = 'pendingMatchInvite'

// ── Persistencia de la intención pendiente ───────────────────────────────────
export function setPendingInvite(matchId) {
  if (matchId) sessionStorage.setItem(PENDING_INVITE_KEY, matchId)
}

export function peekPendingInvite() {
  return sessionStorage.getItem(PENDING_INVITE_KEY) || null
}

// Lee y BORRA en el mismo paso: la intención se ejecuta una sola vez, si no
// el usuario quedaría volviendo a ese partido en cada login de la sesión.
export function consumePendingInvite() {
  const matchId = peekPendingInvite()
  sessionStorage.removeItem(PENDING_INVITE_KEY)
  return matchId
}

export function clearPendingInvite() {
  sessionStorage.removeItem(PENDING_INVITE_KEY)
}

// Construye el link para compartir por WhatsApp.
//
// Apunta a /invitacion/{id} — la landing PÚBLICA. Mandar a /partidos/{id}
// sería un error: esa ruta exige sesión y el guard rebotaría al login a
// cualquiera que todavía no tenga cuenta, que es justo a quien va dirigido.
//
// Ojo con el origin: en desarrollo es http://localhost:9000 y WhatsApp NO lo
// convierte en link clickeable (no es un dominio real). Por eso, si se
// comparte desde localhost, se cae al dominio de producción — así el link
// pegado en un chat sirve siempre.
const PROD_ORIGIN = 'https://listasfutbol-23089.web.app'

export function buildMatchInviteLink(matchId) {
  const origin = window.location.origin
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(origin)
  return `${isLocal ? PROD_ORIGIN : origin}/invitacion/${matchId}`
}

export function useMatchInvite() {
  const authStore = useAuthStore()
  const loading = ref(false)
  const error = ref(null)

  // ── Sumar al usuario logueado al grupo del partido ─────────────────────────
  // El link de un partido funciona como invitación al grupo que lo organiza:
  // quien llega por ahí y se anota, queda como miembro (rol 'member', sin OG).
  // Si ya es miembro no hace nada. Es idempotente a propósito — se llama
  // después de anotarse y no debe romper si la persona ya estaba adentro.
  async function joinMatchGroup(matchId) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('Usuario no autenticado')

    const matchSnap = await getDoc(doc(db, 'matches', matchId))
    if (!matchSnap.exists()) throw new Error('El partido no existe.')

    const groupId = matchSnap.data().groupId ?? null
    if (!groupId) return { groupId: null, joined: false }  // partido global

    const memberRef = doc(db, 'groups', groupId, 'members', uid)
    const memberSnap = await getDoc(memberRef)
    if (memberSnap.exists()) return { groupId, joined: false }

    await runTransaction(db, async (tx) => {
      tx.set(memberRef, {
        userId: uid,
        displayName: authStore.user.nickname || authStore.user.displayName,
        photoURL: authStore.user.photoURL ?? null,
        role: 'member',
        joinedAt: serverTimestamp(),
      })
      tx.update(doc(db, 'groups', groupId), {
        memberCount: increment(1),
        updatedAt: serverTimestamp(),
      })
    })

    // Espejo en users/{uid}/groups (lo que lee getMyGroups)
    await setDoc(doc(db, 'users', uid, 'groups', groupId), {
      joinedAt: serverTimestamp(),
    })

    // El store se actualiza al toque para que el filtro de partidos por grupo
    // (useMatch.subscribeToUpcoming) deje ver este partido sin recargar.
    if (!authStore.memberGroupIds.includes(groupId)) {
      authStore.setMemberGroups([...authStore.memberGroupIds, groupId])
    }

    return { groupId, joined: true }
  }

  // ── Datos mínimos del partido para la pantalla de bienvenida ───────────────
  // Un invitado anónimo PUEDE leer el partido (las reglas solo piden estar
  // autenticado), pero esta función se usa antes de decidir, con la sesión ya
  // creada. Devuelve null si el partido no existe (link viejo o mal copiado).
  async function fetchInviteMatch(matchId) {
    loading.value = true
    error.value = null
    try {
      const snap = await getDoc(doc(db, 'matches', matchId))
      if (!snap.exists()) return null
      return { id: snap.id, ...snap.data() }
    } catch (err) {
      error.value = err.message
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    error,
    joinMatchGroup,
    fetchInviteMatch,
  }
}
