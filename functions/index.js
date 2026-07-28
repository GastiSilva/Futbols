// functions/index.js
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onDocumentUpdated, onDocumentWritten, onDocumentDeleted } = require('firebase-functions/v2/firestore')
const logger = require('firebase-functions/logger')
const admin = require('firebase-admin')

// Inicialización top-level requerida por firebase-admin v13+
admin.initializeApp()

const LOCATION = 'southamerica-east1'

// ── 1. Callable: programar apertura del partido ──────────────────────────────
exports.scheduleMatchOpenNotification = onCall(
  { region: LOCATION, invoker: 'public' },
  async (request) => {
    const { matchId, openAt, matchTitle } = request.data

    if (!matchId || !openAt || !matchTitle) {
      throw new HttpsError('invalid-argument', 'Faltan parámetros requeridos.')
    }

    await assertCanManageMatchNotifications(request.auth, matchId)

    const openAtDate = new Date(openAt)
    if (isNaN(openAtDate.getTime())) {
      throw new HttpsError('invalid-argument', 'openAt no es una fecha válida.')
    }

    const db = admin.firestore()

    // Grupo del partido (para el aviso anticipado a los OG). Puede no tener grupo.
    const matchSnap = await db.collection('matches').doc(matchId).get()
    const groupId = matchSnap.exists ? (matchSnap.data().groupId ?? null) : null

    // Programa el aviso anticipado a los OG del grupo (30 min antes de abrir).
    await enqueueOgEarlyNotify(db, { matchId, matchTitle, groupId, openAtDate })

    // Si ya pasó la hora de apertura, abrir el partido directamente
    if (openAtDate <= new Date()) {
      await db.collection('matches').doc(matchId).update({
        status: 'open',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      logger.info(`Partido abierto de inmediato: ${matchId}`)
      return { success: true, immediate: true }
    }

    // Encolar para procesamiento por el scheduler
    await db.collection('_matchOpenQueue').add({
      matchId,
      matchTitle,
      openAt: admin.firestore.Timestamp.fromDate(openAtDate),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      processed: false,
    })

    logger.info(`Apertura encolada: ${matchId} a ${openAtDate.toISOString()}`)
    return { success: true, immediate: false }
  },
)

// ── Helper: encolar aviso anticipado (30 min antes) a los OG del grupo ───────
async function enqueueOgEarlyNotify(db, { matchId, matchTitle, groupId, openAtDate }) {
  // Sin grupo no hay OG a quien avisar
  if (!groupId) return

  const ogNotifyAt = new Date(openAtDate.getTime() - 30 * 60 * 1000)

  // Si la ventana anticipada ya pasó, no tiene sentido programarla
  if (ogNotifyAt <= new Date()) return

  await db.collection('_matchOgNotifyQueue').add({
    matchId,
    matchTitle,
    groupId,
    notifyAt: admin.firestore.Timestamp.fromDate(ogNotifyAt),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    processed: false,
  })
  logger.info(`Aviso OG encolado: ${matchId} (grupo ${groupId}) a ${ogNotifyAt.toISOString()}`)
}

// ── Scheduled: cada minuto, enviar avisos anticipados a los OG ───────────────
exports.processMatchOgNotifyQueue = onSchedule(
  { region: LOCATION, schedule: 'every 1 minutes' },
  async () => {
    const now = admin.firestore.Timestamp.now()
    const db = admin.firestore()

    const snap = await db
      .collection('_matchOgNotifyQueue')
      .where('processed', '==', false)
      .where('notifyAt', '<=', now)
      .orderBy('notifyAt', 'asc')
      .get()

    if (snap.empty) return

    const writeBatch = db.batch()
    const toProcess = []

    snap.docs.forEach((docSnap) => {
      writeBatch.update(docSnap.ref, { processed: true })
      toProcess.push(docSnap.data())
    })

    await writeBatch.commit()

    for (const { matchId, matchTitle, groupId } of toProcess) {
      await sendFCMToGroupOGs(
        groupId,
        '🔥 Acceso anticipado',
        `Ya podés anotarte a "${matchTitle}" — 30 min antes que el resto.`,
        { matchId, type: 'match_og_early' },
      )
      logger.info(`Aviso OG enviado: ${matchId} (grupo ${groupId})`)
    }
  },
)

// ── 2. Scheduled: cada minuto, abrir partidos que llegaron a su hora ─────────
exports.processMatchOpenQueue = onSchedule(
  { region: LOCATION, schedule: 'every 1 minutes' },
  async () => {
    const now = admin.firestore.Timestamp.now()
    const db = admin.firestore()

    const snap = await db
      .collection('_matchOpenQueue')
      .where('processed', '==', false)
      .where('openAt', '<=', now)
      .orderBy('openAt', 'asc')
      .get()

    if (snap.empty) return

    const writeBatch = db.batch()
    const toProcess = []

    snap.docs.forEach((docSnap) => {
      writeBatch.update(docSnap.ref, { processed: true })
      toProcess.push(docSnap.data())
    })

    await writeBatch.commit()

    for (const { matchId, matchTitle } of toProcess) {
      await db.collection('matches').doc(matchId).update({
        status: 'open',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      logger.info(`Partido abierto por scheduler: ${matchId}`)

      // Encolar notificación (mismo patrón que recordatorios)
      await db.collection('_matchOpenNotificationQueue').add({
        matchId,
        matchTitle,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        processed: false,
      })
    }
  },
)

// ── 3. Callable: programar recordatorio ──────────────────────────────────────
exports.scheduleMatchReminderNotification = onCall(
  { region: LOCATION, invoker: 'public' },
  async (request) => {
    const { matchId, notifyAt, matchTitle, openAt } = request.data

    if (!matchId || !notifyAt || !matchTitle) {
      throw new HttpsError('invalid-argument', 'Faltan parámetros requeridos.')
    }

    await assertCanManageMatchNotifications(request.auth, matchId)

    const notifyAtDate = new Date(notifyAt)
    if (isNaN(notifyAtDate.getTime())) {
      throw new HttpsError('invalid-argument', 'notifyAt no es una fecha válida.')
    }

    if (notifyAtDate <= new Date()) {
      return { success: true, skipped: true }
    }

    await admin.firestore().collection('_matchReminderQueue').add({
      matchId,
      matchTitle,
      openAt: openAt ?? null,
      notifyAt: admin.firestore.Timestamp.fromDate(notifyAtDate),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      processed: false,
    })

    logger.info(`Recordatorio encolado: ${matchId} a ${notifyAtDate.toISOString()}`)
    return { success: true }
  },
)

// ── 4. Scheduled: cada minuto, enviar recordatorios ──────────────────────────
exports.processMatchReminderQueue = onSchedule(
  { region: LOCATION, schedule: 'every 1 minutes' },
  async () => {
    const now = admin.firestore.Timestamp.now()
    const db = admin.firestore()

    const snap = await db
      .collection('_matchReminderQueue')
      .where('processed', '==', false)
      .where('notifyAt', '<=', now)
      .orderBy('notifyAt', 'asc')
      .get()

    if (snap.empty) return

    const writeBatch = db.batch()
    const toProcess = []

    snap.docs.forEach((docSnap) => {
      writeBatch.update(docSnap.ref, { processed: true })
      toProcess.push(docSnap.data())
    })

    await writeBatch.commit()

    for (const { matchId, matchTitle, openAt } of toProcess) {
      const timeStr = openAt
        ? new Date(openAt).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })
        : 'en breve'
      const alreadyRegistered = await getRegisteredUserIds(matchId)
      await sendFCMToAllUsers(
        '⏰ ¡La lista abre pronto!',
        `La lista para "${matchTitle}" se abre a las ${timeStr}. ¡Anotáte!`,
        { matchId, type: 'match_reminder' },
        alreadyRegistered,
      )
      logger.info(`Recordatorio enviado por scheduler: ${matchId}`)
    }
  },
)

// ── 5. Scheduled: procesar cola de notificaciones de apertura ────────────────
exports.processMatchOpenNotificationQueue = onSchedule(
  { region: LOCATION, schedule: 'every 1 minutes' },
  async () => {
    const db = admin.firestore()

    const snap = await db
      .collection('_matchOpenNotificationQueue')
      .where('processed', '==', false)
      .get()

    if (snap.empty) return

    const writeBatch = db.batch()
    const toProcess = []

    snap.docs.forEach((docSnap) => {
      writeBatch.update(docSnap.ref, { processed: true })
      toProcess.push(docSnap.data())
    })

    await writeBatch.commit()

    for (const { matchId, matchTitle } of toProcess) {
      const alreadyRegistered = await getRegisteredUserIds(matchId)
      await sendFCMToAllUsers(
        '⚽ ¡Se abrió la lista!',
        `Ya podés anotarte al partido: "${matchTitle}"`,
        { matchId, type: 'match_open' },
        alreadyRegistered,
      )
      logger.info(`Notificación de apertura enviada: ${matchId}`)
    }
  },
)

// ── 6. Callable: asignar claim admin ─────────────────────────────────────────
exports.setAdminClaim = onCall(
  { region: LOCATION, invoker: 'public' },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError('permission-denied', 'Solo admins pueden asignar roles.')
    }

    const { targetUid, isAdmin } = request.data
    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'targetUid requerido.')
    }

    await admin.auth().setCustomUserClaims(targetUid, { admin: !!isAdmin })
    logger.info(`Claim admin ${isAdmin} asignado a ${targetUid}`)
    return { success: true }
  },
)

