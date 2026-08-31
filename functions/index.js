// functions/index.js
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
  onDocumentDeleted,
} = require('firebase-functions/v2/firestore')
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

// ── 5b2. Scheduled: aviso de "hype" personalizado antes de cada partido ──────
// Corre cada 10 min. Para cada partido cuya `date` cae dentro de la ventana
// [ahora+30min, ahora+6h], y que todavía no se avisó (`hypeMsgSent`), recorre
// SOLO a los inscriptos de ESE partido (no la base entera de usuarios: la
// combinatoria de "vs" contra todo el mundo sería cara e irrelevante — a cada
// uno le importa únicamente con quién juega HOY) y le arma una frase
// personalizada: primero busca si tiene historial de rivalry/chemistry contra
// alguien de la MISMA lista con al menos MIN_HEAD_TO_HEAD_MATCHES partidos en
// común (más específico y social, "hoy jugás con/contra Fulano"); si no hay
// cruce que alcance el piso, cae a su racha personal (streaks).
//
// Tope deliberado: aunque calificaran TODOS los inscriptos, solo se les manda
// a lo sumo la MITAD (HYPE_SHARE_OF_PLAYERS) — que le llegue algo a cada uno
// de los 14 anotados un rato antes de jugar se siente como spam de la app, no
// como una posta puntual entre amigos. Si hay más candidatos calificados que
// cupo, se sortea entre ellos (no "los primeros de la lista" ni "los de más
// historial siempre") para que no le toque siempre a los mismos veteranos del
// grupo.
const MIN_HEAD_TO_HEAD_MATCHES = 3
// Porción de los TITULARES que recibe el aviso. Sobre titulares y no sobre
// todos los anotados: al suplente que quizás ni juega, un "hoy tenés enfrente
// a Fulano" le llega de una charla que no es la suya.
const HYPE_SHARE_OF_PLAYERS = 0.6
// Cuánto hay que esperar desde el ÚLTIMO retoque de los equipos antes de
// avisar. No es un margen técnico: es el tiempo que tarda el que arma los
// equipos en aceptar la sugerencia y después mover dos o tres jugadores a
// mano. Avisar en el acto mandaría el mensaje con una formación que cambia
// treinta segundos más tarde.
//
// Sumado al tick de 10 min de la tarea, el aviso cae entre 2 y 12 minutos
// después del último retoque. NO acelerar el tick para achicar esa ventana:
// el aviso sale entre 30 min y 6 horas antes del partido, así que la
// diferencia entre 7 y 12 minutos no la nota nadie, mientras que el tick sí
// se paga las 24 horas (cada corrida es una lectura, haya partidos o no: a
// 10 min son 144 lecturas por día, a 5 min 288, a 2 min 720). Lo que importa
// de este mecanismo es que el mensaje diga la verdad sobre los equipos, no
// que llegue rápido.
const HYPE_TEAMS_DEBOUNCE_MS = 2 * 60 * 1000
// Ventana de anticipación. El techo (6h) es el mismo de antes; el piso (30
// min) existe porque un aviso que llega cuando ya estás entrando a la cancha
// no sirve para nada.
const HYPE_MAX_LEAD_MS = 6 * 60 * 60 * 1000
const HYPE_MIN_LEAD_MS = 30 * 60 * 1000
// Si a esta altura los equipos todavía no se armaron, se deja de esperar y se
// avisa igual — pero SOLO con rachas personales, que no dependen de quién
// juega con quién. Muchos grupos arman los equipos en la cancha: sin esta
// salida se quedarían sin aviso para siempre.
const HYPE_NO_TEAMS_FALLBACK_MS = 60 * 60 * 1000

// Fisher-Yates in-place, alcanza para listas de ~10-20 jugadores por partido.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

async function runMatchHypeNotify() {
  const db = admin.firestore()
  const now = new Date()
  const windowStart = admin.firestore.Timestamp.fromDate(new Date(now.getTime() + HYPE_MIN_LEAD_MS))
  const windowEnd = admin.firestore.Timestamp.fromDate(new Date(now.getTime() + HYPE_MAX_LEAD_MS))

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
    if (match.hypeMsgSent) continue

    const regsSnap = await docSnap.ref.collection('registrations').get()
    // SOLO titulares con cuenta: el suplente puede no llegar a jugar, y los
    // invitados sin cuenta no tienen historial ni a dónde recibir el aviso.
    const players = regsSnap.docs
      .map((d) => d.data())
      .filter((r) => r.userId && r.isOnWaitlist !== true)

    if (players.length < 2) continue

    // ── ¿Es el momento de avisar? ────────────────────────────────────────
    // El aviso quiere decir "hoy jugás CON este y CONTRA este otro", y eso
    // recién se sabe cuando están los equipos. Tres caminos:
    //   1. Equipos armados y quietos hace rato  → se avisa con equipos.
    //   2. Equipos armados recién / moviéndose  → se espera (se reintenta en
    //      el próximo tick; NO se marca hypeMsgSent).
    //   3. Falta poco y no hay equipos          → se avisa igual, pero solo
    //      con rachas personales, que no afirman nada sobre la formación.
    const msUntilMatch = (match.date?.toMillis?.() ?? 0) - now.getTime()
    const teamsAssignedAt = match.teamsAssignedAt?.toMillis?.() ?? null
    const teamsSettled =
      teamsAssignedAt != null && now.getTime() - teamsAssignedAt >= HYPE_TEAMS_DEBOUNCE_MS
    const outOfTime = msUntilMatch <= HYPE_NO_TEAMS_FALLBACK_MS

    if (!teamsSettled && !outOfTime) {
      logger.info(
        `runMatchHypeNotify: ${matchId} en espera (equipos ${teamsAssignedAt ? 'recién tocados' : 'sin armar'}, ` +
        `faltan ${Math.round(msUntilMatch / 60000)} min)`,
      )
      continue
    }

    // Con los equipos quietos el mensaje puede afirmar la formación de hoy;
    // sin ellos se cae a lo personal (la racha de cada uno).
    const useTeams = teamsSettled

    // Se marca ANTES de mandar, mismo criterio que el resto de las colas: un
    // fallo a mitad de camino no debe reintentar de punta a punta al minuto
    // siguiente y duplicar avisos a quien ya le llegó.
    await docSnap.ref.update({ hypeMsgSent: true })

    // 1) Armar el mensaje de CADA candidato sin mandar nada todavía — recién
    // acá se sabe cuántos calificaron de verdad, que es lo que define el cupo.
    const candidates = []
    for (const player of players) {
      try {
        const others = players.filter((p) => p.userId !== player.userId)
        const message = await buildHypeMessage(player.userId, others, {
          useTeams,
          myTeam: player.team ?? null,
        })
        if (message) candidates.push({ player, message })
      } catch (error) {
        logger.error(`runMatchHypeNotify: falló armar el hype de ${player.userId} en ${matchId}`, error)
      }
    }

    // 2) Cupo proporcional a los TITULARES (no a los calificados): con 14
    // titulares el tope es 8 aunque calificaran los 14. Mínimo 1 para que un
    // partido chico no se quede sin ningún aviso.
    const quota = Math.max(1, Math.round(players.length * HYPE_SHARE_OF_PLAYERS))
    const chosen = shuffle(candidates).slice(0, quota)

    let sent = 0
    for (const { player, message } of chosen) {
      try {
        await sendFCMToUser(
          player.userId,
          message.title,
          message.body,
          { matchId, type: 'match_hype' },
        )
        sent += 1
      } catch (error) {
        logger.error(`runMatchHypeNotify: falló el envío a ${player.userId} en ${matchId}`, error)
      }
    }
    logger.info(
      `runMatchHypeNotify: ${matchId} → ${sent}/${quota} enviados ` +
      `(${candidates.length} calificaban de ${players.length} titulares, ` +
      `${useTeams ? 'con equipos armados' : 'sin equipos: solo rachas'})`,
    )
  }
}

