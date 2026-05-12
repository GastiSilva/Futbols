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
const logger = require('firebase-functions/logger')
const admin = require('firebase-admin')

// Inicializar Firebase Admin SDK al arrancar el módulo (recomendado para Gen 2)
admin.initializeApp()

const { FieldValue } = require('firebase-admin/firestore')

const PROJECT_ID = process.env.GCLOUD_PROJECT
const LOCATION = 'southamerica-east1'
const QUEUE_NAME = 'match-notifications'

const getDb = () => admin.firestore()
const getMessaging = () => admin.messaging()
const getAuth = () => admin.auth()

function getCloudTasksClient() {
  const { CloudTasksClient } = require('@google-cloud/tasks')
  return new CloudTasksClient()
}

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

    const client = getCloudTasksClient()
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
    await getDb().collection('matches').doc(matchId).update({
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
      await getDb().collection('matches').doc(matchId).update({
        status: 'open',
        updatedAt: FieldValue.serverTimestamp(),
      })

      // Recolecta todos los tokens FCM válidos
      const usersSnap = await getDb()
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
        const cleanupBatch = getDb().batch()
        const invalidSnap = await getDb()
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
 * 
 * Nota: El cliente debe refrescar el token después de este cambio.
 */
exports.setUserRole = onCall(
  { region: LOCATION },
  async (request) => {
    try {
      // Verificar autenticación
      if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Usuario no autenticado.')
      }

      logger.info(`setUserRole llamada por ${request.auth.uid}`)

      // Verificar si el usuario tiene permiso de admin
      if (!request.auth?.token?.admin) {
        logger.warn(`Intento no autorizado de setUserRole por ${request.auth.uid}`)
        throw new HttpsError('permission-denied', 'Solo administradores pueden cambiar roles.')
      }

      const { targetUid, role } = request.data
      const validRoles = ['admin', 'og', 'player']

      // Validar parámetros
      if (!targetUid) {
        throw new HttpsError('invalid-argument', 'targetUid requerido.')
      }
      if (!role || !validRoles.includes(role)) {
        throw new HttpsError('invalid-argument', `Rol inválido. Debe ser: ${validRoles.join(', ')}.`)
      }

      logger.info(`Cambiando rol de ${targetUid} a '${role}'`)

      // Paso 1: Actualizar el custom claim en Firebase Auth
      const isAdminRole = role === 'admin'
      logger.info(`Estableciendo custom claim admin=${isAdminRole} para ${targetUid}`)
      
      try {
        await getAuth().setCustomUserClaims(targetUid, { admin: isAdminRole })
        logger.info(`✓ Custom claim actualizado para ${targetUid}`)
      } catch (authError) {
        logger.error(`Error al actualizar custom claim: ${authError.message}`, authError)
        throw new HttpsError('internal', `Error al actualizar permisos: ${authError.message}`)
      }

      // Paso 2: Actualizar el documento en Firestore
      logger.info(`Actualizando documento de usuario en Firestore: ${targetUid}`)
      
      try {
        await getDb().collection('users').doc(targetUid).update({
          role,
          updatedAt: FieldValue.serverTimestamp(),
        })
        logger.info(`✓ Documento de usuario actualizado: ${targetUid}`)
      } catch (dbError) {
        logger.error(`Error al actualizar Firestore: ${dbError.message}`, dbError)
        throw new HttpsError('internal', `Error al guardar cambios: ${dbError.message}`)
      }

      logger.info(`✓ Rol '${role}' asignado exitosamente a ${targetUid}`)
      return { success: true, message: `Rol actualizado a '${role}'` }
      
    } catch (error) {
      logger.error(`Error en setUserRole: ${error.message}`, error)
      
      // Si ya es un HttpsError, re-lanzarlo tal cual
      if (error instanceof HttpsError) {
        throw error
      }
      
      // Caso contrario, lanzar un error genérico pero informativo
      const errorMsg = error.message || 'Error desconocido'
      throw new HttpsError('internal', `Error al asignar rol: ${errorMsg}`)
    }
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

    const client = getCloudTasksClient()
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

      const usersSnap = await getDb()
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