// ── 7. Callable: asignar rol a un usuario ────────────────────────────────────
exports.setUserRole = onCall(
  { region: LOCATION, invoker: 'public' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Usuario no autenticado.')
    }
    if (!request.auth?.token?.admin) {
      throw new HttpsError('permission-denied', 'Solo administradores pueden cambiar roles.')
    }

    const { targetUid, role } = request.data
    const validRoles = ['admin', 'og', 'player']

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'targetUid requerido.')
    }
    if (!role || !validRoles.includes(role)) {
      throw new HttpsError('invalid-argument', `Rol inválido. Debe ser: ${validRoles.join(', ')}.`)
    }

    await admin.auth().setCustomUserClaims(targetUid, { admin: role === 'admin' })
    await admin.firestore().collection('users').doc(targetUid).update({
      role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    return { success: true, message: `Rol actualizado a '${role}'` }
  },
)


// ── 8. Trigger: notificar cuando se abre un partido
exports.onMatchOpened = onDocumentUpdated(
  { region: LOCATION, document: 'matches/{matchId}' },
  async (event) => {
    try {
      const before = event.data.before.data()
      const after = event.data.after.data()

      if (!after) {
        logger.warn('onMatchOpened: after data es null/undefined')
        return
      }

      const beforeStatus = before?.status
      const afterStatus = after?.status

      if (beforeStatus === 'open') return
      if (afterStatus !== 'open') return

      const matchId = event.params.matchId
      const title = after.title || 'un partido'

      logger.info(`onMatchOpened: Enviando notificación para ${matchId}`)
      const alreadyRegistered = await getRegisteredUserIds(matchId)
      await sendFCMToAllUsers(
        '⚽ ¡Se abrió la lista!',
        'Ya podés anotarte al partido: ' + title,
        { matchId: matchId, type: 'match_open' },
        alreadyRegistered,
      )
      logger.info(`onMatchOpened: Notificación enviada para ${matchId}`)
    } catch (error) {
      logger.error(`onMatchOpened: Error en trigger`, error)
    }
  },
)

