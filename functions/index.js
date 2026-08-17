// functions/index.js
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onDocumentUpdated, onDocumentWritten, onDocumentDeleted } = require('firebase-functions/v2/firestore')
const logger = require('firebase-functions/logger')
const admin = require('firebase-admin')
const { computeMundialTransition, resolvePendingCoinFlip } = require('./mundial-rules')

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
    const matchInfo = matchSnap.exists ? matchSnap.data() : {}
    const groupId = matchInfo.groupId ?? null
    const instantOpen = matchInfo.instantOpen === true

    // Programa el aviso anticipado a los OG del grupo (30 min antes de abrir).
    // En un partido de apertura inmediata no va: la lista abre ahora y el
    // aviso le llega a TODO el grupo de una sola vez (vía onMatchOpened), sin
    // que los OG reciban nada antes que el resto.
    if (!instantOpen) {
      await enqueueOgEarlyNotify(db, { matchId, matchTitle, groupId, openAtDate })
    }

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

// ─────────────────────────────────────────────────────────────────────────────
//  SCHEDULERS
//
//  Todo el trabajo periódico corre en UN SOLO job de Cloud Scheduler
//  (`processScheduledTasks`, más abajo) que cada minuto despacha estas tareas.
//  Antes eran 5 jobs separados; Cloud Scheduler regala 3 por proyecto, así que
//  el 4° y 5° se facturaban. Cada tarea sigue siendo una función independiente
//  y testeable — lo único que cambió es quién las dispara.
//
//  Las que no necesitan correr cada minuto llevan su propio intervalo interno
//  (ver TASK_INTERVALS): el despachador se saltea las que no toca.
// ─────────────────────────────────────────────────────────────────────────────

// ── Tarea: enviar avisos anticipados a los OG ────────────────────────────────
async function runMatchOgNotifyQueue() {
  {
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
  }
}

// ── Tarea: abrir partidos que llegaron a su hora ─────────────────────────────
async function runMatchOpenQueue() {
  {
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

    for (const { matchId } of toProcess) {
      await db.collection('matches').doc(matchId).update({
        status: 'open',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      // No hace falta encolar notificación acá: este update dispara el
      // trigger onMatchOpened, que ya notifica (filtrando por grupo). Antes
      // se encolaba también en _matchOpenNotificationQueue, que un minuto
      // después volvía a notificar a los mismos usuarios (doble push).
      logger.info(`Partido abierto por scheduler: ${matchId}`)
    }
  }
}

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

    const db = admin.firestore()
    const matchSnap = await db.collection('matches').doc(matchId).get()
    const groupId = matchSnap.exists ? (matchSnap.data().groupId ?? null) : null

    await db.collection('_matchReminderQueue').add({
      matchId,
      matchTitle,
      groupId,
      openAt: openAt ?? null,
      notifyAt: admin.firestore.Timestamp.fromDate(notifyAtDate),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      processed: false,
    })

    logger.info(`Recordatorio encolado: ${matchId} a ${notifyAtDate.toISOString()}`)
    return { success: true }
  },
)

// ── Tarea: enviar recordatorios ──────────────────────────────────────────────
async function runMatchReminderQueue() {
  {
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

    for (const { matchId, matchTitle, openAt, groupId } of toProcess) {
      const timeStr = openAt
        ? new Date(openAt).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })
        : 'en breve'
      const alreadyRegistered = await getRegisteredUserIds(matchId)
      const title = '⏰ ¡La lista abre pronto!'
      const body = `La lista para "${matchTitle}" se abre a las ${timeStr}. ¡Anotáte!`
      if (groupId) {
        await sendFCMToGroupMembers(groupId, title, body, { matchId, type: 'match_reminder' }, alreadyRegistered)
      } else {
        await sendFCMToAllUsers(title, body, { matchId, type: 'match_reminder' }, alreadyRegistered)
      }
      logger.info(`Recordatorio enviado por scheduler: ${matchId}`)
    }
  }
}

