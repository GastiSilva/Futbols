// Esquema de Firestore — YASTA PWA
// ─────────────────────────────────────────────────────────────────────────────
// Este archivo es solo documentación. No se ejecuta en runtime.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════
 *  COLECCIÓN: users
 *  Path: /users/{uid}
 * ══════════════════════════════════════════════════════════
 */
const UserSchema = {
  uid:         'string',          // = Firebase Auth UID
  displayName: 'string',
  email:       'string',
  photoURL:    'string | null',
  fcmToken:    'string | null',   // Token FCM para notificaciones push
  fcmTokens:   'string[]',        // Todos los tokens conocidos (dedupe en functions)
  role:        "'admin' | 'og' | 'player'", // Rol del usuario (default: 'player')

  // Qué categorías de push quiere recibir. Ausente = todas en su default
  // (ver NOTIFICATION_DEFAULTS en src/utils/notifications.js y su gemelo en
  // functions/index.js — las dos listas TIENEN que coincidir).
  // El filtro se aplica en collectTokensFromUserDocs, único punto por el que
  // pasan todos los envíos, así ninguna ruta se lo saltea.
  notificationPrefs: {
    myGroups:      'boolean',  // default true  — listas, recordatorios, cupos
    applications:  'boolean',  // default true  — postulaciones a partidos
    chat:          'boolean',  // default true  — mensajes del partido
    publicNearby:  'boolean',  // default FALSE — partidos públicos (opt-in)
  }, // | undefined

  // Perfil editable por el propio usuario (ProfilePage)
  nickname:      'string | null', // Apodo
  description:   'string',        // Descripción libre
  preferredFoot: "'derecho' | 'izquierdo' | 'ambidiestro' | null", // Pie hábil
  preferredPositions: 'string[]', // Posiciones favoritas (códigos de src/utils/positions.js:
                                  // ARQ, LTI, DFC, LTD, MCD, MI, MC, MD, MCO, EI, DC, ED). Máx 3.
                                  // Elegidas en ProfilePage con el selector visual de cancha.
  favoriteTeam:  'string | null', // Equipo de AFA del que es hincha (value de
                                  // src/utils/teams.js TEAM_OPTIONS). Solo Primera
                                  // División + una selección de Primera Nacional
                                  // (no hay fuente gratuita con el listado completo).

  stats: {
    goals:         'number',      // Goles acumulados en TODOS los partidos (total individual)
    assists:       'number',      // Asistencias acumuladas (total individual)
    matchesPlayed: 'number',      // Partidos jugados (total individual)
    mvps:          'number',      // Veces elegido MVP del partido
    wins:          'number',      // Partidos ganados (según result de cada playerStats)
    draws:         'number',      // Empatados
    losses:        'number',      // Perdidos
  },

  // Desglose de las mismas estadísticas, pero separadas por grupo.
  // Lo escribe ÚNICAMENTE la Cloud Function onPlayerStatsWritten (por diferencia)
  // cuando el partido tiene un groupId asociado.
  statsByGroup: {
    '[groupId]': {
      goals:         'number',
      assists:       'number',
      matchesPlayed: 'number',
      mvps:          'number',
    },
  },

  createdAt:   'Timestamp',
  updatedAt:   'Timestamp',

  // "Mundial personal" (ausente hasta la primera activación): modo de juego
  // individual y opcional. Cada jugador lo activa desde su perfil; avanza de
  // fase automáticamente con CUALQUIER partido real que juegue mientras está
  // activo (sin importar el grupo). Fase de grupos = primeros 3 resultados
  // reales (siempre se esperan los 3, nunca se corta antes). Solo la Cloud
  // Function onPlayerStatsWritten (avance) y revealMundialCoinFlip (desempate)
  // escriben las transiciones — el cliente únicamente puede ACTIVAR uno nuevo
  // (ver firestore.rules).
  mundial: {
    active:   'boolean',
    phase:    "'groups' | 'round_of_16' | 'quarter' | 'semi' | 'final' | 'champion' | 'eliminated'",
    startedAt: 'Timestamp | null',
    endedAt:   'Timestamp | null',
    groupMatchResults: "Array<'W'|'E'|'L'>", // hasta 3, en orden de carga
    // Ambigüedad (4 puntos en grupos, o empate en mata-mata): el `outcome` ya
    // queda decidido y congelado por la CF en el momento de detectarse — el
    // cliente solo lo revela con la animación de moneda (revealMundialCoinFlip).
    pendingCoinFlip: {
      kind:      "'groups_4pts' | 'knockout_draw'",
      seed:      'string',
      outcome:   "'advance' | 'eliminate'",
      matchId:   'string',
      resolved:  'boolean',
    }, // | null
    titles:      'number',  // Mundiales ganados (histórico)
    runsPlayed:  'number',  // Mundiales activados en total (histórico)
    lastResult:  "'champion' | 'eliminated_groups' | 'eliminated_knockout' | null",
    updatedAt:   'Timestamp',
  }, // | undefined
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: users/{uid}/descriptionRatings/{raterUid}
 *  Calificación privada (1-5) de si la descripción de {uid} es real.
 *  Un doc por calificador (docId = su uid), así puede actualizar su voto.
 *  Solo el calificador puede leer SU PROPIO doc — ni el dueño del perfil ni
 *  otros calificadores. El promedio lo calcula la Cloud Function
 *  onDescriptionRatingWritten y lo publica en users/{uid}/private/descriptionStars.
 *  Se borra entero (por otra Cloud Function, onUserDescriptionChanged) cada vez
 *  que el dueño edita su `description`.
 * ══════════════════════════════════════════════════════════
 */
const DescriptionRatingSchema = {
  stars:         'number',  // 1-5
  sharedGroupId: 'string',  // Grupo por el que calificador y calificado se
                            // conocen. OBLIGATORIO: las reglas verifican que
                            // AMBOS sean miembros de ese grupo. Solo se puede
                            // calificar a un compañero — un desconocido no
                            // tiene cómo saber si la descripción es real, y su
                            // voto sería un arma contra quien se postula desde
                            // afuera a un partido público.
  updatedAt:     'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: users/{uid}/private/descriptionStars
 *  Agregado de descriptionRatings. Único doc de esta subcolección hoy.
 *  read: solo el dueño (o admin) — es el único lugar donde Firestore puede
 *  ocultar este dato, ya que users/{uid} en sí es legible por cualquier
 *  autenticado. write: solo la Cloud Function (admin SDK).
 * ══════════════════════════════════════════════════════════
 */
const DescriptionStarsSchema = {
  avg:       'number', // Promedio de estrellas (0 si count === 0)
  count:     'number', // Cantidad de calificaciones
  updatedAt: 'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: users/{uid}/chemistry/{otherUid}
 *  Historial de resultados jugando en el MISMO equipo que otro jugador.
 *  A diferencia de descriptionRatings, es de lectura ABIERTA a cualquier
 *  autenticado (no privado) porque no es un dato sensible tipo calificación
 *  personal — es un agregado objetivo como `stats` — y el balanceador de
 *  equipos (useTeamBalancer.js, client-side) necesita leer la química de
 *  TODOS los jugadores del partido para armar la sugerencia.
 *  Simétrico: si A y B comparten equipo, hay un doc en users/{A}/chemistry/{B}
 *  Y en users/{B}/chemistry/{A} con los mismos contadores.
 *  Solo lo escribe la Cloud Function onPlayerStatsWritten (por diferencia,
 *  idempotente) y su backfill recalcAllStats.
 * ══════════════════════════════════════════════════════════
 */
const ChemistrySchema = {
  gamesTogether:  'number', // Partidos jugados en el mismo equipo
  winsTogether:   'number', // De esos, ganados
  drawsTogether:  'number',
  lossesTogether: 'number',
  lastPlayedAt:   'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  COLECCIÓN: matches
 *  Path: /matches/{matchId}
 * ══════════════════════════════════════════════════════════
 */
const MatchSchema = {
  title:          'string',
  location:       'string',        // Texto libre (autocompletado si hay sede)
  venueId:        'string | null', // Sede asociada (/venues/{venueId})
  venueMapsUrl:   'string | null', // Link de Google Maps denormalizado de la sede
  venueLat:       'number | null', // Coordenadas denormalizadas de la sede
  venueLng:       'number | null', // (geocodificadas una vez al crear/editar la sede)
                                   // — habilitan mostrar el clima del partido (useWeather.js)
  venueReserved:  'boolean',       // ¿Ya se reservó/pagó la cancha? Lo tildan el creador/
                                   // admin del grupo del partido (o admin global) — mismo
                                   // permiso que cargar el resultado, sin exigir que el
                                   // partido haya terminado. Default false.

  date:           'Timestamp',    // Fecha y hora del partido
  openAt:         'Timestamp',    // Cuándo se habilita la inscripción
  notifyAt:       'Timestamp | null', // Primera notificación (default: openAt - 3h)

  instantOpen:    'boolean',      // Lista abierta EN EL MOMENTO de crear el partido
                                  // ("Abrir la lista ahora"). Anula la ventana de
                                  // acceso anticipado: nadie tiene los 30 min de
                                  // ventaja y la notificación sale para todo el
                                  // grupo a la vez. Ver earlyAccessMsFor() en
                                  // useRegistration.js y la rama (2) de las reglas.

  groupId:        'string | null', // ID del grupo asociado al partido

  format:         "'5v5' | '7v7' | '8v8' | '11v11' | 'libre'",
  maxPlayers:     '10 | 14 | 16 | 22 | null', // Determinado por format — null en 'libre'
                                   // (sin cupo: nunca hay lista de espera)

  currentPlayers: 'number',       // Contador atómico (actualizado en transaction)

  status: "'scheduled' | 'open' | 'closed' | 'finished'",
  // scheduled → openAt no llegó aún
  // open      → inscripciones abiertas
  // closed    → cerrado manualmente (no admite ni suplentes)
  // finished  → resultados cargados
  // NOTA: 'full' (cupo lleno) es un estado EFECTIVO solo de UI, calculado por
  // getEffectiveStatus() — no se guarda en Firestore. Con cupo lleno se puede
  // seguir anotando gente como SUPLENTE (isOnWaitlist).

  scoreA:         'number | null',
  scoreB:         'number | null',
  finishedAt:     'Timestamp | null', // Momento en que el partido pasó a 'finished' por
                                   // PRIMERA vez (no se re-escribe al re-editar el
                                   // resultado). Ancla del auto-cierre de 36hs.
  resultLocked:   'boolean',       // true a las 36hs de finishedAt — a partir de ahí
                                   // solo un admin global puede seguir editando el
                                   // resultado/playerStats/votación de MVP. Lo fija
                                   // el scheduler processAutoCloseMatches.
  mvpUserId:      'string | null', // MVP del partido, fijado por closeMvpVoting
                                   // según el resultado de la votación (mvpVotes)
  mvpName:        'string | null',
  mvpVotingClosed: 'boolean',      // true una vez que se cerró la votación de MVP
                                   // (manualmente, o automático a las 36hs junto con
                                   // resultLocked) — solo lo escribe closeMvpVoting

  cloudTaskName:  'string | null', // Referencia a la Cloud Task programada

  createdBy:      'string',        // uid del creador — puede anotarse A SÍ MISMO
                                   // desde el momento cero (sin esperar openAt)

  // ── Publicación al resto de la app ("me faltan jugadores") ────────────────
  isPublic:       'boolean',       // Acción MANUAL del organizador, no un campo
                                   // de creación: la mayoría de los partidos se
                                   // llenan dentro del grupo y nunca se publican.
                                   // Con true el partido aparece en "Partidos
                                   // abiertos" y admite `applications`.
  publishedAt:    'Timestamp | null',
  spotsWanted:    'number | null', // Cuántos faltan (informativo, se muestra
                                   // como "Faltan 2" — no bloquea nada)

  createdAt:      'Timestamp',
  updatedAt:      'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: matches/{matchId}/applications/{applicantId}
 *  Postulación de alguien de AFUERA del grupo a un partido publicado.
 * ══════════════════════════════════════════════════════════
 *
 *  Deliberadamente SEPARADA de `registrations`:
 *    registration → ocupa cupo, mueve currentPlayers, ya estás adentro
 *    application  → solicitud pendiente, no ocupa nada
 *
 *  Esa separación es lo que permite no tocar las reglas de `registrations`: el
 *  postulante nunca escribe ahí, ni siquiera al ser aceptado. La inscripción
 *  real la crea la Cloud Function onApplicationResolved (Admin SDK) con la
 *  misma transacción de cupos que useRegistration.registerEntry.
 *
 *  docId = uid del postulante (una postulación activa por persona por partido).
 *  Solo puede postularse quien NO es miembro del grupo del partido: si ya sos
 *  del grupo te anotás derecho en la lista.
 */
const ApplicationSchema = {
  applicantId:       'string',        // = docId
  applicantName:     'string',        // apodo/nombre al momento de postularse
  applicantPhotoURL: 'string | null',
  status:            "'pending' | 'accepted' | 'rejected' | 'withdrawn'",
  message:           'string',        // presentación libre (máx 300)
  createdAt:         'Timestamp',
  resolvedAt:        'Timestamp | null',
  resolvedBy:        'string | null', // uid de quien resolvió, o 'system' si se
                                      // retiró automáticamente por solaparse con
                                      // otro partido que sí lo aceptó
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: matches/{matchId}/applications/{applicantId}/votes/{voterId}
 *  Sondeo CONSULTIVO: los ya anotados opinan sobre quien se postula.
 *  NO es vinculante — decide el organizador. Existe para que el resto del
 *  equipo pueda opinar antes de que se sume un desconocido, no después.
 *  Solo vota quien es miembro del grupo del partido.
 * ══════════════════════════════════════════════════════════
 */
const ApplicationVoteSchema = {
  vote:      "'up' | 'down'",
  updatedAt: 'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: registrations
 *  Path: /matches/{matchId}/registrations/{userId}
 * ══════════════════════════════════════════════════════════
 *
 *  El userId como document ID garantiza que cada usuario
 *  tenga exactamente UNA inscripción por partido (idempotente).
 *  La Firestore Transaction en useRegistration.js lee este
 *  documento para verificar duplicados de forma atómica.
 */
const RegistrationSchema = {
  userId:       'string | null',  // = document ID (null para invitados sin cuenta)
  displayName:  'string',
  photoURL:     'string | null',

  isGuest:      'boolean',        // invitado sin cuenta (docId autogenerado)
  guestName:    'string | null',

  addedBy:      'string',         // uid de quien hizo la inscripción
  addedByName:  'string | null',

  registeredAt: 'Timestamp',
  position:     'number',         // Orden de llegada (1-based). Al borrarse una
                                  // inscripción, la CF onRegistrationDeleted
                                  // re-numera y promueve al primer suplente
                                  // (con notificación FCM).
  isOnWaitlist: 'boolean',        // true si position > maxPlayers (suplente)
  team:         "'A' | 'B' | null",
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: matches/{matchId}/mvpVotes/{voterId}
 *  Un voto por jugador (docId = su propio uid), upsert mientras la votación
 *  esté abierta (match.status === 'finished' && !match.mvpVotingClosed).
 *  Nunca se puede votar a uno mismo (bloqueado en reglas). Legible por
 *  cualquier autenticado (a diferencia de descriptionRatings, acá no hace
 *  falta anonimato — es una votación de MVP, no una calificación personal).
 *  El conteo final lo hace la Cloud Function closeMvpVoting.
 * ══════════════════════════════════════════════════════════
 */
const MvpVoteSchema = {
  votedForUserId: 'string',
  updatedAt:      'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: badges  (insignias mensuales)
 *  Path: /users/{uid}/badges/{badgeId}
 *  docId = `{period}_{type}_{groupId}`  ej: '2026-08_topScorer_abc123'
 * ══════════════════════════════════════════════════════════
 *
 *  Premio del mes, POR GRUPO, congelado para siempre. Lo otorga la tarea
 *  runMonthlyBadges (functions/index.js) el día 1 de cada mes, sumando los
 *  playerStats del mes cerrado — por eso funciona con todo el historial.
 *
 *  El docId compuesto hace la escritura idempotente por construcción: si la
 *  tarea corriera dos veces, el set pisa el mismo doc en vez de duplicar.
 *
 *  NADIE lo escribe desde el cliente (ni el dueño, ni un admin global): las
 *  reglas niegan toda escritura y solo pasa el admin SDK, que se las saltea.
 */
const BadgeSchema = {
  type:      "'topScorer' | 'topAssists' | 'topMvp'",  // ver src/utils/badges.js
  groupId:   'string',
  groupName: 'string',      // denormalizado: el premio sobrevive al borrado del grupo
  period:    'string',      // 'AAAA-MM' — clave del período, NO un Timestamp:
                            // como el formato es AAAA-MM, ordenar alfabéticamente
                            // ES ordenar cronológicamente
  value:     'number',      // cuántos goles/asistencias/MVPs fueron
  wonAt:     'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: playerStats
 *  Path: /matches/{matchId}/playerStats/{userId}
 * ══════════════════════════════════════════════════════════
 *
 *  Guarda las estadísticas de un jugador en UN partido específico.
 *  Los acumulados se suman en /users/{uid}/stats con writeBatch.
 */
const PlayerStatsSchema = {
  userId:      'string',
  displayName: 'string',
  goals:       'number',
  assists:     'number',
  mvp:         'boolean',         // true si ganó la votación de MVP del partido
                                  // (acumula stats.mvps) — SOLO lo escribe la
                                  // Cloud Function closeMvpVoting (o un admin
                                  // global como escape hatch); el cliente
                                  // nunca manda este campo.
  team:        "'A' | 'B' | null",
  groupId:     'string | null',   // Grupo del partido (para statsByGroup)
  savedAt:     'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  ÍNDICES COMPUESTOS (ver firestore.indexes.json)
 * ══════════════════════════════════════════════════════════
 *
 *  matches:       status ASC + date ASC
 *  registrations: position ASC
 *  users:         stats.goals DESC
 *  users:         stats.assists DESC
 *  members:       userId ASC  (COLLECTION_GROUP — para "mis grupos")
 *  groups:        nameLower ASC (para búsqueda por prefijo de nombre)
 *  joinRequests:  status ASC  (para filtrar pendientes)
 */

/**
 * ══════════════════════════════════════════════════════════
 *  COLECCIÓN: groups
 *  Path: /groups/{groupId}
 * ══════════════════════════════════════════════════════════
 *
 *  Cada grupo es un espacio compartido para un círculo de amigos.
 *  Los partidos existen de forma global y los grupos sirven para
 *  organizar quiénes participan.
 */
const GroupSchema = {
  name:        'string',          // Nombre visible del grupo
  nameLower:   'string',          // Nombre en minúsculas (para búsqueda por prefijo)
  description: 'string',          // Descripción opcional
  photoURL:    'string | null',   // Foto de perfil del grupo (subida a Storage: groups/{groupId}/photo.*)

  inviteCode:  'string',          // Código de 8 chars para compartir enlace de invitación
  createdBy:   'string',          // uid del creador

  memberCount: 'number',          // Contador (actualizado vía transaction)

  createdAt:   'Timestamp',
  updatedAt:   'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: members
 *  Path: /groups/{groupId}/members/{userId}
 * ══════════════════════════════════════════════════════════
 *
 *  El userId como document ID garantiza un único registro por
 *  miembro. Se consulta también como collectionGroup para obtener
 *  "todos los grupos donde estoy".
 */
const GroupMemberSchema = {
  userId:      'string',          // = document ID
  displayName: 'string',
  photoURL:    'string | null',

  role:        "'owner' | 'admin' | 'member'",
  // owner  → creador del grupo, permisos totales
  // admin  → puede aceptar/rechazar solicitudes y expulsar miembros
  // member → miembro regular

  og:          'boolean',         // ACCESO ANTICIPADO (30 min antes de openAt).
  // Nota: owner y admin tienen acceso anticipado SIEMPRE, aunque og sea false.
  // El flag og sirve para dárselo también a miembros regulares.

  joinedAt:    'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  SUBCOLECCIÓN: joinRequests
 *  Path: /groups/{groupId}/joinRequests/{userId}
 * ══════════════════════════════════════════════════════════
 *
 *  Solicitudes de ingreso enviadas por usuarios que encontraron
 *  el grupo por búsqueda. Los admins/owner las aceptan o rechazan.
 */
const JoinRequestSchema = {
  userId:      'string',          // = document ID
  displayName: 'string',
  photoURL:    'string | null',

  requestedAt: 'Timestamp',
  status:      "'pending' | 'accepted' | 'rejected'",
}

/**
 * ══════════════════════════════════════════════════════════
 *  COLECCIÓN: venues
 *  Path: /venues/{venueId}
 * ══════════════════════════════════════════════════════════
 *
 *  Sedes (canchas) donde se juegan los partidos. Cualquier usuario
 *  autenticado puede crearlas; edita/borra el creador o un admin global.
 *  Los partidos las referencian por venueId y denormalizan name/mapsUrl
 *  en location/venueMapsUrl (así sobreviven si la sede se borra).
 */
const VenueSchema = {
  name:      'string',            // Nombre visible de la sede
  nameLower: 'string',            // Nombre en minúsculas (orden/búsqueda)
  address:   'string',            // Dirección
  mapsUrl:   'string | null',     // Link de Google Maps ("Compartir" → URL)
  notes:     'string',            // Observaciones (vestuarios, pago, etc.)
  groupId:   'string | null',     // null = sede GLOBAL (solo la crea/edita un admin);
                                   // con valor = sede de ESE grupo (la crea/edita
                                   // cualquier miembro de ese grupo)
  lat:       'number | null',     // Coordenadas geocodificadas de `address` una
  lng:       'number | null',     // sola vez al crear/editar (Nominatim/OSM, sin
                                   // key) — null si no se pudo geocodificar.

  createdBy: 'string',            // uid del creador
  createdAt: 'Timestamp',
  updatedAt: 'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  COLECCIÓN: reports
 *  Path: /reports/{reportId}   (docId autogenerado)
 * ══════════════════════════════════════════════════════════
 *
 *  Denuncias de usuarios. Mínimo viable de moderación, necesario antes de
 *  abrir la app a gente que no se conoce (partidos públicos). No hay panel:
 *  se revisan a mano desde la consola de Firebase.
 *
 *  NADIE los lee salvo un admin global — ni siquiera quien los escribió. Si el
 *  denunciante pudiera listarlos sabría quién denunció a quién; si el
 *  denunciado pudiera leerlos, el reporte invita a la represalia.
 *  Nunca se borran (ni un admin puede): se resuelven cambiando `status`.
 */
const ReportSchema = {
  reporterId:     'string',        // uid de quien denuncia (== request.auth.uid)
  reporterName:   'string | null', // apodo/nombre, denormalizado para leerlo sin otro get
  reportedUserId: 'string',        // uid del denunciado (nunca == reporterId)
  reason:         'string',        // value de REPORT_REASONS (src/composables/useReports.js)
  details:        'string',        // texto libre del denunciante (máx 1000)
  matchId:        'string | null', // partido donde pasó, si aplica
  status:         "'pending' | 'reviewed' | 'dismissed'", // se crea siempre en 'pending'
  createdAt:      'Timestamp',
}