// ── 10. Trigger: acumular stats de jugadores por DIFERENCIA ──────────────────
// Se dispara al crear/editar/borrar matches/{matchId}/playerStats/{userId}.
// Actualiza users/{userId}.stats y statsByGroup por la diferencia entre el
// valor anterior y el nuevo → idempotente (re-guardar no duplica).
exports.onPlayerStatsWritten = onDocumentWritten(
  { region: LOCATION, document: 'matches/{matchId}/playerStats/{userId}' },
  async (event) => {
    try {
      const before = event.data?.before?.exists ? event.data.before.data() : null
      const after = event.data?.after?.exists ? event.data.after.data() : null

      const data = after ?? before
      const userId = data?.userId
      // Invitados sin cuenta (userId null) no acumulan
      if (!userId) return

      const dGoals = (after?.goals ?? 0) - (before?.goals ?? 0)
      const dAssists = (after?.assists ?? 0) - (before?.assists ?? 0)
      const dPlayed = (after ? 1 : 0) - (before ? 1 : 0)
      const dMvps = (after?.mvp === true ? 1 : 0) - (before?.mvp === true ? 1 : 0)
      // Resultado del jugador (W/E/L) guardado en la fila → contadores por diferencia
      const countRes = (row, code) => (row?.result === code ? 1 : 0)
      const dWins = countRes(after, 'W') - countRes(before, 'W')
      const dDraws = countRes(after, 'E') - countRes(before, 'E')
      const dLosses = countRes(after, 'L') - countRes(before, 'L')

      if (
        dGoals === 0 && dAssists === 0 && dPlayed === 0 && dMvps === 0 &&
        dWins === 0 && dDraws === 0 && dLosses === 0
      ) {
        return
      }

      const groupId = after?.groupId ?? before?.groupId ?? null
      const inc = admin.firestore.FieldValue.increment

      const updates = {
        'stats.goals': inc(dGoals),
        'stats.assists': inc(dAssists),
        'stats.matchesPlayed': inc(dPlayed),
        'stats.mvps': inc(dMvps),
        'stats.wins': inc(dWins),
        'stats.draws': inc(dDraws),
        'stats.losses': inc(dLosses),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      if (groupId) {
        updates[`statsByGroup.${groupId}.goals`] = inc(dGoals)
        updates[`statsByGroup.${groupId}.assists`] = inc(dAssists)
        updates[`statsByGroup.${groupId}.matchesPlayed`] = inc(dPlayed)
        updates[`statsByGroup.${groupId}.mvps`] = inc(dMvps)
        updates[`statsByGroup.${groupId}.wins`] = inc(dWins)
        updates[`statsByGroup.${groupId}.draws`] = inc(dDraws)
        updates[`statsByGroup.${groupId}.losses`] = inc(dLosses)
      }

      // update() (no set/merge): las claves con punto son PATHS anidados.
      // increment() inicializa el campo si no existía. Los users siempre existen.
      await admin.firestore().collection('users').doc(userId).update(updates)
      logger.info(`Stats acumuladas para ${userId} (Δg=${dGoals}, Δa=${dAssists}, Δp=${dPlayed}, Δmvp=${dMvps})`)
    } catch (error) {
      logger.error('onPlayerStatsWritten: error', error)
    }
  },
)

// ── 12. Callable: RECALCULAR todas las estadísticas desde cero (solo admin) ──
// El acumulador onPlayerStatsWritten suma por DIFERENCIA, así que los
// resultados cargados cuando la función no estaba desplegada quedaron sin
// acumular (y re-guardarlos da diferencia 0). Esta función reconstruye
// stats/statsByGroup de TODOS los usuarios a partir de los playerStats
// guardados en los partidos. Es idempotente: se puede correr las veces
// que haga falta.
exports.recalcAllStats = onCall(
  { region: LOCATION, invoker: 'public' },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError('permission-denied', 'Solo admins pueden recalcular estadísticas.')
    }

    const db = admin.firestore()
    const zero = () => ({
      goals: 0, assists: 0, matchesPlayed: 0, mvps: 0, wins: 0, draws: 0, losses: 0,
    })

    // 1. Agregar todos los playerStats de todos los partidos
    const statsSnap = await db.collectionGroup('playerStats').get()
    const byUser = new Map()

    statsSnap.docs.forEach((d) => {
      const s = d.data()
      if (!s.userId) return // invitados sin cuenta no acumulan

      const agg = byUser.get(s.userId) ?? { stats: zero(), byGroup: {} }
      const apply = (t) => {
        t.goals += Number(s.goals) || 0
        t.assists += Number(s.assists) || 0
        t.matchesPlayed += 1
        t.mvps += s.mvp === true ? 1 : 0
        t.wins += s.result === 'W' ? 1 : 0
        t.draws += s.result === 'E' ? 1 : 0
        t.losses += s.result === 'L' ? 1 : 0
      }
      apply(agg.stats)
      if (s.groupId) {
        agg.byGroup[s.groupId] = agg.byGroup[s.groupId] ?? zero()
        apply(agg.byGroup[s.groupId])
      }
      byUser.set(s.userId, agg)
    })

    // 2. Sobrescribir los acumuladores de TODOS los usuarios (los que no
    //    tienen stats quedan en cero, corrigiendo restos viejos)
    const usersSnap = await db.collection('users').get()
    let batch = db.batch()
    let ops = 0

    for (const userDoc of usersSnap.docs) {
      const agg = byUser.get(userDoc.id) ?? { stats: zero(), byGroup: {} }
      batch.update(userDoc.ref, {
        stats: agg.stats,
        statsByGroup: agg.byGroup,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      ops += 1
      if (ops >= 450) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }
    if (ops > 0) await batch.commit()

    logger.info(
      `recalcAllStats: ${statsSnap.size} playerStats → ${usersSnap.size} usuarios actualizados`,
    )
    return { success: true, playerStats: statsSnap.size, users: usersSnap.size }
  },
)

// ── 11. Trigger: al borrarse una inscripción, re-numerar y promover suplentes ─
// Cuando alguien se baja (o lo sacan) de un partido:
//  1. Re-numera las posiciones de todas las inscripciones (1..N, sin huecos).
//  2. Recalcula isOnWaitlist (position > maxPlayers).
//  3. Si un suplente pasó a titular, le manda una notificación FCM.
exports.onRegistrationDeleted = onDocumentDeleted(
  { region: LOCATION, document: 'matches/{matchId}/registrations/{regId}' },
  async (event) => {
    try {
      const { matchId } = event.params
      const db = admin.firestore()
      const matchRef = db.collection('matches').doc(matchId)

      // Datos de la inscripción que se borró (para avisar quién se bajó)
      const deletedReg = event.data?.data() ?? {}
      const leaverName = deletedReg.displayName || deletedReg.guestName || 'Alguien'
      const leaverUserId = deletedReg.userId ?? null

      const info = await db.runTransaction(async (tx) => {
        const matchSnap = await tx.get(matchRef)
        if (!matchSnap.exists) return null

        const match = matchSnap.data()
        // En partidos terminados no tiene sentido promover ni avisar
        if (match.status === 'finished') return null

        const maxPlayers = match.maxPlayers ?? 0
        const regsSnap = await tx.get(
          matchRef.collection('registrations').orderBy('position', 'asc'),
        )

        const promotedUsers = []
        const registeredUserIds = []
        let pos = 0
        regsSnap.docs.forEach((docSnap) => {
          pos += 1
          const reg = docSnap.data()
          const isOnWaitlist = pos > maxPlayers

          if (reg.position !== pos || reg.isOnWaitlist !== isOnWaitlist) {
            tx.update(docSnap.ref, { position: pos, isOnWaitlist })
          }
          if (reg.userId) registeredUserIds.push(reg.userId)

          // Estaba en lista de espera y ahora entra como titular
          if (reg.isOnWaitlist === true && !isOnWaitlist && reg.userId) {
            promotedUsers.push(reg.userId)
          }
        })

        return {
          matchTitle: match.title ?? 'un partido',
          promoted: promotedUsers,
          createdBy: match.createdBy ?? null,
          status: match.status ?? null,
          // ¿Quedó un lugar libre de verdad? (lista abierta y cupo sin llenar,
          // es decir sin suplentes que tapen el hueco)
          spotOpen: match.status === 'open' && regsSnap.size < maxPlayers,
          registeredUserIds,
        }
      })

      if (!info) return
      const { matchTitle, promoted, createdBy, spotOpen, registeredUserIds } = info

      // 1) Suplentes que ascendieron a titular: aviso personal
      for (const userId of promoted) {
        await sendFCMToUser(
          userId,
          '🎉 ¡Entraste a la lista!',
          `Se liberó un lugar en "${matchTitle}" y pasaste de suplente a titular.`,
          { matchId, type: 'waitlist_promoted' },
        )
        logger.info(`Suplente promovido y notificado: ${userId} (partido ${matchId})`)
      }

      if (promoted.length === 0 && spotOpen) {
        // 2) No había suplentes y quedó lugar → avisar a TODOS (menos los anotados)
        await sendFCMToAllUsers(
          '⚽ ¡Se liberó un lugar!',
          `Se bajó ${leaverName} de "${matchTitle}". ¡Hay lugar, anotáte!`,
          { matchId, type: 'spot_available' },
          registeredUserIds,
        )
        logger.info(`Lugar libre en ${matchId}: broadcast a todos (se bajó ${leaverName})`)
      } else if (createdBy && createdBy !== leaverUserId) {
        // 3) El lugar se tapó con un suplente (o la lista no está abierta):
        //    solo avisamos al organizador que alguien se bajó.
        await sendFCMToUser(
          createdBy,
          '📋 Se bajó un jugador',
          `${leaverName} se bajó de "${matchTitle}".`,
          { matchId, type: 'registration_left' },
        )
        logger.info(`Organizador ${createdBy} notificado: se bajó ${leaverName} (${matchId})`)
      }
    } catch (error) {
      logger.error('onRegistrationDeleted: error', error)
    }
  },
)

// ── 13. Trigger: recalcular el promedio de estrellas de la descripción ───────
// Se dispara al crear/editar/borrar users/{userId}/descriptionRatings/{raterId}.
// Recuenta todo el subcolección (es chica, un rating por persona del grupo) y
// publica el agregado en users/{userId}/private/descriptionStars, el único
// lugar que el dueño del perfil puede leer (las reglas no dejan ver los votos
// individuales ni de quién son).
exports.onDescriptionRatingWritten = onDocumentWritten(
  { region: LOCATION, document: 'users/{userId}/descriptionRatings/{raterId}' },
  async (event) => {
    try {
      const { userId } = event.params
      const db = admin.firestore()

      const snap = await db.collection('users').doc(userId).collection('descriptionRatings').get()
      const count = snap.size
      const avg = count === 0
        ? 0
        : snap.docs.reduce((sum, d) => sum + (d.data().stars ?? 0), 0) / count

      await db.collection('users').doc(userId).collection('private').doc('descriptionStars').set({
        avg,
        count,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      logger.info(`Estrellas de descripción recalculadas para ${userId}: avg=${avg} count=${count}`)
    } catch (error) {
      logger.error('onDescriptionRatingWritten: error', error)
    }
  },
)

// ── 14. Trigger: si cambia la descripción, resetear sus calificaciones ───────
// Los votos de "esta descripción es real" quedan obsoletos apenas el texto
// cambia — se borran todos y el promedio vuelve a cero. Se dispara en CADA
// update de users/{userId} (fcmToken, stats, etc.), por eso compara
// explícitamente before/after.description antes de hacer nada.
exports.onUserDescriptionChanged = onDocumentUpdated(
  { region: LOCATION, document: 'users/{userId}' },
  async (event) => {
    try {
      const before = event.data.before.data()
      const after = event.data.after.data()
      if ((before?.description ?? '') === (after?.description ?? '')) return

      const { userId } = event.params
      const db = admin.firestore()
      const userRef = db.collection('users').doc(userId)

      const ratingsSnap = await userRef.collection('descriptionRatings').get()
      if (!ratingsSnap.empty) {
        const batch = db.batch()
        ratingsSnap.docs.forEach((d) => batch.delete(d.ref))
        await batch.commit()
      }

      await userRef.collection('private').doc('descriptionStars').set({
        avg: 0,
        count: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      logger.info(`Descripción cambiada: estrellas reseteadas para ${userId}`)
    } catch (error) {
      logger.error('onUserDescriptionChanged: error', error)
    }
  },
)

// ── Helper: ¿el caller es owner/admin del grupo del partido? ─────────────────
async function isCallerGroupManagerOfMatch(uid, matchId) {
  const db = admin.firestore()
  const matchSnap = await db.collection('matches').doc(matchId).get()
  if (!matchSnap.exists) return false
  const groupId = matchSnap.data().groupId
  if (!groupId) return false
  const memberSnap = await db
    .collection('groups').doc(groupId)
    .collection('members').doc(uid)
    .get()
  if (!memberSnap.exists) return false
  return ['owner', 'admin'].includes(memberSnap.data().role)
}

// Programar notificaciones lo puede hacer un admin global o el owner/admin del
// grupo al que pertenece el partido.
async function assertCanManageMatchNotifications(auth, matchId) {
  if (auth?.token?.admin === true) return
  const uid = auth?.uid
  if (uid && (await isCallerGroupManagerOfMatch(uid, matchId))) return
  throw new HttpsError(
    'permission-denied',
    'No tenés permiso para programar notificaciones de este partido.',
  )
}

// ── 9a. Helper: recolectar tokens FCM de un conjunto de documentos de usuario
function collectTokensFromUserDocs(userDocs) {
  const tokenSet = new Set()
  userDocs.forEach((d) => {
    const u = d.data()
    if (u.fcmToken) tokenSet.add(u.fcmToken)
    ;(u.fcmTokens ?? []).forEach((t) => t && tokenSet.add(t))
  })
  return [...tokenSet]
}

// ── 9b. Helper: despachar una notificación a una lista de tokens (en lotes)
async function dispatchFCM(tokens, title, body, data) {
  if (tokens.length === 0) return []

  const messaging = admin.messaging()
  const invalidTokens = []
  const BATCH_SIZE = 500

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE)
    const message = {
      notification: { title, body },
      data,
      webpush: {
        notification: {
          icon: '/icons/brazuca.png',
          badge: '/icons/icon-128x128.png',
          requireInteraction: true,
        },
      },
      tokens: batch,
    }
    const response = await messaging.sendEachForMulticast(message)
    response.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(batch[idx])
        }
        logger.warn('FCM error', { code })
      }
    })
  }

  return invalidTokens
}

