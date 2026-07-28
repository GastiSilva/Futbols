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

  // Perfil editable por el propio usuario (ProfilePage)
  nickname:      'string | null', // Apodo
  description:   'string',        // Descripción libre
  preferredFoot: "'derecho' | 'izquierdo' | 'ambidiestro' | null", // Pie hábil
  preferredPositions: 'string[]', // Posiciones favoritas (códigos de src/utils/positions.js:
                                  // ARQ, LTI, DFC, LTD, MCD, MI, MC, MD, MCO, EI, DC, ED). Máx 3.
                                  // Elegidas en ProfilePage con el selector visual de cancha.

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
  stars:     'number',    // 1-5
  updatedAt: 'Timestamp',
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
 *  COLECCIÓN: matches
 *  Path: /matches/{matchId}
 * ══════════════════════════════════════════════════════════
 */
const MatchSchema = {
  title:          'string',
  location:       'string',        // Texto libre (autocompletado si hay sede)
  venueId:        'string | null', // Sede asociada (/venues/{venueId})
  venueMapsUrl:   'string | null', // Link de Google Maps denormalizado de la sede

  date:           'Timestamp',    // Fecha y hora del partido
  openAt:         'Timestamp',    // Cuándo se habilita la inscripción
  notifyAt:       'Timestamp | null', // Primera notificación (default: openAt - 3h)

  groupId:        'string | null', // ID del grupo asociado al partido

  format:         "'5v5' | '7v7' | '8v8' | '11v11'",
  maxPlayers:     '10 | 14 | 16 | 22', // Determinado por format

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
  mvpUserId:      'string | null', // MVP del partido (elegido al cargar el resultado)
  mvpName:        'string | null',

  cloudTaskName:  'string | null', // Referencia a la Cloud Task programada

  createdBy:      'string',        // uid del creador — puede anotarse A SÍ MISMO
                                   // desde el momento cero (sin esperar openAt)
  createdAt:      'Timestamp',
  updatedAt:      'Timestamp',
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
  mvp:         'boolean',         // true si fue el MVP del partido (acumula stats.mvps)
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

  createdBy: 'string',            // uid del creador
  createdAt: 'Timestamp',
  updatedAt: 'Timestamp',
}