// ── Helper: armar la frase de hype de UN jugador para SU partido de hoy ──────
// Prioridad 1: cruce "vs" (rivalry o chemistry) contra alguien de la MISMA
// lista con historial suficiente — es lo más específico del partido de hoy.
// Si hay varios candidatos que alcanzan el piso, se toma el de más partidos
// en común (el vínculo más "cargado" de datos, no el primero que aparezca).
// Prioridad 2 (fallback): racha personal, sin cruce con nadie en particular.
async function buildHypeMessage(userId, others, { useTeams = false, myTeam = null } = {}) {
  const db = admin.firestore()

  // Sin equipos armados no se puede afirmar quién es compañero y quién rival,
  // así que no se busca ningún cruce: se va derecho a la racha personal, que
  // es cierta sin importar cómo se repartan después. Antes esto no se
  // distinguía y el mensaje decía "hoy jugás con Fulano" mirando SOLO el
  // historial — o sea que la mitad de las veces Fulano terminaba en el equipo
  // de enfrente y la app quedaba mintiendo.
  if (!useTeams || !myTeam) return buildStreakMessage(userId)

  let bestRival = null
  let bestChem = null

  for (const other of others) {
    // El cruce tiene que ser el de HOY: rival = está en el otro equipo,
    // compañero = está en el mío. Quien no tenga equipo asignado queda afuera.
    if (!other.team) continue
    const isRivalToday = other.team !== myTeam
    const [rivSnap, chemSnap] = await Promise.all([
      db.collection('users').doc(userId).collection('rivalry').doc(other.userId).get(),
      db.collection('users').doc(userId).collection('chemistry').doc(other.userId).get(),
    ])

    if (isRivalToday && rivSnap.exists) {
      const r = rivSnap.data()
      if ((r.gamesAgainst ?? 0) >= MIN_HEAD_TO_HEAD_MATCHES) {
        if (!bestRival || r.gamesAgainst > bestRival.data.gamesAgainst) {
          bestRival = { name: other.displayName || other.guestName || 'ese rival', data: r }
        }
      }
    }
    if (!isRivalToday && chemSnap.exists) {
      const c = chemSnap.data()
      if ((c.gamesTogether ?? 0) >= MIN_HEAD_TO_HEAD_MATCHES) {
        if (!bestChem || c.gamesTogether > bestChem.data.gamesTogether) {
          bestChem = { name: other.displayName || other.guestName || 'ese compañero', data: c }
        }
      }
    }
  }

  // Entre rival y compañero, el que tenga más partidos en común gana — es el
  // vínculo con más "peso estadístico" para hoy.
  if (bestRival && (!bestChem || bestRival.data.gamesAgainst >= bestChem.data.gamesTogether)) {
    const { name, data } = bestRival
    const winRate = data.winsAgainst / data.gamesAgainst
    if (winRate >= 0.5) {
      return {
        title: '🔥 Hoy tenés revancha',
        body: `Tenés enfrente a ${name}. Le ganaste ${data.winsAgainst} de las últimas ${data.gamesAgainst}. Que no se entere.`,
      }
    }
    return {
      title: '😬 Hoy se corta la mala',
      body: `Tenés enfrente a ${name}. Contra él/ella perdés seguido (${data.lossesAgainst} de ${data.gamesAgainst}). Hoy es el día.`,
    }
  }

  if (bestChem) {
    const { name, data } = bestChem
    const winRate = data.winsTogether / data.gamesTogether
    if (winRate >= 0.5) {
      return {
        title: '🤝 Buena dupla',
        body: `Hoy jugás con ${name}. Juntos ganan ${data.winsTogether} de ${data.gamesTogether}. No la cortes.`,
      }
    }
    return {
      title: '🎯 A cambiar la historia',
      body: `Hoy jugás con ${name}. Juntos les cuesta ganar (${data.winsTogether} de ${data.gamesTogether}). A ver si hoy es distinto.`,
    }
  }

  // Fallback: racha personal, sin cruce con nadie de la lista.
  return buildStreakMessage(userId)
}

// ── Helper: el mensaje "personal", el que no depende de con quién juega ──────
// Es el fallback de buildHypeMessage y, cuando los equipos no se armaron, el
// ÚNICO mensaje posible: una racha es cierta sin importar cómo se reparta la
// cancha. Devuelve null si el jugador todavía no tiene rachas calculadas
// (se llenan con el primer resultado que se carga después del deploy) o si
// ninguna alcanza para decir algo.
async function buildStreakMessage(userId) {
  const db = admin.firestore()
  const userSnap = await db.collection('users').doc(userId).get()
  const streaks = userSnap.data()?.streaks
  if (!streaks) return null

  if ((streaks.lossStreak ?? 0) >= 3) {
    return {
      title: '😤 Hoy se corta',
      body: `Venís de ${streaks.lossStreak} derrotas seguidas. Hoy es el día de cortarla.`,
    }
  }
  if ((streaks.goallessStreak ?? 0) >= 3 && (streaks.noWinStreak ?? 0) === 0) {
    return {
      title: '⚽ Se te está por cortar',
      body: `${streaks.goallessStreak} partidos sin convertir. Ponete las pilas hoy.`,
    }
  }
  if ((streaks.goallessStreak ?? 0) === 0 && (streaks.noWinStreak ?? 0) >= 2) {
    return {
      title: '🤔 ¿Sos de esos jugadores?',
      body: `Venís haciendo goles pero el equipo no gana. Hoy cambiá el cassette.`,
    }
  }
  if ((streaks.matchesPlayedStreak ?? 0) >= 4) {
    return {
      title: '💪 De los que siempre están',
      body: `Ya llevás ${streaks.matchesPlayedStreak} partidos jugados. Hoy, uno más.`,
    }
  }

  return null
}