// ── 9c. Helper: enviar FCM a los miembros con ACCESO ANTICIPADO de un grupo ──
// Acceso anticipado = OG (og == true) u owner/admin del grupo.
async function sendFCMToGroupOGs(groupId, title, body, data) {
  if (!groupId) return
  const db = admin.firestore()
  const membersCol = db.collection('groups').doc(groupId).collection('members')

  const [ogSnap, managersSnap] = await Promise.all([
    membersCol.where('og', '==', true).get(),
    membersCol.where('role', 'in', ['owner', 'admin']).get(),
  ])

  const userIdSet = new Set()
  ogSnap.docs.forEach((d) => d.data().userId && userIdSet.add(d.data().userId))
  managersSnap.docs.forEach((d) => d.data().userId && userIdSet.add(d.data().userId))
  const earlyUserIds = [...userIdSet]

  logger.info(`[FCM] sendFCMToGroupOGs(${groupId}) → acceso anticipado: ${earlyUserIds.length}`)
  if (earlyUserIds.length === 0) return

  // Firestore limita `in` a 30 elementos → leer en tandas
  const userDocs = []
  for (let i = 0; i < earlyUserIds.length; i += 30) {
    const chunk = earlyUserIds.slice(i, i + 30)
    const usersSnap = await db
      .collection('users')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .select('fcmToken', 'fcmTokens')
      .get()
    userDocs.push(...usersSnap.docs)
  }

  const tokens = collectTokensFromUserDocs(userDocs)
  await dispatchFCM(tokens, title, body, data)
}

