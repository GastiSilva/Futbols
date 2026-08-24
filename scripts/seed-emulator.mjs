// scripts/seed-emulator.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Carga datos de prueba en los EMULADORES locales.
//
//  Crea el escenario mínimo para probar los partidos públicos de punta a punta:
//  dos grupos que no se conocen, un partido publicado en uno, y un jugador
//  suelto en el otro que puede postularse.
//
//  Uso:
//     1. En una terminal:  npm run emu
//     2. En otra:          npm run seed
//     3. En otra:          npm run dev     (con VITE_USE_EMULATORS=true)
//
//  ⚠️ SOLO habla con los emuladores: si las variables de entorno de abajo no
//  apuntan a localhost, el script aborta. No puede tocar producción por accidente.
// ─────────────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Estas variables tienen que estar ANTES de inicializar firebase-admin: el SDK
// las lee para decidir a dónde conectarse.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'

// ⚠️ GCLOUD_PROJECT es OBLIGATORIO para hablar con el emulador de AUTH, aunque
// no haga falta para Firestore. Sin esta variable el SDK no logra resolver el
// proyecto al pedir un token y falla con `ECONNREFUSED 127.0.0.1:9099` — un
// error que hace pensar que el emulador no está levantado cuando en realidad
// está andando perfecto. Contra el emulador no se valida ninguna credencial,
// así que no hace falta ningún serviceAccount.json.
process.env.GCLOUD_PROJECT ??= 'listasfutbol-23089'

const { FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST } = process.env

// Cinturón de seguridad: sin esto, un descuido en las variables de entorno
// escribiría datos de prueba en la base real.
const isLocal = (host) => /^(127\.0\.0\.1|localhost|0\.0\.0\.0):\d+$/.test(host ?? '')
if (!isLocal(FIRESTORE_EMULATOR_HOST) || !isLocal(FIREBASE_AUTH_EMULATOR_HOST)) {
  console.error('❌ Los emuladores no apuntan a localhost. Abortando para no tocar producción.')
  console.error(`   FIRESTORE_EMULATOR_HOST=${FIRESTORE_EMULATOR_HOST}`)
  console.error(`   FIREBASE_AUTH_EMULATOR_HOST=${FIREBASE_AUTH_EMULATOR_HOST}`)
  process.exit(1)
}

// firebase-admin vive en functions/node_modules (no es dependencia del front),
// así que se importa desde ahí en vez de sumar una dependencia a la raíz.
const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(__dirname, '..', 'functions', 'package.json'))

let admin
try {
  admin = require('firebase-admin')
} catch {
  console.error('❌ No encontré firebase-admin. Corré primero:  cd functions && npm install')
  process.exit(1)
}

admin.initializeApp({ projectId: 'listasfutbol-23089' })

const db = admin.firestore()
const auth = admin.auth()

const now = new Date()
const inHours = (h) => new Date(now.getTime() + h * 60 * 60 * 1000)
const hoursAgo = (h) => new Date(now.getTime() - h * 60 * 60 * 1000)

// ── Usuarios de prueba ───────────────────────────────────────────────────────
// En el emulador de Auth la contraseña es real pero el email no se verifica
// contra nada: podés entrar con cualquiera de estos desde la pantalla de login.
const USERS = [
  { uid: 'u-gaston',  email: 'gaston@test.com',  displayName: 'Gastón',  nickname: 'Gasti' },
  { uid: 'u-enzo',    email: 'enzo@test.com',    displayName: 'Enzo',    nickname: 'Enzo' },
  { uid: 'u-marcos',  email: 'marcos@test.com',  displayName: 'Marcos',  nickname: 'Marquitos' },
  { uid: 'u-lucia',   email: 'lucia@test.com',   displayName: 'Lucía',   nickname: 'Lu' },
]

const PASSWORD = 'test1234'

