// functions/index.js
// ─────────────────────────────────────────────────────────────────────────────
//  Firebase Cloud Functions — Node.js 20
// ─────────────────────────────────────────────────────────────────────────────
//
//  Funciones incluidas:
//  1. scheduleMatchOpenNotification  → Callable: programa una tarea con Cloud Tasks
//     que enviará una notificación FCM cuando se abra la lista del partido.
//  2. sendMatchOpenNotification      → HTTP trigger interno (invocado por Cloud Tasks)
//     que envía el FCM multicast a todos los tokens registrados.
//  3. onUserCreated                  → Auth trigger: inicializa el documento Firestore
//     del usuario al registrarse por primera vez.
//  4. setAdminClaim                  → Callable (solo admins): asigna custom claim admin.
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
// const { onSchedule } = require('firebase-functions/v2/scheduler')
const { beforeUserCreated } = require('firebase-functions/v2/identity')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const { getAuth } = require('firebase-admin/auth')
const { initializeApp } = require('firebase-admin/app')
const { CloudTasksClient } = require('@google-cloud/tasks')
const logger = require('firebase-functions/logger')

initializeApp()

const db = getFirestore()
const PROJECT_ID = process.env.GCLOUD_PROJECT
const LOCATION = 'us-southamerica-east1'
const QUEUE_NAME = 'match-notifications'

// ── 1. Callable: programar notificación de apertura ──────────────────────────
/**
 * Recibe { matchId, openAt (ISO string), matchTitle } desde el cliente.
 * Crea una tarea en Cloud Tasks que se ejecutará en el momento de `openAt`.
 */
exports.scheduleMatchOpenNotification = onCall(
  { region: LOCATION },
  async (request) => {
    // Solo admins pueden programar notificaciones
    if (!request.auth?.token?.admin) {
      throw new HttpsError('permission-denied', 'Solo administradores pueden programar notificaciones.')
    }

    const { matchId, openAt, matchTitle } = request.data

    if (!matchId || !openAt || !matchTitle) {
      throw new HttpsError('invalid-argument', 'Faltan parámetros requeridos.')
    }

    const openAtDate = new Date(openAt)
    if (isNaN(openAtDate.getTime())) {
      throw new HttpsError('invalid-argument', 'openAt no es una fecha válida.')
    }

    const client = new CloudTasksClient()
    const parent = client.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME)

    // URL de la Cloud Function HTTP que enviará el FCM
    const functionUrl = `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/sendMatchOpenNotification`

    const task = {
      httpRequest: {
        httpMethod: 'POST',
        url: functionUrl,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ matchId, matchTitle })).toString('base64'),
        oidcToken: {
          serviceAccountEmail: `${PROJECT_ID}@appspot.gserviceaccount.com`,
        },
      },
      scheduleTime: {
        seconds: Math.floor(openAtDate.getTime() / 1000),
      },
    }

    const [response] = await client.createTask({ parent, task })
    logger.info(`Tarea programada: ${response.name}`, { matchId })

    // Guarda el nombre de la tarea en el partido para poder cancelarla si es necesario
    await db.collection('matches').doc(matchId).update({
      cloudTaskName: response.name,
      updatedAt: FieldValue.serverTimestamp(),
    })

    return { success: true, taskName: response.name }
  },
)

// ── 2. HTTP trigger interno: enviar FCM multicast ────────────────────────────
/**
 * Invocado por Cloud Tasks en el momento de apertura del partido.
 * Consulta todos los fcmTokens de la colección 'users' y envía
 * una notificación push por lotes (FCM permite hasta 500 por llamada).
 */
