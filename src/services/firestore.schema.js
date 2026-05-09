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

  stats: {
    goals:         'number',      // Goles acumulados en todos los partidos
    assists:       'number',      // Asistencias acumuladas
    matchesPlayed: 'number',      // Partidos jugados
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
 */
