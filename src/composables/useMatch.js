// src/composables/useMatch.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable para crear, listar y observar partidos en Firestore.
// ─────────────────────────────────────────────────────────────────────────────
import { ref, computed, watch } from 'vue'
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

// Tope de resultados de cualquier query a `matches`. Las reglas EXIGEN un
// `limit` explícito y no mayor a este valor (ver `allow list` en
// firestore.rules): sin tope, una sola consulta podía barrer la colección
// entera. Toda query nueva a `matches` tiene que llevarlo o Firestore la
// rechaza con permission-denied.
export const MATCH_QUERY_LIMIT = 200

// ── Formatos de partido → cupos máximos ───────────────────────────────────────
// 'libre' no tiene tope: maxPlayers queda null, cualquiera se anota siempre
// como titular (nunca hay lista de espera) — pensado para cuando todavía no
// se sabe si van a sumarse 10 o 14 personas.
export const FORMAT_OPTIONS = [
  { label: '5 vs 5  (10 jugadores)', value: '5v5', maxPlayers: 10 },
  { label: '7 vs 7  (14 jugadores)', value: '7v7', maxPlayers: 14 },
  { label: '8 vs 8  (16 jugadores)', value: '8v8', maxPlayers: 16 },
  { label: '11 vs 11  (22 jugadores)', value: '11v11', maxPlayers: 22 },
  { label: 'Libre (sin límite de jugadores)', value: 'libre', maxPlayers: null },
]

export function getMaxPlayers(format) {
  const found = FORMAT_OPTIONS.find((f) => f.value === format)
  return found ? found.maxPlayers : 10
}

// ── Estado de un partido ──────────────────────────────────────────────────────
export const MATCH_STATUS = {
  SCHEDULED: 'scheduled', // creado, lista aún cerrada
  OPEN: 'open',           // inscripciones abiertas
  CLOSED: 'closed',       // cerrado manualmente (no admite ni suplentes)
  FINISHED: 'finished',   // resultados cargados
}

/**
 * Calcula el estado efectivo de un partido en el cliente.
 * No escribe en Firestore — solo para display y lógica UI.
 *
 * Reglas:
 *  - 'finished' siempre es autoritativo
 *  - 'closed'   siempre es autoritativo
 *  - Si currentPlayers >= maxPlayers → 'full' (cupo lleno, pero se admite
 *    anotarse como SUPLENTE en la lista de espera)
 *  - Si 'scheduled' pero openAt ya pasó → 'open'
 *  - Cualquier otro caso respeta el valor de Firestore
 */
export function getEffectiveStatus(match) {
  if (!match) return null
  if (match.status === 'finished') return 'finished'
  if (match.status === 'closed') return 'closed'
  if ((match.currentPlayers ?? 0) >= (match.maxPlayers ?? Infinity)) return 'full'
  if (match.status === 'scheduled') {
    const openAtMillis = match.openAt?.toMillis?.() ?? 0
    if (openAtMillis && Date.now() >= openAtMillis) return 'open'
  }
  return match.status
}