// ── 9d. Helper: enviar FCM a UN usuario puntual ──────────────────────────────
async function sendFCMToUser(userId, title, body, data) {
  if (!userId) return
  const db = admin.firestore()
  const userSnap = await db.collection('users').doc(userId).get()
  if (!userSnap.exists) return

  const tokens = collectTokensFromUserDocs([userSnap])
  logger.info(`[FCM] sendFCMToUser(${userId}) → tokens: ${tokens.length}`)
  if (tokens.length === 0) return

  await dispatchFCM(tokens, title, body, data)
}

// ── 9e. Helper: IDs de usuarios ya anotados a un partido ─────────────────────
// (los invitados/guests tienen userId === null, así que quedan afuera solos)
async function getRegisteredUserIds(matchId) {
  if (!matchId) return []
  const db = admin.firestore()
  const snap = await db
    .collection('matches')
    .doc(matchId)
    .collection('registrations')
    .select('userId')
    .get()
  const ids = []
  snap.docs.forEach((d) => {
    const uid = d.data().userId
    if (uid) ids.push(uid)
  })
  return ids
}

// ── 9. Helper: enviar FCM a todos los usuarios
// `excludeUserIds`: uids que NO deben recibir la notificación (p. ej. ya anotados)
async function sendFCMToAllUsers(title, body, data, excludeUserIds = []) {
  const db = admin.firestore()
  const excludeSet = new Set(excludeUserIds)
  const usersSnap = await db.collection('users').select('fcmToken', 'fcmTokens').get()
  const includedDocs = usersSnap.docs.filter((d) => !excludeSet.has(d.id))
  const tokens = collectTokensFromUserDocs(includedDocs)
  logger.info(
    `[FCM] sendFCMToAllUsers → tokens: ${tokens.length} (excluidos ${excludeSet.size} usuarios)`,
  )
  if (tokens.length === 0) return

  const invalidTokens = await dispatchFCM(tokens, title, body, data)

  if (invalidTokens.length > 0) {
    const invalidSet = new Set(invalidTokens)
    const allUsersSnap = await db.collection('users').get()
    const cleanupBatch = db.batch()
    allUsersSnap.docs.forEach((d) => {
      const u = d.data()
      const updates = {}
      if (u.fcmToken && invalidSet.has(u.fcmToken)) {
        updates.fcmToken = admin.firestore.FieldValue.delete()
      }
      const badTokens = (u.fcmTokens ?? []).filter((t) => invalidSet.has(t))
      if (badTokens.length > 0) {
        updates.fcmTokens = admin.firestore.FieldValue.arrayRemove(...badTokens)
      }
      if (Object.keys(updates).length > 0) {
        cleanupBatch.update(d.ref, updates)
      }
    })
    await cleanupBatch.commit()
    logger.info(`Tokens invalidos eliminados: ${invalidTokens.length}`)
  }
}