exports.sendMatchOpenNotification = onRequest(
  { region: LOCATION },
  async (req, res) => {
    try {
      const { matchId, matchTitle } = req.body

      if (!matchId || !matchTitle) {
        res.status(400).json({ error: 'Parámetros faltantes' })
        return
      }

      // Actualiza el estado del partido a 'open'
      await db.collection('matches').doc(matchId).update({
        status: 'open',
        updatedAt: FieldValue.serverTimestamp(),
      })

      // Recolecta todos los tokens FCM válidos
      const usersSnap = await db
        .collection('users')
        .where('fcmToken', '!=', null)
        .select('fcmToken')
        .get()

      const tokens = usersSnap.docs
        .map((d) => d.data().fcmToken)
        .filter(Boolean)

      if (tokens.length === 0) {
        logger.info('No hay tokens FCM registrados.', { matchId })
        res.json({ sent: 0 })
        return
      }

      // FCM permite máximo 500 tokens por mensaje multicast
      const BATCH_SIZE = 500
      const messaging = getMessaging()
      let totalSent = 0
      let totalFailed = 0
      const invalidTokens = []

      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE)

        const message = {
          notification: {
            title: '⚽ ¡Se abrió la lista!',
            body: `Ya podés anotarte al partido: ${matchTitle}`,
          },
          data: {
            matchId,
            type: 'match_open',
          },
          webpush: {
            notification: {
              icon: '/icons/icon-192x192.png',
              badge: '/icons/badge-72x72.png',
              requireInteraction: true,
            },
            fcmOptions: {
              link: `/partidos/${matchId}`,
            },
          },
          tokens: batch,
        }

        const response = await messaging.sendEachForMulticast(message)
        totalSent += response.successCount
        totalFailed += response.failureCount

        // Identifica tokens inválidos para limpiarlos
        response.responses.forEach((r, idx) => {
          if (!r.success) {
            const code = r.error?.code
            if (
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/registration-token-not-registered'
            ) {
              invalidTokens.push(batch[idx])
            }
            logger.warn('FCM error en token', { code, token: batch[idx].slice(0, 20) })
          }
        })
      }

      // Limpia tokens inválidos de Firestore (evita acumulación de basura)
      if (invalidTokens.length > 0) {
        const cleanupBatch = db.batch()
        const invalidSnap = await db
          .collection('users')
          .where('fcmToken', 'in', invalidTokens.slice(0, 30))
          .get()
        invalidSnap.forEach((d) => {
          cleanupBatch.update(d.ref, { fcmToken: FieldValue.delete() })
        })
        await cleanupBatch.commit()
        logger.info(`Tokens inválidos eliminados: ${invalidTokens.length}`)
      }

      logger.info(`Notificaciones enviadas: ${totalSent}, fallidas: ${totalFailed}`, { matchId })
      res.json({ sent: totalSent, failed: totalFailed })
    } catch (err) {
      logger.error('Error enviando notificaciones FCM:', err)
      res.status(500).json({ error: err.message })
    }
  },
)

// ── 3. Auth trigger: inicializar perfil en Firestore ─────────────────────────
exports.onUserCreated = beforeUserCreated(async (event) => {
  const user = event.data
  // Solo permite login con Google (bloquea email/password, etc.)
  if (!user.providerData?.some((p) => p.providerId === 'google.com')) {
    throw new HttpsError('permission-denied', 'Solo se permite autenticación con Google.')
  }
})

// ── 4. Callable: asignar rol admin ────────────────────────────────────────────
/**
 * Solo puede ser invocado por un admin existente.
 * Uso: desde la consola de Firebase o un script de inicialización.
 */
exports.setAdminClaim = onCall(
  { region: LOCATION },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError('permission-denied', 'Solo admins pueden asignar roles.')
    }

    const { targetUid, isAdmin } = request.data
    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'targetUid requerido.')
    }

    await getAuth().setCustomUserClaims(targetUid, { admin: !!isAdmin })
    logger.info(`Claim admin ${isAdmin} asignado a ${targetUid}`)

    return { success: true }
  },
)

// ── 5. Callable: asignar rol a un usuario ─────────────────────────────────────
/**
 * Permite a un admin cambiar el rol de cualquier usuario.
 * Roles válidos: 'admin', 'og', 'player'
 * Si se asigna 'admin', también se establece el custom claim.
 * Si se quita 'admin', se elimina el custom claim.
 */
