// functions/index.js
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onDocumentUpdated, onDocumentWritten } = require('firebase-functions/v2/firestore')
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
      await sendFCMToAllUsers(
        '⏰ ¡La lista abre pronto!',
        `La lista para "${matchTitle}" se abre a las ${timeStr}. ¡Anotáte!`,
        { matchId, type: 'match_reminder' },
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
      await sendFCMToAllUsers(
        '⚽ ¡Se abrió la lista!',
        `Ya podés anotarte al partido: "${matchTitle}"`,
        { matchId, type: 'match_open' },
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
      await sendFCMToAllUsers(
        '⚽ ¡Se abrió la lista!',
        'Ya podés anotarte al partido: ' + title,
        { matchId: matchId, type: 'match_open' },
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

      if (dGoals === 0 && dAssists === 0 && dPlayed === 0) return

      const groupId = after?.groupId ?? before?.groupId ?? null
      const inc = admin.firestore.FieldValue.increment

      const updates = {
        'stats.goals': inc(dGoals),
        'stats.assists': inc(dAssists),
        'stats.matchesPlayed': inc(dPlayed),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      if (groupId) {
        updates[`statsByGroup.${groupId}.goals`] = inc(dGoals)
        updates[`statsByGroup.${groupId}.assists`] = inc(dAssists)
        updates[`statsByGroup.${groupId}.matchesPlayed`] = inc(dPlayed)
      }

      // update() (no set/merge): las claves con punto son PATHS anidados.
      // increment() inicializa el campo si no existía. Los users siempre existen.
      await admin.firestore().collection('users').doc(userId).update(updates)
      logger.info(`Stats acumuladas para ${userId} (Δg=${dGoals}, Δa=${dAssists}, Δp=${dPlayed})`)
    } catch (error) {
      logger.error('onPlayerStatsWritten: error', error)
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
          icon: '/icons/icon-192x192.png',
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

// ── 9c. Helper: enviar FCM solo a los OG de un grupo ─────────────────────────
async function sendFCMToGroupOGs(groupId, title, body, data) {
  if (!groupId) return
  const db = admin.firestore()

  const ogMembersSnap = await db
    .collection('groups').doc(groupId)
    .collection('members')
    .where('og', '==', true)
    .get()

  const ogUserIds = ogMembersSnap.docs.map((d) => d.data().userId).filter(Boolean)
  logger.info(`[FCM] sendFCMToGroupOGs(${groupId}) → OGs: ${ogUserIds.length}`)
  if (ogUserIds.length === 0) return

  // Firestore limita `in` a 30 elementos → leer en tandas
  const userDocs = []
  for (let i = 0; i < ogUserIds.length; i += 30) {
    const chunk = ogUserIds.slice(i, i + 30)
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

// ── 9. Helper: enviar FCM a todos los usuarios
async function sendFCMToAllUsers(title, body, data) {
  const db = admin.firestore()
  const usersSnap = await db.collection('users').select('fcmToken', 'fcmTokens').get()
  const tokens = collectTokensFromUserDocs(usersSnap.docs)
  logger.info(`[FCM] sendFCMToAllUsers → tokens encontrados: ${tokens.length}`)
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