// ── 5b3. Scheduled: recordatorio post-partido a las 3hs de terminado ─────────
// Corre cada 10 min. Para cada partido `finished` cuyo `finishedAt` cae en la
// ventana [ahora-3h20m, ahora-3h] (el margen de 20 min cubre que esta tarea
// solo se fija cada 10 min, no debe "saltarse" el partido entre corridas), y
// que todavía no se avisó (`postMatchReminderSent`), notifica a quienes
// jugaron de verdad: inscriptos con `userId` (invitados sin cuenta no votan
// ni cargan stats) y `isOnWaitlist === false` (un suplente que no llegó a
// entrar no tiene nada que cargar ni a quién votar). Un solo aviso cubre las
// tres acciones pendientes — cargar stats, votar MVP, votar Muralla — porque
// las tres dependen del mismo resultado ya cargado y separarlas en tres pushes
// sería ruido por lo mismo.
async function runPostMatchReminder() {
  const db = admin.firestore()
  const now = new Date()
  const windowStart = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 3.33 * 60 * 60 * 1000))
  const windowEnd = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 3 * 60 * 60 * 1000))

  const snap = await db
    .collection('matches')
    .where('status', '==', 'finished')
    .where('finishedAt', '>=', windowStart)
    .where('finishedAt', '<=', windowEnd)
    .get()

  if (snap.empty) return

  for (const docSnap of snap.docs) {
    const match = docSnap.data()
    const matchId = docSnap.id

    if (match.postMatchReminderSent) continue

    const regsSnap = await docSnap.ref.collection('registrations').get()
    const playerUserIds = regsSnap.docs
      .map((d) => d.data())
      .filter((r) => r.userId && r.isOnWaitlist === false)
      .map((r) => r.userId)

    // Se marca ANTES de mandar, mismo criterio que el resto de las colas.
    await docSnap.ref.update({ postMatchReminderSent: true })

    if (playerUserIds.length === 0) continue

    const title = '📋 Che, faltan datos del partido'
    const body = `Cargá tus estadísticas y votá MVP y Muralla de "${match.title ?? 'el partido'}".`
    let sent = 0
    for (const userId of playerUserIds) {
      try {
        await sendFCMToUser(userId, title, body, { matchId, type: 'post_match_reminder' })
        sent += 1
      } catch (error) {
        logger.error(`runPostMatchReminder: falló el envío a ${userId} en ${matchId}`, error)
      }
    }
    logger.info(`runPostMatchReminder: ${matchId} → ${sent}/${playerUserIds.length} avisos enviados`)
  }
}

// ── 5c. Scheduled: auto-cerrar resultado/votaciones a las 36hs ───────────────
// Corre cada hora. Un partido 'finished' hace más de 36hs (desde finishedAt,
// que se fija UNA sola vez) deja de ser editable por el cliente común: cierra
// las votaciones de MVP y Muralla que sigan abiertas, y marca resultLocked:true
// recién cuando AMBAS quedaron cerradas — así un solo `update` final bloquea
// el resultado, en vez de que cada votación pise el `lockResult` de la otra
// con dos writes separados. Un admin global siempre puede seguir editando
// después de esto.
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
        if (match.mvpVotingClosed !== true) await closeVotingForMatch('mvp', docSnap.id)
        if (match.murallaVotingClosed !== true) await closeVotingForMatch('muralla', docSnap.id)

        await docSnap.ref.update({
          resultLocked: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        logger.info(`processAutoCloseMatches: ${docSnap.id} bloqueado (finishedAt hace más de 36hs)`)
      } catch (error) {
        logger.error(`processAutoCloseMatches: error en ${docSnap.id}`, error)
      }
    }
  }
}

// ── Despachador único de tareas periódicas ───────────────────────────────────
// ── 5b. Premios mensuales (insignias) ────────────────────────────────────────
//
// El primero de cada mes se calculan los ganadores del mes que acaba de
// cerrar, por grupo, y se les otorga una insignia PERMANENTE.
//
// Por qué no es un job propio de Cloud Scheduler con cron '0 3 1 * *':
// el proyecto tiene 3 jobs gratis y ya usa uno solo a propósito (ver el
// comentario de SCHEDULED_TASKS). Gastar otro job en algo que corre 12 veces
// al año no se paga. En cambio, el despachador —que ya corre igual— mira el
// almanaque antes de trabajar.
//
// La garantía de "una sola entrega" NO la da el reloj sino el CENTINELA
// `_badgeAwards/{period}`: si ese documento existe, el mes ya se premió y la
// tarea sale sin hacer nada. Eso cubre lo que el reloj solo no puede:
//   · si la corrida de las 3am falla, la de las 4am completa el trabajo
//     (con un job mensual de una sola ejecución, ese mes se quedaba sin
//     premios hasta correrlo a mano);
//   · Cloud Scheduler entrega at-least-once, así que un disparo repetido
//     no premia ni notifica dos veces.

const BADGE_AWARDS_COLLECTION = '_badgeAwards'

// Piso de partidos jugados en el mes para poder ganar. Sin esto, la insignia
// se la lleva el que apareció UNA vez, metió 2 goles y no volvió — que es lo
// contrario de lo que el premio quiere reconocer.
const BADGE_MIN_MATCHES = 2

// Qué se premia. `field` es el campo de playerStats que se suma; `mvp` es
// booleano y se cuenta como 1/0.
//
// ⚠️ Las claves tienen que coincidir con BADGE_TYPES en src/utils/badges.js,
// que es quien las dibuja. Acá se decide QUIÉN gana; allá, cómo se ve.
const BADGE_DEFS = [
  { type: 'topScorer',  field: 'goals',   label: 'Botín de Oro',   unit: ['gol', 'goles'] },
  { type: 'topAssists', field: 'assists', label: 'Pies de Seda',  unit: ['asistencia', 'asistencias'] },
  { type: 'topMvp',     field: 'mvp',     label: 'Figura del Mes', unit: ['MVP', 'MVPs'] },
  { type: 'topMuralla', field: 'muralla', label: 'Muralla del Mes', unit: ['partido', 'partidos'] },
]

// "Presente" no compite: no es "el que más X" sino una CONDICIÓN — jugó todos
// los partidos que tuvo el grupo en el mes. Por eso la ganan varios a la vez,
// a diferencia de las de arriba, donde el empate deja la insignia vacante.
//
// Existe para que la vitrina no sea siempre del mismo delantero: el que nunca
// falta sostiene al grupo tanto como el que hace goles, y hasta ahora no tenía
// nada que mostrar.
const PRESENT_BADGE = { type: 'alwaysThere', label: 'Presente', unit: ['partido', 'partidos'] }

// Piso de partidos que el GRUPO tiene que haber jugado para que "Presente"
// signifique algo: con un solo partido en el mes, el que fue una vez no tiene
// mérito de constancia.
const PRESENT_MIN_GROUP_MATCHES = 3