exports.setUserRole = onCall(
  { region: LOCATION },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError('permission-denied', 'Solo administradores pueden cambiar roles.')
    }

    const { targetUid, role } = request.data
    const validRoles = ['admin', 'og', 'player']

    if (!targetUid) {
      throw new HttpsError('invalid-argument', 'targetUid requerido.')
    }
    if (!validRoles.includes(role)) {
      throw new HttpsError('invalid-argument', `Rol inválido. Debe ser: ${validRoles.join(', ')}.`)
    }

    // Actualiza el custom claim según el nuevo rol
    const isAdminRole = role === 'admin'
    await getAuth().setCustomUserClaims(targetUid, { admin: isAdminRole })

    // Actualiza el campo role en Firestore
    await db.collection('users').doc(targetUid).update({
      role,
      updatedAt: FieldValue.serverTimestamp(),
    })

    logger.info(`Rol '${role}' asignado al usuario ${targetUid}`)
    return { success: true }
  },
)

// ── 6. Callable: programar notificación recordatorio ─────────────────────────
/**
 * Programa una tarea que enviará una notificación recordatorio
 * antes de que se abra la lista del partido.
 */
exports.scheduleMatchReminderNotification = onCall(
  { region: LOCATION },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError('permission-denied', 'Solo administradores pueden programar notificaciones.')
    }

    const { matchId, notifyAt, matchTitle } = request.data

    if (!matchId || !notifyAt || !matchTitle) {
      throw new HttpsError('invalid-argument', 'Faltan parámetros requeridos.')
    }

    const notifyAtDate = new Date(notifyAt)
    if (isNaN(notifyAtDate.getTime())) {
      throw new HttpsError('invalid-argument', 'notifyAt no es una fecha válida.')
    }

    // Si la fecha ya pasó, no programar
    if (notifyAtDate <= new Date()) {
      return { success: true, skipped: true }
    }

    const client = new CloudTasksClient()
    const parent = client.queuePath(PROJECT_ID, LOCATION, QUEUE_NAME)

    const functionUrl = `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/sendMatchReminderNotification`

    const task = {
      httpRequest: {
        httpMethod: 'POST',
        url: functionUrl,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ matchId, matchTitle })).toString('base64'),
        oidcToken: {
          serviceAccountEmail: `${PROJECT_ID}@appspot.gserviceaccount.com`,
        },
      },
      scheduleTime: {
        seconds: Math.floor(notifyAtDate.getTime() / 1000),
      },
    }

    const [response] = await client.createTask({ parent, task })
    logger.info(`Recordatorio programado: ${response.name}`, { matchId })
    return { success: true, taskName: response.name }
  },
)

// ── 7. HTTP trigger interno: enviar notificación recordatorio ─────────────────
/**
 * Invocado por Cloud Tasks en el momento de notifyAt.
 * Envía una push notification avisando que la lista se abre pronto.
 */
exports.sendMatchReminderNotification = onRequest(
  { region: LOCATION },
  async (req, res) => {
    try {
      const { matchId, matchTitle } = req.body

      if (!matchId || !matchTitle) {
        res.status(400).json({ error: 'Parámetros faltantes' })
        return
      }

      const usersSnap = await db
        .collection('users')
        .where('fcmToken', '!=', null)
        .select('fcmToken')
        .get()

      const tokens = usersSnap.docs
        .map((d) => d.data().fcmToken)
        .filter(Boolean)

      if (tokens.length === 0) {
        res.json({ sent: 0 })
        return
      }

      const BATCH_SIZE = 500
      const messaging = getMessaging()
      let totalSent = 0

      for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
        const batch = tokens.slice(i, i + BATCH_SIZE)
        const message = {
          notification: {
            title: '⏰ ¡La lista abre pronto!',
            body: `La lista para "${matchTitle}" se abre en breve. ¡Preparate!`,
          },
          data: { matchId, type: 'match_reminder' },
          webpush: {
            notification: {
              icon: '/icons/icon-192x192.png',
              badge: '/icons/badge-72x72.png',
            },
            fcmOptions: { link: `/partidos/${matchId}` },
          },
          tokens: batch,
        }
        const response = await messaging.sendEachForMulticast(message)
        totalSent += response.successCount
      }

      logger.info(`Recordatorio enviado a ${totalSent} dispositivos`, { matchId })
      res.json({ sent: totalSent })
    } catch (err) {
      logger.error('Error enviando recordatorio FCM:', err)
      res.status(500).json({ error: err.message })
    }
  },
)