// ── 5b. Scheduled: avisar 6-8hs antes del partido si faltan jugadores ────────
// Corre cada 10 min. Para cada partido cuya `date` cae dentro de la ventana
// [ahora+6h, ahora+8h], si todavía admite anotaciones (no closed/finished) y
// le faltan jugadores, manda UN aviso (marca `lowSignupAlertSent` para no
// repetirlo) a los miembros del grupo del partido (o a todos si no tiene
// grupo), excluyendo a quienes ya están anotados.
async function runMatchLowSignupAlert() {
  {
    const db = admin.firestore()
    const now = new Date()
    const windowStart = admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 6 * 60 * 60 * 1000))
    const windowEnd = admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 8 * 60 * 60 * 1000))

    const snap = await db
      .collection('matches')
      .where('date', '>=', windowStart)
      .where('date', '<=', windowEnd)
      .get()

    if (snap.empty) return

    for (const docSnap of snap.docs) {
      const match = docSnap.data()
      const matchId = docSnap.id

      if (match.status === 'closed' || match.status === 'finished') continue
      if (match.lowSignupAlertSent) continue

      const maxPlayers = match.maxPlayers ?? 0
      const missing = maxPlayers - (match.currentPlayers ?? 0)
      if (missing <= 0) continue

      await docSnap.ref.update({ lowSignupAlertSent: true })

      const title = match.title ?? 'un partido'
      const spotsWord = missing === 1 ? 'lugar' : 'lugares'
      const body = `Faltan ${missing} ${spotsWord} para "${title}". ¡Sumate o invitá a un amigo!`
      const alreadyRegistered = await getRegisteredUserIds(matchId)

      if (match.groupId) {
        await sendFCMToGroupMembers(
          match.groupId,
          '⚠️ Faltan jugadores',
          body,
          { matchId, type: 'low_signup_alert' },
          alreadyRegistered,
        )
      } else {
        await sendFCMToAllUsers(
          '⚠️ Faltan jugadores',
          body,
          { matchId, type: 'low_signup_alert' },
          alreadyRegistered,
        )
      }
      logger.info(`Aviso de faltan jugadores enviado: ${matchId} (faltan ${missing})`)
    }
  }
}

// ── 5c. Scheduled: auto-cerrar resultado/votación de MVP a las 36hs ──────────
// Corre cada hora. Un partido 'finished' hace más de 36hs (desde finishedAt,
// que se fija UNA sola vez) deja de ser editable por el cliente común: cierra
// la votación de MVP (si no se cerró antes a mano) y marca resultLocked:true,
// lo que bloquea en las reglas la edición de scoreA/scoreB/status/playerStats.
// Un admin global siempre puede seguir editando después de esto.
async function runAutoCloseMatches() {
  {
    const db = admin.firestore()
    const threshold = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 36 * 60 * 60 * 1000))

    const snap = await db
      .collection('matches')
      .where('status', '==', 'finished')
      .where('finishedAt', '<=', threshold)
      .get()

    if (snap.empty) return

    for (const docSnap of snap.docs) {
      const match = docSnap.data()
      if (match.resultLocked === true) continue

      try {
        if (match.mvpVotingClosed === true) {
          // La votación ya se cerró a mano — solo falta bloquear el resultado.
          await docSnap.ref.update({
            resultLocked: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        } else {
          await closeMvpVotingForMatch(docSnap.id, { lockResult: true })
        }
        logger.info(`processAutoCloseMatches: ${docSnap.id} bloqueado (finishedAt hace más de 36hs)`)
      } catch (error) {
        logger.error(`processAutoCloseMatches: error en ${docSnap.id}`, error)
      }
    }
  }
}

// ── Despachador único de tareas periódicas ───────────────────────────────────
// Un solo job de Cloud Scheduler (de los 3 gratuitos) en vez de 5.
//
// Cada tarea declara cada cuántos minutos corre. El despachador arranca cada
// minuto y ejecuta las que corresponden según el minuto absoluto del reloj
// (epoch / 60000), así que el ritmo de cada una se mantiene igual que cuando
// tenía su propio job.
//
// Las tareas se ejecutan de forma AISLADA: si una falla, se registra el error
// y las demás siguen. Antes, cada job fallaba por su cuenta sin afectar al
// resto; sin este try/catch por tarea, un error habría tumbado a todas.
const SCHEDULED_TASKS = [
  { name: 'matchOpenQueue',     everyMinutes: 1,  run: runMatchOpenQueue },
  { name: 'matchOgNotifyQueue', everyMinutes: 1,  run: runMatchOgNotifyQueue },
  { name: 'matchReminderQueue', everyMinutes: 1,  run: runMatchReminderQueue },
  { name: 'lowSignupAlert',     everyMinutes: 10, run: runMatchLowSignupAlert },
  { name: 'autoCloseMatches',   everyMinutes: 60, run: runAutoCloseMatches },
]

