// Esquema de Firestore — Futbols PWA
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
  role:        "'admin' | 'og' | 'player'", // Rol del usuario (default: 'player')

  stats: {
    goals:         'number',      // Goles acumulados en TODOS los partidos (total individual)
    assists:       'number',      // Asistencias acumuladas (total individual)
    matchesPlayed: 'number',      // Partidos jugados (total individual)
  },

  // Desglose de las mismas estadísticas, pero separadas por grupo.
  // Se actualiza junto con `stats` en el mismo writeBatch (ver usePlayerStats.js)
  // únicamente cuando el partido tiene un groupId asociado.
  statsByGroup: {
    '[groupId]': {
      goals:         'number',
      assists:       'number',
      matchesPlayed: 'number',
    },
  },

  createdAt:   'Timestamp',
  updatedAt:   'Timestamp',
}

/**
 * ══════════════════════════════════════════════════════════
 *  COLECCIÓN: matches
 *  Path: /matches/{matchId}
 * ══════════════════════════════════════════════════════════
 */
const MatchSchema = {
  title:          'string',
  location:       'string',

  date:           'Timestamp',    // Fecha y hora del partido
  openAt:         'Timestamp',    // Cuándo se habilita la inscripción
  notifyAt:       'Timestamp | null', // Primera notificación (default: openAt - 3h)

  groupId:        'string | null', // ID del grupo asociado al partido

  format:         "'5v5' | '7v7' | '8v8'",
  maxPlayers:     '10 | 14 | 16', // Determinado por format

  currentPlayers: 'number',       // Contador atómico (actualizado en transaction)

  status: "'scheduled' | 'open' | 'closed' | 'finished'",
  // scheduled → openAt no llegó aún
  // open      → inscripciones abiertas
  // closed    → cupos llenos o cerrado manualmente
  // finished  → resultados cargados

  scoreA:         'number | null',
  scoreB:         'number | null',

  cloudTaskName:  'string | null', // Referencia a la Cloud Task programada

  createdBy:      'string',        // uid del admin
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
  userId:       'string',         // = document ID
  displayName:  'string',
  photoURL:     'string | null',

  registeredAt: 'Timestamp',
  position:     'number',         // Orden de llegada (1-based)
  isOnWaitlist: 'boolean',        // true si position > maxPlayers
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
  team:        "'A' | 'B' | null",
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
  photoURL:    'string | null',   // Foto de perfil del grupo (URL externa, ej: Imgur/Drive)

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