const GROUP_MIO = 'g-losdelbarrio'
const GROUP_ENZO = 'g-lospibes'
const MATCH_PUBLICADO = 'm-publicado'
const MATCH_PRIVADO = 'm-privado'

async function seedAuth() {
  for (const u of USERS) {
    try {
      await auth.createUser({
        uid: u.uid,
        email: u.email,
        password: PASSWORD,
        displayName: u.displayName,
        emailVerified: true,
      })
    } catch (err) {
      if (err.code === 'auth/uid-already-exists' || err.code === 'auth/email-already-exists') {
        // Re-seed sobre datos importados: no es un problema
        continue
      }
      throw err
    }
  }
  console.log(`✅ Auth: ${USERS.length} usuarios (contraseña: ${PASSWORD})`)
}

async function seedFirestore() {
  const batch = db.batch()

  // ── Perfiles ───────────────────────────────────────────────────────────────
  const emptyStats = {
    goals: 0, assists: 0, matchesPlayed: 0, mvps: 0, wins: 0, draws: 0, losses: 0,
  }
  for (const u of USERS) {
    batch.set(db.collection('users').doc(u.uid), {
      uid: u.uid,
      displayName: u.displayName,
      nickname: u.nickname,
      email: u.email,
      photoURL: null,
      role: 'player',
      description: `Perfil de prueba de ${u.displayName}.`,
      preferredFoot: 'derecho',
      preferredPositions: ['MC'],
      stats: { ...emptyStats },
      statsByGroup: {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  // ── Grupo propio (Gastón organiza; Marcos y Lucía juegan) ─────────────────
  batch.set(db.collection('groups').doc(GROUP_MIO), {
    name: 'Los del Barrio',
    nameLower: 'los del barrio',
    description: 'Grupo de prueba — el tuyo',
    photoURL: null,
    inviteCode: 'BARRIO11',
    createdBy: 'u-gaston',
    memberCount: 3,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  const misMiembros = [
    { uid: 'u-gaston', role: 'owner',  og: true },
    { uid: 'u-marcos', role: 'member', og: false },
    { uid: 'u-lucia',  role: 'member', og: false },
  ]
  for (const m of misMiembros) {
    const user = USERS.find((u) => u.uid === m.uid)
    batch.set(db.collection('groups').doc(GROUP_MIO).collection('members').doc(m.uid), {
      userId: m.uid,
      displayName: user.displayName,
      photoURL: null,
      role: m.role,
      og: m.og,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  // ── Grupo de Enzo (para que NO sea miembro del tuyo y pueda postularse) ────
  batch.set(db.collection('groups').doc(GROUP_ENZO), {
    name: 'Los Pibes',
    nameLower: 'los pibes',
    description: 'Grupo de prueba — el de Enzo',
    photoURL: null,
    inviteCode: 'PIBES222',
    createdBy: 'u-enzo',
    memberCount: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  batch.set(db.collection('groups').doc(GROUP_ENZO).collection('members').doc('u-enzo'), {
    userId: 'u-enzo',
    displayName: 'Enzo',
    photoURL: null,
    role: 'owner',
    og: true,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // ── Sede ───────────────────────────────────────────────────────────────────
  batch.set(db.collection('venues').doc('v-cancha'), {
    name: 'Cancha del Parque',
    nameLower: 'cancha del parque',
    address: 'Av. Siempreviva 742, Monte Maíz, Córdoba',
    mapsUrl: null,
    notes: 'Sede de prueba',
    groupId: null,
    lat: -33.2,
    lng: -62.6,
    provincia: 'Córdoba',
    ciudad: 'Monte Maíz',
    createdBy: 'u-gaston',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // ── Partido PUBLICADO: al que Enzo se puede postular ──────────────────────
  batch.set(db.collection('matches').doc(MATCH_PUBLICADO), {
    title: 'Fulbo del sábado',
    location: 'Cancha del Parque — Av. Siempreviva 742',
    venueId: 'v-cancha',
    venueMapsUrl: null,
    venueLat: -33.2,
    venueLng: -62.6,
    provincia: 'Córdoba',
    ciudad: 'Monte Maíz',
    venueReserved: false,
    date: admin.firestore.Timestamp.fromDate(inHours(48)),
    openAt: admin.firestore.Timestamp.fromDate(hoursAgo(1)),  // ya abierta
    notifyAt: null,
    instantOpen: false,
    groupId: GROUP_MIO,
    format: '5v5',
    maxPlayers: 10,
    currentPlayers: 8,
    status: 'open',
    scoreA: null,
    scoreB: null,
    finishedAt: null,
    resultLocked: false,
    mvpUserId: null,
    mvpName: null,
    mvpVotingClosed: false,
    cloudTaskName: null,
    createdBy: 'u-gaston',
    // Lo que hace que aparezca en "Partidos abiertos"
    isPublic: true,
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    spotsWanted: 2,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Anotados, para que el partido se vea poblado y haya quién vote el sondeo
  const anotados = [
    { uid: 'u-gaston', name: 'Gasti', pos: 1 },
    { uid: 'u-marcos', name: 'Marquitos', pos: 2 },
    { uid: 'u-lucia',  name: 'Lu', pos: 3 },
  ]
  for (const a of anotados) {
    batch.set(
      db.collection('matches').doc(MATCH_PUBLICADO).collection('registrations').doc(a.uid),
      {
        userId: a.uid,
        displayName: a.name,
        photoURL: null,
        isGuest: false,
        guestName: null,
        addedBy: a.uid,
        addedByName: a.name,
        registeredAt: admin.firestore.FieldValue.serverTimestamp(),
        position: a.pos,
        isOnWaitlist: false,
        team: null,
      },
    )
  }

  // ── Partido NO publicado: para chequear que NO aparece en la búsqueda ─────
  batch.set(db.collection('matches').doc(MATCH_PRIVADO), {
    title: 'Picadito privado del grupo',
    location: 'Cancha del Parque — Av. Siempreviva 742',
    venueId: 'v-cancha',
    venueMapsUrl: null,
    venueLat: -33.2,
    venueLng: -62.6,
    provincia: 'Córdoba',
    ciudad: 'Monte Maíz',
    venueReserved: false,
    date: admin.firestore.Timestamp.fromDate(inHours(72)),
    openAt: admin.firestore.Timestamp.fromDate(hoursAgo(1)),
    notifyAt: null,
    instantOpen: false,
    groupId: GROUP_MIO,
    format: '5v5',
    maxPlayers: 10,
    currentPlayers: 2,
    status: 'open',
    scoreA: null,
    scoreB: null,
    finishedAt: null,
    resultLocked: false,
    mvpUserId: null,
    mvpName: null,
    mvpVotingClosed: false,
    cloudTaskName: null,
    createdBy: 'u-gaston',
    isPublic: false,
    publishedAt: null,
    spotsWanted: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  await batch.commit()
  console.log('✅ Firestore: 4 perfiles, 2 grupos, 1 sede, 2 partidos (1 publicado)')
}

await seedAuth()
await seedFirestore()

console.log(`
───────────────────────────────────────────────────────────
 Datos de prueba listos. Entrá con cualquiera de estos:

   gaston@test.com   ← organizador (grupo "Los del Barrio")
   enzo@test.com     ← el de AFUERA, el que se postula
   marcos@test.com   ← anotado, puede votar el sondeo
   lucia@test.com    ← anotada, puede votar el sondeo

 Contraseña para todos: ${PASSWORD}

 Para probar el circuito:
   1. Entrá como enzo@test.com → "Partidos abiertos" → postulate
   2. Entrá como gaston@test.com → el partido → aceptá o rechazá
   3. Entrá como marcos@test.com → el partido → votá el sondeo

 Panel del emulador: http://127.0.0.1:4000
───────────────────────────────────────────────────────────
`)