exports.processScheduledTasks = onSchedule(
  { region: LOCATION, schedule: 'every 1 minutes' },
  async () => {
    const minuteOfEpoch = Math.floor(Date.now() / 60000)

    for (const task of SCHEDULED_TASKS) {
      if (minuteOfEpoch % task.everyMinutes !== 0) continue
      try {
        await task.run()
      } catch (error) {
        logger.error(`processScheduledTasks: falló la tarea "${task.name}"`, error)
      }
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

// ── 7b. Callable: cerrar votación de MVP y fijar el ganador ──────────────────
// Cuenta matches/{matchId}/mvpVotes, determina el ganador por mayoría simple
// (empate en el primer puesto → sin MVP) y escribe con Admin SDK:
//   matches/{id}.mvpUserId/mvpName/mvpVotingClosed
//   playerStats/{winnerId}.mvp = true (y false en quien lo tuviera antes)
// El write a playerStats sigue dispargando onPlayerStatsWritten normalmente,
// que acumula stats.mvps por diferencia — no hace falta tocar ese trigger.
// ── Helper: cuenta los votos y fija el MVP de un partido ─────────────────────
// Reusado por la callable closeMvpVoting (cierre manual) y por el scheduler
// processAutoCloseMatches (cierre automático a las 36hs). Si `lockResult` es
// true, además marca resultLocked:true en el mismo batch (auto-cierre).
async function closeMvpVotingForMatch(matchId, { lockResult = false } = {}) {
  const db = admin.firestore()
  const matchRef = db.collection('matches').doc(matchId)

  const votesSnap = await matchRef.collection('mvpVotes').get()
  const tally = new Map()
  votesSnap.docs.forEach((d) => {
    const target = d.data().votedForUserId
    if (!target) return
    tally.set(target, (tally.get(target) ?? 0) + 1)
  })

  let winnerId = null
  if (tally.size > 0) {
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1])
    const topCount = sorted[0][1]
    const topCandidates = sorted.filter(([, c]) => c === topCount)
    // Empate en el primer puesto → sin MVP (sin desempate manual/segunda vuelta)
    if (topCandidates.length === 1) winnerId = topCandidates[0][0]
  }

  let winnerName = null
  if (winnerId) {
    const statSnap = await matchRef.collection('playerStats').doc(winnerId).get()
    winnerName = statSnap.exists ? (statSnap.data().displayName ?? null) : null
  }

  const batch = db.batch()
  batch.update(matchRef, {
    mvpUserId: winnerId,
    mvpName: winnerName,
    mvpVotingClosed: true,
    ...(lockResult ? { resultLocked: true } : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  const statsSnap = await matchRef.collection('playerStats').get()
  statsSnap.docs.forEach((d) => {
    const isWinner = d.id === winnerId
    const wasMvp = d.data().mvp === true
    if (isWinner && !wasMvp) batch.update(d.ref, { mvp: true })
    if (!isWinner && wasMvp) batch.update(d.ref, { mvp: false })
  })

  await batch.commit()
  return { winnerId, winnerName, tally }
}

exports.closeMvpVoting = onCall(
  { region: LOCATION, invoker: 'public' },
  async (request) => {
    const { matchId } = request.data
    if (!matchId) {
      throw new HttpsError('invalid-argument', 'matchId requerido.')
    }

    await assertCanManageMatchNotifications(request.auth, matchId)

    const db = admin.firestore()
    const matchSnap = await db.collection('matches').doc(matchId).get()
    if (!matchSnap.exists) {
      throw new HttpsError('not-found', 'Partido no encontrado.')
    }
    const match = matchSnap.data()

    if (match.status !== 'finished') {
      throw new HttpsError('failed-precondition', 'El partido debe estar finalizado para cerrar la votación.')
    }
    if (match.mvpVotingClosed === true) {
      throw new HttpsError('failed-precondition', 'La votación ya está cerrada.')
    }

    const { winnerId, winnerName, tally } = await closeMvpVotingForMatch(matchId)
    logger.info(`closeMvpVoting: ${matchId} → ganador=${winnerId ?? 'empate/sin votos'}`)
    return { success: true, winnerId, winnerName, tally: Object.fromEntries(tally) }
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
      const groupId = after.groupId ?? null
      if (groupId) {
        await sendFCMToGroupMembers(
          groupId,
          '⚽ ¡Se abrió la lista!',
          'Ya podés anotarte al partido: ' + title,
          { matchId: matchId, type: 'match_open' },
          alreadyRegistered,
        )
      } else {
        await sendFCMToAllUsers(
          '⚽ ¡Se abrió la lista!',
          'Ya podés anotarte al partido: ' + title,
          { matchId: matchId, type: 'match_open' },
          alreadyRegistered,
        )
      }
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

      // ── Mundial personal: avanza de fase con el PRIMER resultado cargado ───
      // Gate por beforeResult == null (no por afterResult !== beforeResult):
      // así una edición posterior del resultado (before ya tenía W/E/L) nunca
      // reprocesa el Mundial — el primer resultado cargado es el que cuenta.
      if (after?.result && before?.result == null) {
        await advancePlayerMundial(userId, after.result, event.params.matchId)
      }

      // ── Química por pares: ¿compartió equipo con otros en este partido? ────
      // Se dispara solo cuando la fila tiene team+result definidos (resultado
      // ya cargado). Compara antes/después contra cada compañero de partido
      // para sumar/restar por diferencia — mismo patrón idempotente de arriba.
      const afterHasTeamResult = !!(after?.userId && after?.team && after?.result)
      const beforeHasTeamResult = !!(before?.userId && before?.team && before?.result)

      if (afterHasTeamResult || beforeHasTeamResult) {
        await updateChemistryForPlayerStat(event.params.matchId, userId, before, after)
      }
    } catch (error) {
      logger.error('onPlayerStatsWritten: error', error)
    }
  },
)

// ── Helper: actualizar química por pares tras un write en playerStats ───────
// Lee los demás playerStats del mismo partido y, para cada compañero que
// compartía/comparte equipo con `userId`, incrementa por diferencia (before
// → after) los contadores simétricos en users/{userId}/chemistry/{other} Y
// users/{other}/chemistry/{userId}. No hay orden garantizado entre triggers
// hermanos (cada playerStats dispara su propio evento), pero cada incremento
// es atómico y todos convergen al mismo estado final — aceptable acá.
async function updateChemistryForPlayerStat(matchId, userId, before, after) {
  const db = admin.firestore()
  const siblingsSnap = await db.collection('matches').doc(matchId).collection('playerStats').get()
  const siblings = siblingsSnap.docs
    .map((d) => d.data())
    .filter((s) => s.userId && s.userId !== userId && s.team && s.result)

  if (siblings.length === 0) return

  const inc = admin.firestore.FieldValue.increment
  const batch = db.batch()
  let hasChanges = false

  for (const other of siblings) {
    const wasTogetherBefore = !!(before?.team && before?.result && before.team === other.team)
    const isTogetherAfter = !!(after?.team && after?.result && after.team === other.team)

    if (wasTogetherBefore === isTogetherAfter) continue

    const sign = isTogetherAfter ? 1 : -1
    const result = isTogetherAfter ? after.result : before.result
    const payload = {
      gamesTogether: inc(sign),
      winsTogether: inc(result === 'W' ? sign : 0),
      drawsTogether: inc(result === 'E' ? sign : 0),
      lossesTogether: inc(result === 'L' ? sign : 0),
      lastPlayedAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    const chemRefA = db.collection('users').doc(userId).collection('chemistry').doc(other.userId)
    const chemRefB = db.collection('users').doc(other.userId).collection('chemistry').doc(userId)
    batch.set(chemRefA, payload, { merge: true })
    batch.set(chemRefB, payload, { merge: true })
    hasChanges = true
  }

  if (hasChanges) await batch.commit()
}

// ── Helper: avanzar el Mundial personal de un jugador con un resultado real ─
// Solo hace algo si el jugador tiene un Mundial activo. Si hay un coin flip
// pendiente sin resolver, NO avanza (queda congelado hasta que el cliente
// llame revealMundialCoinFlip) — el resultado del partido ya se acumuló en
// stats más arriba de todas formas.
async function advancePlayerMundial(userId, result, matchId) {
  const db = admin.firestore()
  const userRef = db.collection('users').doc(userId)
  const userSnap = await userRef.get()
  const mundial = userSnap.data()?.mundial
  if (!mundial?.active) return

  if (mundial.pendingCoinFlip && !mundial.pendingCoinFlip.resolved) {
    logger.warn(`advancePlayerMundial: ${userId} tiene un coin flip pendiente, se ignora el resultado de ${matchId}`)
    return
  }

  const transition = computeMundialTransition(mundial, result, matchId, userId)
  const patch = { ...transition.patch, 'mundial.updatedAt': admin.firestore.FieldValue.serverTimestamp() }

  let notifyTitle = null
  let notifyBody = null

  if (transition.type === 'classify_knockout') {
    notifyTitle = '⚽ ¡Clasificaste a octavos!'
    notifyBody = 'Tu Mundial personal sigue en pie. ¡A por la copa!'
  } else if (transition.type === 'advance_knockout') {
    notifyTitle = '🏆 ¡Avanzaste de fase en tu Mundial!'
    notifyBody = `Ahora estás en ${transition.nextPhase}.`
  } else if (transition.type === 'champion') {
    patch['mundial.active'] = false
    patch['mundial.endedAt'] = admin.firestore.FieldValue.serverTimestamp()
    patch['mundial.titles'] = admin.firestore.FieldValue.increment(1)
    patch['mundial.lastResult'] = 'champion'
    notifyTitle = '🏆 ¡SOS CAMPEÓN DEL MUNDIAL!'
    notifyBody = 'Ganaste la final de tu Mundial personal. ¡Felicitaciones!'
  } else if (transition.type === 'eliminated') {
    patch['mundial.active'] = false
    patch['mundial.endedAt'] = admin.firestore.FieldValue.serverTimestamp()
    patch['mundial.lastResult'] = mundial.phase === 'groups' ? 'eliminated_groups' : 'eliminated_knockout'
    notifyTitle = '😔 Quedaste eliminado del Mundial'
    notifyBody = 'Tu Mundial personal terminó acá. Podés arrancar uno nuevo cuando quieras.'
  } else if (transition.type === 'pending_coin_flip') {
    notifyTitle = '🪙 Tenés un sorteo pendiente en tu Mundial'
    notifyBody = 'El resultado quedó ajustado — entrá a tu perfil para tirar la moneda.'
  }
  // noop_group_result: solo guarda el resultado en groupMatchResults, sin notificar

  await userRef.update(patch)
  logger.info(`advancePlayerMundial: ${userId} → ${transition.type}`)

  if (notifyTitle) {
    await sendFCMToUser(userId, notifyTitle, notifyBody, { type: 'mundial_update' })
  }
}

// ── Callable: resolver un coin flip pendiente del Mundial personal ──────────
// El outcome ya fue decidido y congelado server-side cuando se detectó la
// ambigüedad (buildPendingCoinFlip en mundial-rules.js) — esta función NUNCA
// decide nada, solo aplica la transición correspondiente y la devuelve para
// que el cliente anime la revelación. runTransaction evita doble-resolución
// ante reintentos/doble-tap.
exports.revealMundialCoinFlip = onCall(
  { region: LOCATION, invoker: 'public' },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Debés iniciar sesión.')
    }

    const db = admin.firestore()
    const userRef = db.collection('users').doc(uid)

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef)
      const mundial = snap.data()?.mundial
      const pending = mundial?.pendingCoinFlip

      if (!pending || pending.resolved) {
        throw new HttpsError('failed-precondition', 'No hay un sorteo pendiente para resolver.')
      }

      const transition = resolvePendingCoinFlip(mundial)
      const patch = {
        ...transition.patch,
        'mundial.pendingCoinFlip.resolved': true,
        'mundial.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
      }

      if (transition.type === 'champion') {
        patch['mundial.active'] = false
        patch['mundial.endedAt'] = admin.firestore.FieldValue.serverTimestamp()
        patch['mundial.titles'] = admin.firestore.FieldValue.increment(1)
        patch['mundial.lastResult'] = 'champion'
      } else if (transition.type === 'eliminated') {
        patch['mundial.active'] = false
        patch['mundial.endedAt'] = admin.firestore.FieldValue.serverTimestamp()
        patch['mundial.lastResult'] = mundial.phase === 'groups' ? 'eliminated_groups' : 'eliminated_knockout'
      }

      tx.update(userRef, patch)
      return { outcome: pending.outcome, type: transition.type, nextPhase: transition.nextPhase ?? null }
    })

    logger.info(`revealMundialCoinFlip: ${uid} → ${result.outcome} (${result.type})`)
    return result
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

    // 3. Backfill de química por pares: agrupar playerStats por partido y,
    //    para cada par con mismo team+result en el mismo matchId, acumular
    //    contadores simétricos. Se sobrescribe TODA la subcolección chemistry
    //    de cada usuario tocado (borrar + reescribir), igual criterio que
    //    stats/statsByGroup arriba.
    const byMatch = new Map()
    statsSnap.docs.forEach((d) => {
      const s = d.data()
      if (!s.userId || !s.team || !s.result) return
      const matchId = d.ref.parent.parent.id
      if (!byMatch.has(matchId)) byMatch.set(matchId, [])
      byMatch.get(matchId).push({ userId: s.userId, team: s.team, result: s.result })
    })

    const zeroChem = () => ({ gamesTogether: 0, winsTogether: 0, drawsTogether: 0, lossesTogether: 0 })
    const chemByUser = new Map()
    const addPair = (uid, otherUid, result) => {
      if (!chemByUser.has(uid)) chemByUser.set(uid, new Map())
      const m = chemByUser.get(uid)
      const c = m.get(otherUid) ?? zeroChem()
      c.gamesTogether += 1
      if (result === 'W') c.winsTogether += 1
      if (result === 'E') c.drawsTogether += 1
      if (result === 'L') c.lossesTogether += 1
      m.set(otherUid, c)
    }

    for (const players of byMatch.values()) {
      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const a = players[i]
          const b = players[j]
          if (a.team !== b.team) continue
          addPair(a.userId, b.userId, a.result)
          addPair(b.userId, a.userId, b.result)
        }
      }
    }

    let chemBatch = db.batch()
    let chemOps = 0
    for (const [uid, pairs] of chemByUser.entries()) {
      const chemCol = db.collection('users').doc(uid).collection('chemistry')
      const existingSnap = await chemCol.get()
      existingSnap.docs.forEach((d) => {
        chemBatch.delete(d.ref)
        chemOps += 1
      })
      for (const [otherUid, c] of pairs.entries()) {
        chemBatch.set(chemCol.doc(otherUid), {
          ...c,
          lastPlayedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        chemOps += 1
      }
      if (chemOps >= 400) {
        await chemBatch.commit()
        chemBatch = db.batch()
        chemOps = 0
      }
    }
    if (chemOps > 0) await chemBatch.commit()

    logger.info(
      `recalcAllStats: ${statsSnap.size} playerStats → ${usersSnap.size} usuarios actualizados, química recalculada para ${chemByUser.size} usuarios`,
    )
    return { success: true, playerStats: statsSnap.size, users: usersSnap.size, chemistryUsers: chemByUser.size }
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
        if (!matchSnap.exists) {
          logger.warn(`onRegistrationDeleted: match ${matchId} no existe, se omite`)
          return null
        }

        const match = matchSnap.data()
        // En partidos terminados no tiene sentido promover ni avisar
        if (match.status === 'finished') {
          logger.info(`onRegistrationDeleted: match ${matchId} finished, se omite (se bajó ${leaverName})`)
          return null
        }

        // Formato libre (maxPlayers null) = sin límite: NUNCA hay suplentes.
        // No colapsar a 0 — `pos > 0` sería true para todos y marcaría a todo
        // el partido como lista de espera. Mismo criterio que registerEntry
        // (useRegistration.js), que chequea `maxPlayers != null` explícitamente.
        const maxPlayers = match.maxPlayers ?? null
        const regsSnap = await tx.get(
          matchRef.collection('registrations').orderBy('position', 'asc'),
        )

        const promotedUsers = []
        const registeredUserIds = []
        let pos = 0
        regsSnap.docs.forEach((docSnap) => {
          pos += 1
          const reg = docSnap.data()
          const isOnWaitlist = maxPlayers != null && pos > maxPlayers

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
          groupId: match.groupId ?? null,
          promoted: promotedUsers,
          createdBy: match.createdBy ?? null,
          status: match.status ?? null,
          // ¿Quedó un lugar libre de verdad? (partido aún admite anotaciones y
          // cupo sin llenar, es decir sin suplentes que tapen el hueco).
          // OJO: no exigir status === 'open' a secas — el scheduler que pasa
          // 'scheduled' → 'open' corre cada 1 min y puede tener lag; el mismo
          // criterio que getEffectiveStatus() en el cliente (useMatch.js) es
          // "no está cerrado ni terminado", no el string exacto 'open'.
          // En formato libre (maxPlayers null) nunca hay "lugar que se liberó":
          // no hay cupo que llenar, así que no corresponde el broadcast masivo.
          spotOpen:
            match.status !== 'closed' &&
            match.status !== 'finished' &&
            maxPlayers != null &&
            regsSnap.size < maxPlayers,
          registeredUserIds,
        }
      })

      if (!info) return
      const { matchTitle, groupId, promoted, createdBy, status, spotOpen, registeredUserIds } = info

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
        // 2) No había suplentes y quedó lugar → avisar (solo al grupo del
        // partido si tiene uno; a todos si es un partido global sin grupo)
        const title = '⚽ ¡Se liberó un lugar!'
        const body = `Se bajó ${leaverName} de "${matchTitle}". ¡Hay lugar, anotáte!`
        if (groupId) {
          await sendFCMToGroupMembers(groupId, title, body, { matchId, type: 'spot_available' }, registeredUserIds)
        } else {
          await sendFCMToAllUsers(title, body, { matchId, type: 'spot_available' }, registeredUserIds)
        }
        logger.info(`Lugar libre en ${matchId}: broadcast a ${groupId ? 'grupo ' + groupId : 'todos'} (se bajó ${leaverName})`)
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
      } else {
        // Ninguna rama aplicó: no había suplente, no hay lugar real (o el
        // partido ya no admite anotaciones), y el que se bajó era el propio
        // creador (o no tiene creador) → nadie a quien avisar. Se deja
        // constancia explícita para que esto nunca vuelva a quedar en silencio.
        logger.info(
          `onRegistrationDeleted: sin notificación para ${matchId} (se bajó ${leaverName}, ` +
          `status=${status}, spotOpen=${spotOpen}, promoted=${promoted.length}, ` +
          `createdBy=${createdBy}, leaverUserId=${leaverUserId})`,
        )
      }
    } catch (error) {
      logger.error(`onRegistrationDeleted: error procesando baja en ${event.params.matchId}`, error)
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
// ¿Puede este uid programar las notificaciones de ESTE partido?
//
// Las reglas de Firestore dejan crear un partido a CUALQUIER miembro del grupo,
// pero esta comprobación exigía owner/admin: un `member` creaba la lista y
// después no podía programarle la apertura (permission-denied).
//
// Con listas programadas a futuro el problema quedaba tapado —el partido nacía
// 'scheduled' y la cola lo abría igual—, pero con `instantOpen` la apertura
// depende por completo de esta llamada: si falla, el partido queda 'scheduled'
// PARA SIEMPRE y no se envía ninguna notificación. Por eso el permiso ahora
// coincide con el de crear: el CREADOR del partido puede programar lo suyo.
async function canCallerScheduleMatchNotifications(uid, matchId) {
  const db = admin.firestore()
  const matchSnap = await db.collection('matches').doc(matchId).get()
  if (!matchSnap.exists) return false
  const match = matchSnap.data()

  // El creador del partido siempre puede programar SUS notificaciones
  if (match.createdBy === uid) return true

  const groupId = match.groupId
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
  if (uid && (await canCallerScheduleMatchNotifications(uid, matchId))) return
  throw new HttpsError(
    'permission-denied',
    'No tenés permiso para programar notificaciones de este partido.',
  )
}

// ── 9a0. Categorías de notificación y preferencias del usuario ───────────────
//
// Cada push que manda la app pertenece a UNA categoría. El usuario puede apagar
// categorías sueltas desde su perfil (`users/{uid}.notificationPrefs`), sin
// tener que bloquear las notificaciones del navegador — que era la única opción
// que existía antes y que apagaba TODO para siempre, incluidos los avisos de su
// propio grupo.
//
// Regla de oro: el default de una categoría ausente es `true` (quien nunca tocó
// sus preferencias sigue recibiendo lo de siempre), EXCEPTO las que son opt-in
// explícito (`publicNearby`), que nacen apagadas porque son las únicas que
// notifican sobre partidos de gente que el usuario no conoce.
const NOTIFICATION_CATEGORIES = {
  MY_GROUPS: 'myGroups',       // Se abrió la lista, recordatorios, cupo libre, suplente que entra
  PUBLIC_NEARBY: 'publicNearby', // Se publicó un partido abierto (opt-in — nace APAGADA)
  APPLICATIONS: 'applications', // Alguien se postuló a mi partido / me aceptaron o rechazaron
  CHAT: 'chat',                // Mensajes nuevos en el chat del partido
}

// Defaults por categoría. Ver el comentario de arriba sobre por qué
// PUBLIC_NEARBY arranca en false.
const NOTIFICATION_DEFAULTS = {
  [NOTIFICATION_CATEGORIES.MY_GROUPS]: true,
  [NOTIFICATION_CATEGORIES.PUBLIC_NEARBY]: false,
  [NOTIFICATION_CATEGORIES.APPLICATIONS]: true,
  [NOTIFICATION_CATEGORIES.CHAT]: true,
}

/**
 * ¿Este usuario quiere recibir pushes de esta categoría?
 * @param {object} userData  datos del doc users/{uid}
 * @param {string|null} category  una de NOTIFICATION_CATEGORIES; null = no filtrar
 */
function wantsNotification(userData, category) {
  if (!category) return true
  const prefs = userData?.notificationPrefs
  const value = prefs?.[category]
  // `undefined` (nunca configuró esta categoría) cae al default de la categoría.
  return typeof value === 'boolean' ? value : (NOTIFICATION_DEFAULTS[category] ?? true)
}

// ── 9a. Helper: recolectar tokens FCM de un conjunto de documentos de usuario
//
// `category` filtra por las preferencias del usuario. Se aplica ACÁ a propósito:
// es el único punto por el que pasan todos los envíos (sendFCMToAllUsers,
// ToGroupMembers, ToGroupOGs, ToUser), así que ninguna ruta puede saltearse el
// filtro por olvido. Omitirlo (undefined) manda a todos, para los avisos que no
// son opcionales.
function collectTokensFromUserDocs(userDocs, category = null) {
  const tokenSet = new Set()
  userDocs.forEach((d) => {
    const u = d.data()
    if (!wantsNotification(u, category)) return
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
async function sendFCMToGroupOGs(groupId, title, body, data, category = NOTIFICATION_CATEGORIES.MY_GROUPS) {
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
      .select('fcmToken', 'fcmTokens', 'notificationPrefs')
      .get()
    userDocs.push(...usersSnap.docs)
  }

  const tokens = collectTokensFromUserDocs(userDocs, category)
  await dispatchFCM(tokens, title, body, data)
}

// ── 9c2. Helper: enviar FCM a TODOS los miembros de un grupo ─────────────────
async function sendFCMToGroupMembers(
  groupId,
  title,
  body,
  data,
  excludeUserIds = [],
  category = NOTIFICATION_CATEGORIES.MY_GROUPS,
) {
  if (!groupId) return
  const db = admin.firestore()
  const membersSnap = await db.collection('groups').doc(groupId).collection('members').get()

  const excludeSet = new Set(excludeUserIds)
  const memberUserIds = [
    ...new Set(
      membersSnap.docs
        .map((d) => d.data().userId)
        .filter((uid) => uid && !excludeSet.has(uid)),
    ),
  ]

  logger.info(`[FCM] sendFCMToGroupMembers(${groupId}) → destinatarios: ${memberUserIds.length}`)
  if (memberUserIds.length === 0) return

  // Firestore limita `in` a 30 elementos → leer en tandas
  const userDocs = []
  for (let i = 0; i < memberUserIds.length; i += 30) {
    const chunk = memberUserIds.slice(i, i + 30)
    const usersSnap = await db
      .collection('users')
      .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
      .select('fcmToken', 'fcmTokens', 'notificationPrefs')
      .get()
    userDocs.push(...usersSnap.docs)
  }

  const tokens = collectTokensFromUserDocs(userDocs, category)
  await dispatchFCM(tokens, title, body, data)
}

// ── 9d. Helper: enviar FCM a UN usuario puntual ──────────────────────────────
async function sendFCMToUser(userId, title, body, data, category = NOTIFICATION_CATEGORIES.MY_GROUPS) {
  if (!userId) return
  const db = admin.firestore()
  const userSnap = await db.collection('users').doc(userId).get()
  if (!userSnap.exists) return

  const tokens = collectTokensFromUserDocs([userSnap], category)
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
// `category`: categoría de NOTIFICATION_CATEGORIES — quien la tenga apagada en
// su perfil no recibe nada. Es el envío más ruidoso de la app (toda la base),
// así que es el que más depende de que el filtro esté puesto.
async function sendFCMToAllUsers(
  title,
  body,
  data,
  excludeUserIds = [],
  category = NOTIFICATION_CATEGORIES.MY_GROUPS,
) {
  const db = admin.firestore()
  const excludeSet = new Set(excludeUserIds)
  const usersSnap = await db
    .collection('users')
    .select('fcmToken', 'fcmTokens', 'notificationPrefs')
    .get()
  const includedDocs = usersSnap.docs.filter((d) => !excludeSet.has(d.id))
  const tokens = collectTokensFromUserDocs(includedDocs, category)
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