export function useMatch() {
  const authStore = useAuthStore()
  const matches = ref([])
  const publicMatches = ref([])   // partidos publicados de OTROS grupos
  const finishedMatches = ref([]) // partidos ya jugados, de cualquiera de mis grupos
  const currentMatch = ref(null)
  const loading = ref(false)
  const error = ref(null)

  let unsubscribe = null
  let publicUnsubscribe = null
  let finishedUnsubscribe = null

  // ── Escucha en tiempo real los próximos partidos ──────────────────────────
  // Solo se muestran partidos de los grupos del usuario, o partidos sin grupo
  // (globales). Un admin global, por defecto, ve SOLO lo suyo también — no
  // quiere partidos/notificaciones de grupos ajenos mezclados con los propios
  // (es dueño del sistema, no necesariamente parte de todo). Con
  // superAdminMode activado (toggle manual en el panel admin, de sesión) ve
  // todo, para debuggear o revisar datos de otros grupos. Esto es solo
  // filtrado de visibilidad en el cliente — la autorización real de anotarse
  // vive en useRegistration.registerEntry y en firestore.rules.
  function subscribeToUpcoming() {
    // Una suscripción por "fuente" de partidos: los globales (groupId null) y
    // una por cada tanda de grupos del usuario. Los resultados se van juntando
    // en este mapa y se emiten combinados y ordenados por fecha.
    //
    // Antes esto era UNA sola query sin filtro de grupo (`where status in [...]`
    // a secas) y el recorte por membresía se hacía en JavaScript sobre lo ya
    // recibido. O sea: el dispositivo se descargaba los partidos de TODOS los
    // grupos — título, sede, fecha, creador — y solo dibujaba los propios. El
    // filtro era cosmético; con la consola abierta se veía todo. Ahora la
    // consulta pide únicamente lo que corresponde, y firestore.rules exige que
    // así sea (allow list de /matches).
    const perSourceMatches = new Map()
    const subscriptions = []
    const appliedMatchStops = new Map() // matchId -> unsubscribe del doc puntual

    function emit() {
      const byId = new Map()
      perSourceMatches.forEach((list) => list.forEach((m) => byId.set(m.id, m)))
      const all = [...byId.values()]

      // Invitado del link: solo su partido. No es miembro de ningún grupo, así
      // que sin esto vería todos los partidos globales, que no le sirven.
      matches.value = authStore.isGuest
        ? all.filter((m) => m.id === authStore.guestMatchId)
        : all.sort((a, b) => (a.date?.toMillis?.() ?? 0) - (b.date?.toMillis?.() ?? 0))
    }

    function listen(key, constraints) {
      const q = query(
        collection(db, 'matches'),
        where('status', 'in', [MATCH_STATUS.SCHEDULED, MATCH_STATUS.OPEN]),
        ...constraints,
        orderBy('date', 'asc'),
        limit(MATCH_QUERY_LIMIT),
      )
      const stop = onSnapshot(
        q,
        (snap) => {
          perSourceMatches.set(
            key,
            snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          )
          emit()
        },
        (err) => {
          error.value = err.message
        },
      )
      subscriptions.push(stop)
    }

    function resubscribe() {
      subscriptions.forEach((stop) => stop())
      subscriptions.length = 0
      perSourceMatches.clear()

      // Un invitado del link no lista la colección: lee su partido puntual por
      // id (subscribeToMatch). Las reglas directamente le niegan el `list`.
      if (authStore.isGuest) {
        matches.value = []
        return
      }

      // Partidos sin grupo: son globales, los ve cualquiera con cuenta.
      listen('groupless', [where('groupId', '==', null)])

      // Partidos de los grupos del usuario. Firestore limita `in` a 30 valores,
      // así que se parte en tandas — cada tanda es su propia suscripción.
      const groupIds = authStore.superAdminMode ? [] : authStore.memberGroupIds.slice()
      for (let i = 0; i < groupIds.length; i += 30) {
        const chunk = groupIds.slice(i, i + 30)
        listen(`groups:${i}`, [where('groupId', 'in', chunk)])
      }

      // Modo superadmin (toggle manual del panel admin): ve TODO, para
      // debuggear o revisar datos de otros grupos. Las reglas se lo permiten
      // solo por ser admin global.
      if (authStore.superAdminMode) {
        listen('all', [])
      }

      emit()
    }

    // Partidos donde te aceptaron una postulación PÚBLICA a un grupo del que
    // no sos miembro: `onApplicationResolved` crea la registration real, pero
    // ese matchId nunca cae en ninguna query de arriba (son por groupId propio
    // o groupless) — sin esto, quien te suma ve el partido y vos no. La lista
    // de ids sale de `authStore.appliedMatchIds` (poblada en tiempo real
    // desde el login por useAuth.watchAppliedMatches, no acá — tiene que
    // existir aunque nunca se pase por esta suscripción, porque
    // registrationAccessFor la necesita en MatchDetailPage también).
    function syncAppliedMatchListeners() {
      const acceptedIds = authStore.appliedMatchIds

      // Deja de escuchar partidos que ya no están aceptados (se retiró,
      // se rechazó, etc.)
      for (const [matchId, stopDoc] of appliedMatchStops) {
        if (!acceptedIds.has(matchId)) {
          stopDoc()
          appliedMatchStops.delete(matchId)
          perSourceMatches.delete(`applied:${matchId}`)
        }
      }

      // Abre un listener puntual por cada match nuevo aceptado.
      for (const matchId of acceptedIds) {
        if (appliedMatchStops.has(matchId)) continue
        const stopDoc = onSnapshot(
          doc(db, 'matches', matchId),
          (docSnap) => {
            perSourceMatches.set(
              `applied:${matchId}`,
              docSnap.exists() ? [{ id: docSnap.id, ...docSnap.data() }] : [],
            )
            emit()
          },
          (err) => {
            // Un match borrado puede dar permission-denied en vez de "no
            // existe" (las reglas de `get` dependen de leer datos del propio
            // doc, que ya no está). Sin limpiar acá, el ÚLTIMO dato válido
            // (el partido completo, de antes de borrarlo) quedaba pegado en
            // "Partidos" para siempre — parecía que el partido borrado
            // seguía existiendo.
            error.value = err.message
            perSourceMatches.delete(`applied:${matchId}`)
            emit()
          },
        )
        appliedMatchStops.set(matchId, stopDoc)
      }

      emit()
    }

    // memberGroupIds se puebla de forma asíncrona en el login (loadOgGroups) y
    // puede llegar DESPUÉS de la primera suscripción. Sin este watch, un
    // miembro común se quedaba sin sus partidos hasta recargar la página.
    const stopWatch = watch(
      () => [authStore.memberGroupIds.slice(), authStore.superAdminMode, authStore.guestMatchId],
      resubscribe,
      { immediate: true },
    )

    const stopAppliedWatch = watch(
      () => [...authStore.appliedMatchIds],
      syncAppliedMatchListeners,
      { immediate: true },
    )

    unsubscribe = () => {
      subscriptions.forEach((stop) => stop())
      subscriptions.length = 0
      appliedMatchStops.forEach((stop) => stop())
      appliedMatchStops.clear()
      stopWatch()
      stopAppliedWatch()
    }
    return unsubscribe
  }

  // ── Partidos TERMINADOS de mis grupos (resultados viejos) ─────────────────
  // Antes esto solo se veía entrando al grupo puntual (subscribeToGroupMatches)
  // — "Partidos" (Dashboard) solo mostraba scheduled/open, así que un
  // resultado de hace dos semanas era invisible salvo que te acordaras de qué
  // grupo era. Mismo patrón multi-fuente que subscribeToUpcoming (groupless +
  // tandas de 30 por el límite de `in` de Firestore), pero status == finished
  // y orden descendente (el más reciente primero).
  const FINISHED_QUERY_LIMIT = 30

  function subscribeToFinished() {
    const perSourceFinished = new Map()
    const subs = []

    function emitFinished() {
      const byId = new Map()
      perSourceFinished.forEach((list) => list.forEach((m) => byId.set(m.id, m)))
      finishedMatches.value = [...byId.values()]
        .sort((a, b) => (b.date?.toMillis?.() ?? 0) - (a.date?.toMillis?.() ?? 0))
        .slice(0, FINISHED_QUERY_LIMIT)
    }

    function listenFinished(key, constraints) {
      const q = query(
        collection(db, 'matches'),
        where('status', '==', MATCH_STATUS.FINISHED),
        ...constraints,
        orderBy('date', 'desc'),
        limit(FINISHED_QUERY_LIMIT),
      )
      const stop = onSnapshot(
        q,
        (snap) => {
          perSourceFinished.set(key, snap.docs.map((d) => ({ id: d.id, ...d.data() })))
          emitFinished()
        },
        (err) => {
          error.value = err.message
        },
      )
      subs.push(stop)
    }

    function resubscribeFinished() {
      subs.forEach((stop) => stop())
      subs.length = 0
      perSourceFinished.clear()

      if (authStore.isGuest) {
        finishedMatches.value = []
        return
      }

      listenFinished('groupless', [where('groupId', '==', null)])

      const groupIds = authStore.superAdminMode ? [] : authStore.memberGroupIds.slice()
      for (let i = 0; i < groupIds.length; i += 30) {
        const chunk = groupIds.slice(i, i + 30)
        listenFinished(`groups:${i}`, [where('groupId', 'in', chunk)])
      }

      if (authStore.superAdminMode) {
        listenFinished('all', [])
      }

      emitFinished()
    }

    const stopWatch = watch(
      () => [authStore.memberGroupIds.slice(), authStore.superAdminMode],
      resubscribeFinished,
      { immediate: true },
    )

    finishedUnsubscribe = () => {
      subs.forEach((stop) => stop())
      subs.length = 0
      stopWatch()
    }
    return finishedUnsubscribe
  }

  function stopListeningFinished() {
    finishedUnsubscribe?.()
    finishedUnsubscribe = null
  }

  // ── Partidos PÚBLICOS (los que buscan jugadores de afuera) ────────────────
  // Lista los partidos con `isPublic == true` que todavía admiten gente. Se
  // excluyen en el cliente los de MIS grupos: si ya sos del grupo te anotás
  // derecho en la lista, no te postulás (las reglas rechazan esa postulación,
  // así que mostrarlos sería ofrecer un botón que falla).
  //
  // Una sola query alcanza (a diferencia de subscribeToUpcoming, que abre una
  // por grupo): acá el filtro es un campo del propio documento, no la
  // membresía. Igual lleva `limit` obligatorio — lo exigen las reglas.
  function subscribeToPublicMatches() {
    const q = query(
      collection(db, 'matches'),
      where('isPublic', '==', true),
      where('status', 'in', [MATCH_STATUS.SCHEDULED, MATCH_STATUS.OPEN]),
      orderBy('date', 'asc'),
      limit(MATCH_QUERY_LIMIT),
    )

    const rawPublic = ref([])

    function applyFilter() {
      const now = Date.now()
      publicMatches.value = rawPublic.value
        .filter((m) => {
          // Ya pasó: no tiene sentido postularse
          if ((m.date?.toMillis?.() ?? 0) < now) return false
          // De un grupo mío: me anoto solo, no me postulo
          if (m.groupId && authStore.isMemberOfGroup(m.groupId)) return false
          return true
        })
        .sort((a, b) => (a.date?.toMillis?.() ?? 0) - (b.date?.toMillis?.() ?? 0))
    }

    const stopSnapshot = onSnapshot(
      q,
      (snap) => {
        rawPublic.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        applyFilter()
      },
      (err) => {
        error.value = err.message
      },
    )

    // memberGroupIds llega async en el login: sin esto, alguien que abre la
    // pantalla apenas entra vería partidos de sus propios grupos hasta recargar.
    const stopWatch = watch(() => authStore.memberGroupIds.slice(), applyFilter)

    const stop = () => {
      stopSnapshot()
      stopWatch()
    }
    publicUnsubscribe = stop
    return stop
  }

  function stopListeningPublic() {
    publicUnsubscribe?.()
    publicUnsubscribe = null
  }

  // ── Publicar / despublicar un partido ─────────────────────────────────────
  // Acción manual del organizador ("me faltan 2, que se sume alguien"). No es
  // un campo que se define al crear: la mayoría de los partidos se llenan
  // dentro del grupo y nunca se publican.
  async function setMatchPublic(matchId, isPublic, spotsWanted = null) {
    loading.value = true
    error.value = null
    try {
      await updateDoc(doc(db, 'matches', matchId), {
        isPublic,
        publishedAt: isPublic ? serverTimestamp() : null,
        spotsWanted: isPublic ? (spotsWanted ?? null) : null,
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
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
        venueId: formData.venueId ?? null,
        venueMapsUrl: formData.venueMapsUrl ?? null,
        venueLat: formData.venueLat ?? null,
        venueLng: formData.venueLng ?? null,
        provincia: formData.provincia ?? null,
        ciudad: formData.ciudad ?? null,
        date,
        openAt,
        notifyAt,
        groupId: formData.groupId ?? null,
        format: formData.format,
        maxPlayers,
        currentPlayers: 0,
        // Lista abierta en el momento: no hay ventana de acceso anticipado.
        // Todos (OG, owner/admin y miembros comunes) se anotan desde el mismo
        // instante y la notificación sale para todo el grupo a la vez.
        instantOpen: formData.instantOpen === true,
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
        venueId: formData.venueId ?? null,
        venueMapsUrl: formData.venueMapsUrl ?? null,
        venueLat: formData.venueLat ?? null,
        venueLng: formData.venueLng ?? null,
        provincia: formData.provincia ?? null,
        ciudad: formData.ciudad ?? null,
        date,
        openAt,
        notifyAt,
        groupId: formData.groupId ?? null,
        format: formData.format,
        maxPlayers,
        // El selector "Estado del partido" de EditMatchPage
        ...(formData.status ? { status: formData.status } : {}),
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Guardar resultado post-partido ─────────────────────────────────────────
  // El MVP ya no se fija acá: se decide por votación (useMvpVoting) y lo
  // escribe la Cloud Function closeMvpVoting cuando se cierra la votación.
  // finishedAt se fija SOLO la primera vez que el partido pasa a 'finished'
  // (re-guardar un resultado ya cargado no debe correr el reloj de las 36hs
  // del auto-cierre) — por eso el caller debe indicar si ya estaba finalizado.
  async function saveMatchResult(matchId, { scoreA, scoreB }, { alreadyFinished = false } = {}) {
    loading.value = true
    try {
      await updateDoc(doc(db, 'matches', matchId), {
        scoreA,
        scoreB,
        status: MATCH_STATUS.FINISHED,
        ...(alreadyFinished ? {} : { finishedAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Marcar/desmarcar cancha reservada ──────────────────────────────────────
  async function toggleVenueReserved(matchId, reserved) {
    await updateDoc(doc(db, 'matches', matchId), {
      venueReserved: reserved,
      updatedAt: serverTimestamp(),
    })
  }

  // ── Próximo partido visible para el jugador ───────────────────────────────
  const nextMatch = computed(() => matches.value[0] ?? null)

  // ── Escucha en tiempo real los partidos de un grupo ───────────────────────
  function subscribeToGroupMatches(groupId) {
    const q = query(
      collection(db, 'matches'),
      where('groupId', '==', groupId),
      orderBy('date', 'asc'),
      limit(MATCH_QUERY_LIMIT),
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

  // ── Finalizar un partido a mano ────────────────────────────────────────────
  // El scheduler abre y cierra listas por horario, pero el partido de verdad
  // termina cuando termina: sin esto había que esperar al timer para poder
  // cargar las estadísticas. Cualquier miembro del grupo puede finalizarlo
  // apenas se juega (misma rama de reglas que cargar el resultado, que exige
  // status == 'finished'). No toca el marcador: eso se carga después en
  // PostMatchPage, y el partido queda listo para recibirlo.
  async function finishMatch(matchId) {
    loading.value = true
    error.value = null
    try {
      await updateDoc(doc(db, 'matches', matchId), {
        scoreA: 0,
        scoreB: 0,
        status: MATCH_STATUS.FINISHED,
        finishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Borrar un partido (y sus subcolecciones) ───────────────────────────────
  // Para listas creadas por error o que nadie usó. Firestore no borra en
  // cascada: hay que limpiar a mano registrations/playerStats/mvpVotes, o
  // quedan documentos huérfanos que siguen apareciendo en las queries de
  // collectionGroup (por ejemplo el acumulador de stats).
  async function deleteMatch(matchId) {
    loading.value = true
    error.value = null
    try {
      for (const sub of ['registrations', 'playerStats', 'mvpVotes']) {
        const snap = await getDocs(collection(db, 'matches', matchId, sub))
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
      }
      // applications NO se borran acá a propósito: las reglas las bloquean
      // (`allow delete: if false`, igual que joinRequests) porque quedan como
      // registro histórico. Un match borrado deja sus applications huérfanas
      // — el cliente ya filtra esas filas (MyApplicationsCard). Si en algún
      // momento hace falta limpiarlas de Firestore, tendría que ser con el
      // Admin SDK (Cloud Function), no desde acá.
      await deleteDoc(doc(db, 'matches', matchId))
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  return {
    matches,
    publicMatches,
    finishedMatches,
    currentMatch,
    nextMatch,
    loading,
    error,
    subscribeToUpcoming,
    subscribeToGroupMatches,
    subscribeToPublicMatches,
    subscribeToFinished,
    subscribeToMatch,
    fetchMatch,
    createMatch,
    updateMatch,
    deleteMatch,
    saveMatchResult,
    finishMatch,
    toggleVenueReserved,
    setMatchPublic,
    stopListening,
    stopListeningPublic,
    stopListeningFinished,
    FORMAT_OPTIONS,
    MATCH_STATUS,
  }
}