/** Date → '2026-08' (la CLAVE del período, no un instante). */
function periodKeyOf(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * Ventana [inicio, fin) del mes ANTERIOR al que contiene `now`, en UTC.
 * Se devuelve como rango semiabierto para que un partido guardado justo a
 * medianoche del día 1 caiga en un solo mes y no en los dos.
 */
function previousMonthWindow(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return { start, end, period: periodKeyOf(start) }
}

/**
 * Tarea mensual: otorga las insignias del mes cerrado y avisa.
 * La despacha processScheduledTasks cuando es día 1 (ver SCHEDULED_TASKS).
 */
async function runMonthlyBadges() {
  const db = admin.firestore()
  const now = new Date()
  const { start, end, period } = previousMonthWindow(now)

  // Centinela: ¿este período ya se premió?
  const sentinelRef = db.collection(BADGE_AWARDS_COLLECTION).doc(period)
  const sentinelSnap = await sentinelRef.get()
  if (sentinelSnap.exists) return

  logger.info(`runMonthlyBadges: calculando premios de ${period}`)

  // Un solo barrido de playerStats del mes. `savedAt` ya existía en el schema,
  // así que esto funciona retroactivamente con todo el historial: no hizo
  // falta agregar ningún campo nuevo para poder cortar por mes.
  const statsSnap = await db
    .collectionGroup('playerStats')
    .where('savedAt', '>=', admin.firestore.Timestamp.fromDate(start))
    .where('savedAt', '<', admin.firestore.Timestamp.fromDate(end))
    .get()

  if (statsSnap.empty) {
    logger.info(`runMonthlyBadges: ${period} sin partidos, no hay premios`)
    await sentinelRef.set({
      period,
      awardedAt: admin.firestore.FieldValue.serverTimestamp(),
      badgesAwarded: 0,
      groupsProcessed: 0,
    })
    return
  }

  // Acumulado por grupo → usuario. Los partidos sin grupo (groupId null) no
  // participan: una insignia sin grupo no tiene contra quién competir.
  const byGroup = new Map()
  for (const docSnap of statsSnap.docs) {
    const st = docSnap.data()
    const groupId = st.groupId ?? null
    const userId = st.userId ?? null
    if (!groupId || !userId) continue

    // El id del partido es el ABUELO del doc: playerStats/{uid} cuelga de
    // matches/{matchId}. Se necesita para contar cuántos partidos distintos
    // tuvo el grupo en el mes (denominador de "Presente").
    const matchId = docSnap.ref.parent.parent?.id ?? null

    if (!byGroup.has(groupId)) byGroup.set(groupId, { users: new Map(), matchIds: new Set() })
    const bucket = byGroup.get(groupId)
    if (matchId) bucket.matchIds.add(matchId)
    const users = bucket.users
    const acc = users.get(userId) ?? {
      userId,
      displayName: st.displayName ?? 'Jugador',
      goals: 0,
      assists: 0,
      mvp: 0,
      muralla: 0,
      matches: 0,
    }
    acc.goals += Number(st.goals) || 0
    acc.assists += Number(st.assists) || 0
    acc.mvp += st.mvp === true ? 1 : 0
    acc.muralla += st.muralla === true ? 1 : 0
    acc.matches += 1
    // El nombre más reciente gana: si se cambió el apodo, que el premio lo use.
    if (st.displayName) acc.displayName = st.displayName
    users.set(userId, acc)
  }

  let badgesAwarded = 0
  const winnersByUser = new Map()   // userId → [{ def, value, groupName }]
  const podiumByGroup = new Map()   // groupId → { groupName, podium }

  for (const [groupId, { users, matchIds }] of byGroup.entries()) {
    const groupSnap = await db.collection('groups').doc(groupId).get()
    if (!groupSnap.exists) continue
    const groupName = groupSnap.data()?.name ?? 'tu grupo'

    // Solo compiten los que llegaron al piso de partidos.
    const eligible = [...users.values()].filter((u) => u.matches >= BADGE_MIN_MATCHES)
    if (eligible.length === 0) continue

    const podium = []

    for (const def of BADGE_DEFS) {
      let best = null
      let tied = false
      for (const u of eligible) {
        const value = u[def.field] || 0
        if (value <= 0) continue
        if (!best || value > best[def.field]) {
          best = u
          tied = false
        } else if (value === best[def.field]) {
          tied = true
        }
      }

      // Empate = nadie gana. Repartir la misma insignia entre tres personas
      // la devalúa, y elegir "el primero que apareció" sería arbitrario.
      if (!best || tied) continue

      const value = best[def.field]
      const badgeId = `${period}_${def.type}_${groupId}`
      const badge = {
        type: def.type,
        groupId,
        groupName,
        period,
        value,
        wonAt: admin.firestore.FieldValue.serverTimestamp(),
      }

      // El id compuesto hace la escritura idempotente POR CONSTRUCCIÓN: si la
      // tarea se repitiera, el set pisa el mismo doc en vez de duplicar.
      await db
        .collection('users')
        .doc(best.userId)
        .collection('badges')
        .doc(badgeId)
        .set(badge)

      badgesAwarded += 1

      const list = winnersByUser.get(best.userId) ?? []
      list.push({ def, value, groupId, groupName, winnerName: best.displayName })
      winnersByUser.set(best.userId, list)

      podium.push({
        label: def.label,
        name: best.displayName,
        value,
        unit: value === 1 ? def.unit[0] : def.unit[1],
      })
    }

    // ── Presente ──────────────────────────────────────────────────────────
    // Se la llevan TODOS los que jugaron los partidos que tuvo el grupo. No
    // es competitiva, así que no aplica la regla del empate ni el piso
    // individual de BADGE_MIN_MATCHES: acá el piso es del grupo.
    //
    // A propósito NO entra en `podium`: el palmarés que se manda al grupo
    // lista un ganador por categoría, y Presente pueden ganarla ocho personas
    // — la volvería un párrafo. El ganador igual recibe su push personal.
    const groupMatches = matchIds.size
    if (groupMatches >= PRESENT_MIN_GROUP_MATCHES) {
      for (const u of users.values()) {
        if (u.matches < groupMatches) continue

        const badgeId = `${period}_${PRESENT_BADGE.type}_${groupId}`
        await db
          .collection('users')
          .doc(u.userId)
          .collection('badges')
          .doc(badgeId)
          .set({
            type: PRESENT_BADGE.type,
            groupId,
            groupName,
            period,
            value: groupMatches,
            wonAt: admin.firestore.FieldValue.serverTimestamp(),
          })

        badgesAwarded += 1

        const list = winnersByUser.get(u.userId) ?? []
        list.push({ def: PRESENT_BADGE, value: groupMatches, groupId, groupName, winnerName: u.displayName })
        winnersByUser.set(u.userId, list)
      }
    }

    if (podium.length > 0) podiumByGroup.set(groupId, { groupName, podium })
  }

  // El centinela se escribe ANTES de notificar, a propósito: si el envío de
  // pushes falla a la mitad, el reintento de la hora siguiente no vuelve a
  // otorgar ni a avisarle de nuevo al que ya se enteró. Un premio perdido en
  // el aire es mejor que un premio duplicado.
  await sentinelRef.set({
    period,
    awardedAt: admin.firestore.FieldValue.serverTimestamp(),
    badgesAwarded,
    groupsProcessed: byGroup.size,
  })

  logger.info(`runMonthlyBadges: ${period} → ${badgesAwarded} insignias en ${byGroup.size} grupos`)

  // ── Avisos ────────────────────────────────────────────────────────────────
  // 1) Al ganador, uno personal por cada insignia que se llevó (push + evento
  // de feed, así queda constancia en el timeline del grupo aunque el push se
  // haya perdido o esté silenciado).
  for (const [userId, wins] of winnersByUser.entries()) {
    for (const win of wins) {
      const unit = win.value === 1 ? win.def.unit[0] : win.def.unit[1]
      try {
        await sendFCMToUser(
          userId,
          win.def.type === PRESENT_BADGE.type
            ? '🎖️ ¡Te ganaste la medalla de Presente!'
            : `🏆 ¡Ganaste el ${win.def.label}!`,
          win.def.type === PRESENT_BADGE.type
            ? `No faltaste a ninguno de los ${win.value} partidos de ${win.groupName}.`
            : `${win.value} ${unit} en ${win.groupName}. Ya está en tu perfil.`,
          { type: 'badge_awarded', badgeType: win.def.type, period },
          NOTIFICATION_CATEGORIES.BADGES,
        )
      } catch (error) {
        logger.error(`runMonthlyBadges: falló el aviso a ${userId}`, error)
      }
    }
  }

  // 2) Al grupo, el palmarés — que es lo que genera la charla en el vestuario.
  for (const [groupId, { groupName, podium }] of podiumByGroup.entries()) {
    const body = podium.map((p) => `${p.label}: ${p.name} (${p.value} ${p.unit})`).join(' · ')
    try {
      await sendFCMToGroupMembers(
        groupId,
        `Los premios de ${groupName}`,
        body,
        { type: 'badges_podium', groupId, period },
        [],
        NOTIFICATION_CATEGORIES.BADGES,
      )
    } catch (error) {
      logger.error(`runMonthlyBadges: falló el palmarés de ${groupId}`, error)
    }
  }
}

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
//
// Una tarea declara CÓMO se agenda, de dos formas excluyentes:
//   · `everyMinutes`: ritmo fijo (el caso de siempre).
//   · `monthly: { day, hour }`: condición de ALMANAQUE. Existe porque "el
//     primero de cada mes" no se puede expresar como un intervalo — un mes no
//     dura una cantidad fija de minutos. Se evalúa una vez por hora dentro del
//     día indicado; la garantía de que el trabajo ocurra UNA sola vez es del
//     centinela de la propia tarea, no del reloj (ver runMonthlyBadges).
const SCHEDULED_TASKS = [
  { name: 'matchOpenQueue',     everyMinutes: 1,  run: runMatchOpenQueue },
  { name: 'matchOgNotifyQueue', everyMinutes: 1,  run: runMatchOgNotifyQueue },
  { name: 'matchReminderQueue', everyMinutes: 1,  run: runMatchReminderQueue },
  { name: 'lowSignupAlert',     everyMinutes: 10, run: runMatchLowSignupAlert },
  { name: 'matchHypeNotify',    everyMinutes: 10, run: runMatchHypeNotify },
  { name: 'postMatchReminder',  everyMinutes: 10, run: runPostMatchReminder },
  { name: 'autoCloseMatches',   everyMinutes: 60, run: runAutoCloseMatches },
  { name: 'monthlyBadges',      monthly: { day: 1, hour: 3 }, run: runMonthlyBadges },
]

/**
 * ¿Le toca correr a esta tarea en este instante?
 *
 * Las mensuales se chequean al minuto 0 de cada hora a partir de `hour`: si la
 * corrida de las 3am falla, la de las 4am reintenta y el centinela evita que
 * el trabajo se repita si la de las 3 sí había terminado.
 */
function taskIsDue(task, now, minuteOfEpoch) {
  if (task.monthly) {
    const { day = 1, hour = 3 } = task.monthly
    return (
      now.getUTCDate() === day &&
      now.getUTCHours() >= hour &&
      now.getUTCMinutes() === 0
    )
  }
  return minuteOfEpoch % task.everyMinutes === 0
}

exports.processScheduledTasks = onSchedule(
  { region: LOCATION, schedule: 'every 1 minutes' },
  async () => {
    const now = new Date()
    const minuteOfEpoch = Math.floor(now.getTime() / 60000)

    for (const task of SCHEDULED_TASKS) {
      if (!taskIsDue(task, now, minuteOfEpoch)) continue
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

// ── 7b. Callables: cerrar votación de MVP / Muralla y fijar el ganador ───────
// Cuenta matches/{matchId}/{votesCollection}, determina el ganador por
// mayoría simple (empate en el primer puesto → sin ganador) y escribe con
// Admin SDK los campos que le correspondan a cada votación. El write a
// playerStats sigue disparando onPlayerStatsWritten normalmente, que acumula
// stats.mvps/murallas por diferencia — no hace falta tocar ese trigger.
//
// MVP y Muralla ("mejor defensor") son la MISMA mecánica con distinto campo:
// en vez de duplicar 50 líneas casi idénticas dos veces, un solo helper
// parametrizado (`kind`) las resuelve — el comentario de arriba describe el
// flujo una sola vez para ambas.
const VOTING_KINDS = {
  mvp: {
    votesCollection: 'mvpVotes',
    userIdField: 'mvpUserId',
    nameField: 'mvpName',
    closedField: 'mvpVotingClosed',
    statsField: 'mvp',
  },
  muralla: {
    votesCollection: 'murallaVotes',
    userIdField: 'murallaUserId',
    nameField: 'murallaName',
    closedField: 'murallaVotingClosed',
    statsField: 'muralla',
  },
}

// ── Helper: cuenta los votos y fija el ganador de un partido ─────────────────
// Reusado por las callables closeMvpVoting/closeMurallaVoting (cierre manual)
// y por el scheduler runAutoCloseMatches (cierre automático a las 36hs). Si
// `lockResult` es true, además marca resultLocked:true en el mismo batch
// (auto-cierre) — solo tiene sentido pasarlo en la ÚLTIMA votación que cierra
// ese partido, para no pisar el batch de la otra.
async function closeVotingForMatch(kind, matchId, { lockResult = false } = {}) {
  const cfg = VOTING_KINDS[kind]
  const db = admin.firestore()
  const matchRef = db.collection('matches').doc(matchId)

  const votesSnap = await matchRef.collection(cfg.votesCollection).get()
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
    // Empate en el primer puesto → sin ganador (sin desempate manual/segunda vuelta)
    if (topCandidates.length === 1) winnerId = topCandidates[0][0]
  }

  let winnerName = null
  if (winnerId) {
    const statSnap = await matchRef.collection('playerStats').doc(winnerId).get()
    winnerName = statSnap.exists ? (statSnap.data().displayName ?? null) : null
  }

  const batch = db.batch()
  batch.update(matchRef, {
    [cfg.userIdField]: winnerId,
    [cfg.nameField]: winnerName,
    [cfg.closedField]: true,
    ...(lockResult ? { resultLocked: true } : {}),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  const statsSnap = await matchRef.collection('playerStats').get()
  statsSnap.docs.forEach((d) => {
    const isWinner = d.id === winnerId
    const wasWinner = d.data()[cfg.statsField] === true
    if (isWinner && !wasWinner) batch.update(d.ref, { [cfg.statsField]: true })
    if (!isWinner && wasWinner) batch.update(d.ref, { [cfg.statsField]: false })
  })

  await batch.commit()
  return { winnerId, winnerName, tally }
}

function makeCloseVotingCallable(kind) {
  const cfg = VOTING_KINDS[kind]
  return onCall({ region: LOCATION, invoker: 'public' }, async (request) => {
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
    if (match[cfg.closedField] === true) {
      throw new HttpsError('failed-precondition', 'La votación ya está cerrada.')
    }

    const { winnerId, winnerName, tally } = await closeVotingForMatch(kind, matchId)
    logger.info(`close${kind}Voting: ${matchId} → ganador=${winnerId ?? 'empate/sin votos'}`)
    return { success: true, winnerId, winnerName, tally: Object.fromEntries(tally) }
  })
}

exports.closeMvpVoting = makeCloseVotingCallable('mvp')
exports.closeMurallaVoting = makeCloseVotingCallable('muralla')

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
      const dMurallas = (after?.muralla === true ? 1 : 0) - (before?.muralla === true ? 1 : 0)
      // Resultado del jugador (W/E/L) guardado en la fila → contadores por diferencia
      const countRes = (row, code) => (row?.result === code ? 1 : 0)
      const dWins = countRes(after, 'W') - countRes(before, 'W')
      const dDraws = countRes(after, 'E') - countRes(before, 'E')
      const dLosses = countRes(after, 'L') - countRes(before, 'L')

      if (
        dGoals === 0 && dAssists === 0 && dPlayed === 0 && dMvps === 0 && dMurallas === 0 &&
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
        'stats.murallas': inc(dMurallas),
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
        updates[`statsByGroup.${groupId}.murallas`] = inc(dMurallas)
        updates[`statsByGroup.${groupId}.wins`] = inc(dWins)
        updates[`statsByGroup.${groupId}.draws`] = inc(dDraws)
        updates[`statsByGroup.${groupId}.losses`] = inc(dLosses)
      }

      // update() (no set/merge): las claves con punto son PATHS anidados.
      // increment() inicializa el campo si no existía. Los users siempre existen.
      await admin.firestore().collection('users').doc(userId).update(updates)
      logger.info(`Stats acumuladas para ${userId} (Δg=${dGoals}, Δa=${dAssists}, Δp=${dPlayed}, Δmvp=${dMvps}, Δmuralla=${dMurallas})`)

      // ── Mundial personal: avanza de fase con el PRIMER resultado cargado ───
      // Gate por beforeResult == null (no por afterResult !== beforeResult):
      // así una edición posterior del resultado (before ya tenía W/E/L) nunca
      // reprocesa el Mundial — el primer resultado cargado es el que cuenta.
      if (after?.result && before?.result == null) {
        await advancePlayerMundial(userId, after.result, event.params.matchId)
      }

      // ── Química/rivalidad por pares: ¿compartió o enfrentó equipo con otros
      // en este partido? Se dispara solo cuando la fila tiene team+result
      // definidos (resultado ya cargado). Compara antes/después contra cada
      // compañero de partido para sumar/restar por diferencia — mismo patrón
      // idempotente de arriba.
      const afterHasTeamResult = !!(after?.userId && after?.team && after?.result)
      const beforeHasTeamResult = !!(before?.userId && before?.team && before?.result)

      if (afterHasTeamResult || beforeHasTeamResult) {
        await updateChemistryForPlayerStat(event.params.matchId, userId, before, after)
      }

      // ── Rachas: solo con el PRIMER resultado cargado (mismo gate que el
      // Mundial) — una edición posterior no debe recalcular streaks a partir
      // de un estado ya consumido, porque no queda antes/después qué comparar
      // para un contador que depende de la SECUENCIA de partidos, no de un
      // delta puntual.
      if (after?.result && before?.result == null) {
        await updateStreaksForPlayerStat(userId)
      }
    } catch (error) {
      logger.error('onPlayerStatsWritten: error', error)
    }
  },
)

// ── Helper: actualizar química/rivalidad por pares tras un write en playerStats
// Lee los demás playerStats del mismo partido y, para cada otro jugador cuyo
// team+result cambió de relación respecto a `userId` (compañero si comparten
// team, rival si no), incrementa por diferencia (before → after) los
// contadores simétricos en users/{userId}/chemistry|rivalry/{other} Y
// users/{other}/chemistry|rivalry/{userId}. La rivalidad se guarda desde la
// perspectiva de CADA UNO (si A ganó y B perdió, wins de A y losses de B, no
// al revés). No hay orden garantizado entre triggers hermanos (cada
// playerStats dispara su propio evento), pero cada incremento es atómico y
// todos convergen al mismo estado final — aceptable acá.
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

  const opposite = { W: 'L', L: 'W', E: 'E' }

  for (const other of siblings) {
    const wasSameTeamBefore = !!(before?.team && before?.result && before.team === other.team)
    const isSameTeamAfter = !!(after?.team && after?.result && after.team === other.team)
    const wasDiffTeamBefore = !!(before?.team && before?.result && before.team !== other.team)
    const isDiffTeamAfter = !!(after?.team && after?.result && after.team !== other.team)

    // Compañeros (mismo equipo) → chemistry
    if (wasSameTeamBefore !== isSameTeamAfter) {
      const sign = isSameTeamAfter ? 1 : -1
      const result = isSameTeamAfter ? after.result : before.result
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

    // Rivales (equipo distinto) → rivalry, cada uno desde su propia perspectiva
    if (wasDiffTeamBefore !== isDiffTeamAfter) {
      const sign = isDiffTeamAfter ? 1 : -1
      const resultA = isDiffTeamAfter ? after.result : before.result
      const resultB = opposite[resultA]
      const payloadA = {
        gamesAgainst: inc(sign),
        winsAgainst: inc(resultA === 'W' ? sign : 0),
        drawsAgainst: inc(resultA === 'E' ? sign : 0),
        lossesAgainst: inc(resultA === 'L' ? sign : 0),
        lastPlayedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      const payloadB = {
        gamesAgainst: inc(sign),
        winsAgainst: inc(resultB === 'W' ? sign : 0),
        drawsAgainst: inc(resultB === 'E' ? sign : 0),
        lossesAgainst: inc(resultB === 'L' ? sign : 0),
        lastPlayedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      const rivRefA = db.collection('users').doc(userId).collection('rivalry').doc(other.userId)
      const rivRefB = db.collection('users').doc(other.userId).collection('rivalry').doc(userId)
      batch.set(rivRefA, payloadA, { merge: true })
      batch.set(rivRefB, payloadB, { merge: true })
      hasChanges = true
    }
  }

  if (hasChanges) await batch.commit()
}

// ── Helper: recalcular rachas de un jugador con su primer resultado cargado ─
// Mira los últimos playerStats del jugador (collectionGroup, ordenado por
// savedAt desc) para reconstruir la racha actual desde cero — más simple y
// más robusto que ir sumando/restando por diferencia (un streak se corta o
// sigue según TODA la secuencia, no según un único delta). Limitado a 40
// partidos recientes: ninguna racha real de un picado amateur llega a eso, y
// evita una lectura sin techo si el historial crece mucho.
async function updateStreaksForPlayerStat(userId) {
  const db = admin.firestore()
  const recentSnap = await db
    .collectionGroup('playerStats')
    .where('userId', '==', userId)
    .orderBy('savedAt', 'desc')
    .limit(40)
    .get()

  const rows = recentSnap.docs.map((d) => d.data()).filter((s) => s.result)
  if (rows.length === 0) return

  const countLeadingWhile = (predicate) => {
    let n = 0
    for (const row of rows) {
      if (!predicate(row)) break
      n += 1
    }
    return n
  }

  const streaks = {
    matchesPlayedStreak: rows.length, // ya filtramos por result presente = jugó
    goallessStreak: countLeadingWhile((r) => (r.goals ?? 0) === 0),
    noWinStreak: countLeadingWhile((r) => r.result !== 'W'),
    lossStreak: countLeadingWhile((r) => r.result === 'L'),
  }

  await db.collection('users').doc(userId).update({
    streaks,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
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
      goals: 0, assists: 0, matchesPlayed: 0, mvps: 0, murallas: 0, wins: 0, draws: 0, losses: 0,
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
        t.murallas += s.muralla === true ? 1 : 0
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

        // Resincronizar el contador con la lista real. `currentPlayers` lo
        // decrementa el cliente en la misma transacción que borra la
        // inscripción, pero si una baja entra por otra vía (la consola de
        // Firebase, un script) el contador queda inflado — y como es él quien
        // asigna `position` en el alta, las inscripciones siguientes arrancan
        // con un número adelantado y la lista queda con huecos. Acá ya tenemos
        // la verdad (`regsSnap.size`, después del borrado) y escribirla es
        // idempotente: si ya coincidía, no cambia nada.
        if ((match.currentPlayers ?? 0) !== regsSnap.size) {
          logger.warn(
            `onRegistrationDeleted: currentPlayers desfasado en ${matchId} ` +
            `(${match.currentPlayers} → ${regsSnap.size}), se corrige`,
          )
          tx.update(matchRef, { currentPlayers: regsSnap.size })
        }

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

// ─────────────────────────────────────────────────────────────────────────────
//  POSTULACIONES A PARTIDOS PÚBLICOS
// ─────────────────────────────────────────────────────────────────────────────

// ── Alguien se postuló: avisar a los que ya están anotados ───────────────────
// El sondeo (pulgar arriba/abajo) es consultivo: decide el organizador. Esto
// existe para que el resto del equipo se entere de que va a jugar un
// desconocido y pueda opinar antes, no después.
exports.onApplicationCreated = onDocumentCreated(
  { region: LOCATION, document: 'matches/{matchId}/applications/{applicantId}' },
  async (event) => {
    try {
      const { matchId } = event.params
      const application = event.data?.data() ?? {}
      const db = admin.firestore()

      const matchSnap = await db.collection('matches').doc(matchId).get()
      if (!matchSnap.exists) return
      const match = matchSnap.data()

      const applicantName = application.applicantName || 'Alguien'
      const title = '⚽ Alguien quiere sumarse'
      const body = `${applicantName} se postuló para jugar "${match.title ?? 'el partido'}". Mirá su perfil.`

      // A los que YA están anotados (son los que van a jugar con esta persona).
      // Al organizador le llega igual: también está en la lista.
      const registeredUserIds = await getRegisteredUserIds(matchId)
      const notified = new Set(registeredUserIds)
      // El creador puede no estar anotado todavía y es quien decide.
      if (match.createdBy) notified.add(match.createdBy)

      for (const uid of notified) {
        await sendFCMToUser(
          uid,
          title,
          body,
          { matchId, type: 'match_application', applicantId: application.applicantId ?? '' },
          NOTIFICATION_CATEGORIES.APPLICATIONS,
        )
      }

      logger.info(
        `onApplicationCreated: ${applicantName} → match ${matchId} (avisados ${notified.size})`,
      )
    } catch (error) {
      logger.error('onApplicationCreated: error', error)
    }
  },
)

// ── Postulación resuelta: si la aceptaron, inscribir de verdad ───────────────
// La inscripción NO la escribe el cliente: acá se corre la MISMA transacción de
// cupos que useRegistration.registerEntry (leer currentPlayers → calcular
// posición → escribir registration + contador), para que un alta por
// postulación no pueda pasarse de maxPlayers ni pisar posiciones bajo
// concurrencia.
exports.onApplicationResolved = onDocumentUpdated(
  { region: LOCATION, document: 'matches/{matchId}/applications/{applicantId}' },
  async (event) => {
    try {
      const before = event.data.before.data() ?? {}
      const after = event.data.after.data() ?? {}
      if (before.status === after.status) return

      const { matchId, applicantId } = event.params
      const db = admin.firestore()

      const matchSnap = await db.collection('matches').doc(matchId).get()
      if (!matchSnap.exists) return
      const matchTitle = matchSnap.data().title ?? 'el partido'

      // ── Rechazada o retirada: solo se avisa (si la retiró él mismo, no) ────
      if (after.status === 'rejected') {
        await sendFCMToUser(
          applicantId,
          'Postulación rechazada',
          `Esta vez no entraste a "${matchTitle}". ¡Buscá otro partido!`,
          { matchId, type: 'application_rejected' },
          NOTIFICATION_CATEGORIES.APPLICATIONS,
        )
        return
      }

      if (after.status !== 'accepted') return

      // ── Aceptada: crear la inscripción real ───────────────────────────────
      const matchRef = db.collection('matches').doc(matchId)
      const regRef = matchRef.collection('registrations').doc(applicantId)

      const result = await db.runTransaction(async (tx) => {
        const [freshMatch, existingReg] = await Promise.all([
          tx.get(matchRef),
          tx.get(regRef),
        ])
        if (!freshMatch.exists) return null
        // Ya estaba anotado (doble aceptación, reintento del trigger): no
        // duplicar ni volver a mover el contador.
        if (existingReg.exists) return null

        const match = freshMatch.data()
        if (match.status === 'closed' || match.status === 'finished') return null

        const currentCount = match.currentPlayers ?? 0
        const newPosition = currentCount + 1
        const isOnWaitlist = match.maxPlayers != null && newPosition > match.maxPlayers

        // Si esta aceptación llena el último cupo, se despublica en la misma
        // escritura — sin esto, un partido lleno seguía recibiendo
        // postulaciones hasta que alguien entrara a despublicarlo a mano.
        const justFilled = !isOnWaitlist && match.maxPlayers != null && newPosition >= match.maxPlayers
        tx.update(matchRef, {
          currentPlayers: newPosition,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(justFilled && match.isPublic ? { isPublic: false } : {}),
        })

        tx.set(regRef, {
          userId: applicantId,
          displayName: after.applicantName || 'Jugador',
          photoURL: after.applicantPhotoURL ?? null,
          isGuest: false,
          guestName: null,
          addedBy: after.resolvedBy ?? match.createdBy ?? applicantId,
          addedByName: null,
          registeredAt: admin.firestore.FieldValue.serverTimestamp(),
          position: newPosition,
          isOnWaitlist,
          team: null,
          // Marca de origen: entró por postulación, no lo anotó un compañero.
          viaApplication: true,
        })

        return { position: newPosition, isOnWaitlist, date: match.date ?? null }
      })

      if (!result) {
        logger.info(`onApplicationResolved: ${applicantId} ya estaba en ${matchId}, se omite`)
        return
      }

      await sendFCMToUser(
        applicantId,
        '🎉 ¡Te aceptaron!',
        result.isOnWaitlist
          ? `Entraste a "${matchTitle}" como suplente.`
          : `Ya estás anotado en "${matchTitle}".`,
        { matchId, type: 'application_accepted' },
        NOTIFICATION_CATEGORIES.APPLICATIONS,
      )

      await withdrawOverlappingApplications(db, applicantId, matchId, result.date)

      logger.info(`onApplicationResolved: ${applicantId} aceptado en ${matchId}`)
    } catch (error) {
      logger.error('onApplicationResolved: error', error)
    }
  },
)

// ── Mensaje nuevo en el chat de una postulación ──────────────────────────────
// Chat 1-a-1: el destinatario es siempre "el otro". Como son dos participantes
// y la conversación es de coordinación pura, cada mensaje SÍ le importa a quien
// lo recibe — a diferencia de un chat grupal del partido, que mandaría 13
// notificaciones irrelevantes por mensaje.
exports.onApplicationMessage = onDocumentCreated(
  {
    region: LOCATION,
    document: 'matches/{matchId}/applications/{applicantId}/messages/{messageId}',
  },
  async (event) => {
    try {
      const { matchId, applicantId } = event.params
      const msg = event.data?.data() ?? {}
      if (!msg.senderId) return

      const db = admin.firestore()
      const matchSnap = await db.collection('matches').doc(matchId).get()
      if (!matchSnap.exists) return
      const match = matchSnap.data()

      // El otro lado del chat: si escribió el postulante, avisar al organizador;
      // si escribió el organizador, avisar al postulante.
      const recipientId = msg.senderId === applicantId ? match.createdBy : applicantId
      if (!recipientId || recipientId === msg.senderId) return

      const preview = (msg.text ?? '').slice(0, 80)

      await sendFCMToUser(
        recipientId,
        `💬 ${msg.senderName || 'Mensaje nuevo'}`,
        preview,
        { matchId, type: 'application_message', applicantId },
        NOTIFICATION_CATEGORIES.CHAT,
      )

      logger.info(`onApplicationMessage: ${msg.senderId} → ${recipientId} (match ${matchId})`)
    } catch (error) {
      logger.error('onApplicationMessage: error', error)
    }
  },
)

// Al entrar a un partido, retira las postulaciones pendientes de esa persona a
// otros partidos que se SOLAPEN en horario. Solo las solapadas: postularse al
// sábado y al domingo es perfectamente válido y matarle la del domingo sería
// un bug.
const OVERLAP_WINDOW_MS = 2 * 60 * 60 * 1000 // ±2hs alrededor del partido aceptado

async function withdrawOverlappingApplications(db, applicantId, acceptedMatchId, acceptedDate) {
  if (!acceptedDate) return

  const acceptedMs = acceptedDate.toMillis?.() ?? 0
  if (!acceptedMs) return

  const pendingSnap = await db
    .collectionGroup('applications')
    .where('applicantId', '==', applicantId)
    .where('status', '==', 'pending')
    .get()

  const toWithdraw = []
  for (const docSnap of pendingSnap.docs) {
    const otherMatchId = docSnap.ref.parent.parent?.id
    if (!otherMatchId || otherMatchId === acceptedMatchId) continue

    const otherMatch = await db.collection('matches').doc(otherMatchId).get()
    if (!otherMatch.exists) continue

    const otherMs = otherMatch.data().date?.toMillis?.() ?? 0
    if (!otherMs) continue

    if (Math.abs(otherMs - acceptedMs) <= OVERLAP_WINDOW_MS) {
      toWithdraw.push(docSnap.ref)
    }
  }

  if (toWithdraw.length === 0) return

  const batch = db.batch()
  toWithdraw.forEach((ref) => {
    batch.update(ref, {
      status: 'withdrawn',
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
      resolvedBy: 'system',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  })
  await batch.commit()

  logger.info(
    `withdrawOverlappingApplications: ${applicantId} → ${toWithdraw.length} postulación(es) retirada(s) por solaparse`,
  )
}

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
  BADGES: 'badges',            // Premios del mes: ganaste una insignia / palmarés del grupo
}

// Defaults por categoría. Ver el comentario de arriba sobre por qué
// PUBLIC_NEARBY arranca en false.
const NOTIFICATION_DEFAULTS = {
  [NOTIFICATION_CATEGORIES.MY_GROUPS]: true,
  [NOTIFICATION_CATEGORIES.PUBLIC_NEARBY]: false,
  [NOTIFICATION_CATEGORIES.APPLICATIONS]: true,
  [NOTIFICATION_CATEGORIES.CHAT]: true,
  [NOTIFICATION_CATEGORIES.BADGES]: true,
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