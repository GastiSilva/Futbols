// src/composables/useActivityFeed.js
// ─────────────────────────────────────────────────────────────────────────────
// Feed de actividad: timeline liviano de eventos (alguien se anotó, ganó una
// insignia, etc.) de los grupos del usuario. Los eventos los escriben
// ÚNICAMENTE triggers puntuales del backend (onRegistrationCreated,
// runMonthlyBadges) — este composable es de solo lectura.
//
// Mismo patrón que subscribeToUpcoming en useMatch.js: una suscripción por
// tanda de hasta 30 grupos (límite de `in` en Firestore), combinadas y
// ordenadas por fecha. No hay branch "sin grupo": un evento siempre pertenece
// a un grupo (ver EventSchema en firestore.schema.js).
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

// Tope por tanda de groupIds. Las reglas exigen `limit` explícito en `list`
// (ver `allow list` de /events en firestore.rules) y no pueden verificar el
// `groupId` pedido — el aislamiento real depende de que el cliente solo pida
// sus propios grupos, igual criterio que matches.
export const FEED_QUERY_LIMIT = 30

export function useActivityFeed() {
  const authStore = useAuthStore()
  const events = ref([])
  const loading = ref(true)
  const error = ref(null)
  let unsubscribe = null

  /**
   * Se suscribe al feed combinado de los grupos del usuario. Devuelve la
   * función de unsubscribe (llamarla en onUnmounted).
   */
  function subscribeToFeed() {
    const perGroupEvents = new Map()
    const subscriptions = []

    function emit() {
      const all = [...perGroupEvents.values()].flat()
      events.value = all
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
        .slice(0, FEED_QUERY_LIMIT)
      loading.value = false
    }

    function listen(groupId) {
      const q = query(
        collection(db, 'events'),
        where('groupId', '==', groupId),
        orderBy('createdAt', 'desc'),
        limit(FEED_QUERY_LIMIT),
      )
      const stop = onSnapshot(
        q,
        (snap) => {
          perGroupEvents.set(
            groupId,
            snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          )
          emit()
        },
        (err) => {
          error.value = err.message
          loading.value = false
        },
      )
      subscriptions.push(stop)
    }

    const groupIds = authStore.memberGroupIds ?? []
    if (groupIds.length === 0) {
      events.value = []
      loading.value = false
    } else {
      groupIds.forEach((groupId) => listen(groupId))
    }

    unsubscribe = () => {
      subscriptions.forEach((stop) => stop())
      subscriptions.length = 0
    }
    return unsubscribe
  }

  return { events, loading, error, subscribeToFeed }
}
