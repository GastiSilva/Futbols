// tests/firestore.rules.test.js
// ─────────────────────────────────────────────────────────────────────────────
//  Tests de las reglas de seguridad de Firestore.
//
//  Las reglas son la ÚNICA barrera real: el cliente se puede saltear (cualquiera
//  abre la consola y llama al SDK a mano), así que lo que las reglas permiten es
//  lo que la app permite de verdad. Estos tests fijan ese contrato.
//
//  Cómo correrlos:
//     npm run test:rules
//  (levanta el emulador de Firestore solo, corre los tests y lo baja)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, test } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, collectionGroup, getDocs, addDoc,
  query, where, limit,
} from 'firebase/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))

let testEnv

// ── Identidades usadas en los tests ──────────────────────────────────────────
const ALICE = 'alice'      // owner del grupo A
const BOB = 'bob'          // miembro común del grupo A
const MALLORY = 'mallory'  // usuaria de OTRO grupo (la "atacante")
const GUEST = 'guest1'     // invitado anónimo del link
const ADMIN = 'admin1'     // admin global (custom claim)

const GROUP_A = 'grupoA'
const GROUP_B = 'grupoB'
const MATCH_A = 'matchA'   // partido del grupo A
const PUBLIC_MATCH = 'matchPublico'  // partido del grupo A, publicado (isPublic)
const FINISHED_MATCH = 'matchTerminado'  // partido del grupo A ya jugado (votaciones abiertas)
const CARLOS = 'carlos'    // suplente del partido terminado (no llegó a jugar)

// Fechas relativas: la lista ya está abierta
const PAST = new Date(Date.now() - 60 * 60 * 1000)
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000)

// Los contextos se crean UNA sola vez para toda la corrida (en beforeAll).
// Pedir .firestore() dos veces sobre el mismo uid devuelve instancias que
// chocan ("Firestore has already been started"), y crearlos por test hacía
// fallar justamente al bloque que usa dos contextos distintos.
const ctxCache = new Map()

function ctx(uid, claims = {}) {
  const key = `${uid}:${JSON.stringify(claims)}`
  if (!ctxCache.has(key)) {
    ctxCache.set(key, testEnv.authenticatedContext(uid, claims).firestore())
  }
  return ctxCache.get(key)
}

// Sesión anónima: es lo que distingue a un invitado del link.
function guestCtx(uid) {
  const key = `anon:${uid}`
  if (!ctxCache.has(key)) {
    ctxCache.set(
      key,
      testEnv
        .authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } })
        .firestore(),
    )
  }
  return ctxCache.get(key)
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'yasta-rules-test',
    firestore: {
      rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => { await testEnv?.cleanup() })

beforeEach(async () => {
  await testEnv.clearFirestore()

  // Estado inicial, escrito saltándose las reglas
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore()

    await setDoc(doc(db, 'groups', GROUP_A), {
      name: 'Grupo A', createdBy: ALICE, inviteCode: 'AAAA1111', memberCount: 2,
    })
    await setDoc(doc(db, 'groups', GROUP_B), {
      name: 'Grupo B', createdBy: MALLORY, inviteCode: 'BBBB2222', memberCount: 1,
    })

    await setDoc(doc(db, 'groups', GROUP_A, 'members', ALICE), { userId: ALICE, role: 'owner', og: true })
    await setDoc(doc(db, 'groups', GROUP_A, 'members', BOB), { userId: BOB, role: 'member', og: false })
    await setDoc(doc(db, 'groups', GROUP_B, 'members', MALLORY), { userId: MALLORY, role: 'owner', og: true })

    // Partido del grupo A, con la lista YA abierta
    await setDoc(doc(db, 'matches', MATCH_A), {
      title: 'Partido del grupo A',
      groupId: GROUP_A,
      createdBy: ALICE,
      status: 'open',
      currentPlayers: 0,
      maxPlayers: 10,
      openAt: PAST,
      date: FUTURE,
      instantOpen: false,
    })

    // Partido de OTRO grupo, para probar el aislamiento del invitado
    await setDoc(doc(db, 'matches', 'matchB'), {
      title: 'Partido ajeno',
      groupId: GROUP_B,
      createdBy: MALLORY,
      status: 'open',
      currentPlayers: 0,
      maxPlayers: 10,
      openAt: PAST,
      date: FUTURE,
      instantOpen: false,
    })

    // Partido del grupo A PUBLICADO: lo ve (y se puede postular) alguien de
    // afuera del grupo. Mallory, que es del grupo B, hace de postulante.
    await setDoc(doc(db, 'matches', PUBLIC_MATCH), {
      title: 'Partido publicado del grupo A',
      groupId: GROUP_A,
      createdBy: ALICE,
      status: 'open',
      currentPlayers: 8,
      maxPlayers: 10,
      openAt: PAST,
      date: FUTURE,
      instantOpen: false,
      isPublic: true,
      spotsWanted: 2,
    })

    // El invitado ya está anotado en MATCH_A (entró por ese link). Va acá y no
    // en un beforeEach anidado: abrir withSecurityRulesDisabled después de que
    // el contexto anónimo ya se usó rompe con "Firestore has already been
    // started".
    await setDoc(doc(db, 'matches', MATCH_A, 'registrations', GUEST), {
      userId: null, isGuest: true, guestName: 'Invitado', addedBy: GUEST,
      displayName: 'Invitado', position: 1, isOnWaitlist: false,
    })

    await setDoc(doc(db, 'users', BOB), {
      uid: BOB, displayName: 'Bob', role: 'player',
      stats: { goals: 0, assists: 0, matchesPlayed: 0 },
    })

    // Insignia ya otorgada, escrita como la escribiría runMonthlyBadges por
    // admin SDK (que se saltea las reglas, igual que este bloque).
    await setDoc(doc(db, 'users', BOB, 'badges', '2026-07_topScorer_' + GROUP_A), {
      type: 'topScorer', groupId: GROUP_A, groupName: 'Grupo A',
      period: '2026-07', value: 9,
    })

    // Partido del grupo A YA JUGADO, con las dos votaciones (MVP y Muralla)
    // abiertas. maxPlayers 2 a propósito: así el tercer anotado es SUPLENTE y
    // sirve para probar que a un suplente no se lo puede votar.
    await setDoc(doc(db, 'matches', FINISHED_MATCH), {
      title: 'Partido terminado del grupo A',
      groupId: GROUP_A, createdBy: ALICE, status: 'finished',
      currentPlayers: 3, maxPlayers: 2, openAt: PAST, date: PAST,
      instantOpen: false, scoreA: 3, scoreB: 2,
      mvpVotingClosed: false, murallaVotingClosed: false,
    })
    await setDoc(doc(db, 'matches', FINISHED_MATCH, 'registrations', ALICE), {
      userId: ALICE, displayName: 'Alice', isGuest: false, position: 1, isOnWaitlist: false,
    })
    await setDoc(doc(db, 'matches', FINISHED_MATCH, 'registrations', BOB), {
      userId: BOB, displayName: 'Bob', isGuest: false, position: 2, isOnWaitlist: false,
    })
    await setDoc(doc(db, 'matches', FINISHED_MATCH, 'registrations', CARLOS), {
      userId: CARLOS, displayName: 'Carlos', isGuest: false, position: 3, isOnWaitlist: true,
    })

    // Historial cara a cara, escrito por updateChemistryForPlayerStat (admin SDK).
    await setDoc(doc(db, 'users', BOB, 'rivalry', ALICE), {
      gamesAgainst: 5, winsAgainst: 3, drawsAgainst: 1, lossesAgainst: 1,
    })
    await setDoc(doc(db, 'users', BOB, 'chemistry', ALICE), {
      gamesTogether: 4, winsTogether: 3, drawsTogether: 0, lossesTogether: 1,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Partidos: visibilidad entre grupos', () => {
  test('un miembro del grupo puede leer el partido de su grupo', async () => {
    await assertSucceeds(getDoc(doc(ctx(BOB), 'matches', MATCH_A)))
  })

  test('alguien de OTRO grupo NO puede leer el partido', async () => {
    await assertFails(getDoc(doc(ctx(MALLORY), 'matches', MATCH_A)))
  })

  test('alguien de otro grupo NO puede ver la lista de anotados', async () => {
    await assertFails(getDocs(collection(ctx(MALLORY), 'matches', MATCH_A, 'registrations')))
  })

  test('un miembro del grupo SÍ puede ver la lista de anotados', async () => {
    await assertSucceeds(getDocs(collection(ctx(BOB), 'matches', MATCH_A, 'registrations')))
  })
})

describe('Partidos públicos: visibilidad', () => {
  test('alguien de otro grupo SÍ puede leer un partido publicado', async () => {
    await assertSucceeds(getDoc(doc(ctx(MALLORY), 'matches', PUBLIC_MATCH)))
  })

  test('pero NO puede ver la lista de anotados del partido publicado', async () => {
    // Publicar abre el partido, no la lista de quiénes van: eso sigue siendo
    // del grupo hasta que te acepten.
    await assertFails(
      getDocs(collection(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'registrations')),
    )
  })

  test('pero SÍ puede verla una vez que tiene su propia registration ahí (postulación aceptada)', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'matches', PUBLIC_MATCH, 'registrations', MALLORY), {
        userId: MALLORY, displayName: 'Mallory', isGuest: false, position: 3, isOnWaitlist: false,
      })
    })
    await assertSucceeds(
      getDocs(collection(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'registrations')),
    )
    await assertSucceeds(
      getDoc(doc(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'registrations', MALLORY)),
    )
  })

  test('el organizador puede publicar/despublicar su partido', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'matches', MATCH_A), {
        isPublic: true, spotsWanted: 2,
      }),
    )
  })

  test('un miembro común, al anotarse y llenar el último cupo, puede despublicar en el mismo update', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'matches', PUBLIC_MATCH), {
        title: 'Partido publicado del grupo A', groupId: GROUP_A, createdBy: ALICE,
        status: 'open', currentPlayers: 9, maxPlayers: 10, openAt: PAST, date: FUTURE,
        instantOpen: false, isPublic: true, spotsWanted: 2,
      })
    })
    await assertSucceeds(
      updateDoc(doc(ctx(BOB), 'matches', PUBLIC_MATCH), {
        currentPlayers: 10, isPublic: false,
      }),
    )
  })

  test('pero NO puede despublicar si el cupo no se llenó (currentPlayers < maxPlayers)', async () => {
    await assertFails(
      updateDoc(doc(ctx(ALICE), 'matches', PUBLIC_MATCH), {
        currentPlayers: 9, isPublic: false,
      }),
    )
  })

  test('ni prender isPublic por esta vía', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'matches', PUBLIC_MATCH), {
        title: 'x', groupId: GROUP_A, createdBy: ALICE,
        status: 'open', currentPlayers: 9, maxPlayers: 10, openAt: PAST, date: FUTURE,
        instantOpen: false, isPublic: false, spotsWanted: 2,
      })
    })
    await assertFails(
      updateDoc(doc(ctx(BOB), 'matches', PUBLIC_MATCH), {
        currentPlayers: 10, isPublic: true,
      }),
    )
  })

  test('alguien de otro grupo NO puede publicar un partido ajeno', async () => {
    await assertFails(
      updateDoc(doc(ctx(MALLORY), 'matches', MATCH_A), { isPublic: true }),
    )
  })

  test('un miembro común NO puede publicar el partido', async () => {
    // Publicar expone el partido a toda la app: es gestión, no participación.
    await assertFails(
      updateDoc(doc(ctx(BOB), 'matches', MATCH_A), { isPublic: true }),
    )
  })
})

describe('Postulaciones a partidos públicos', () => {
  const application = (uid) => ({
    applicantId: uid,
    applicantName: 'Postulante',
    status: 'pending',
    message: 'Juego de 9, dale',
  })

  test('alguien de afuera puede postularse a un partido publicado', async () => {
    await assertSucceeds(
      setDoc(
        doc(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      ),
    )
  })

  test('NO se puede postular a un partido que no está publicado', async () => {
    await assertFails(
      setDoc(
        doc(ctx(MALLORY), 'matches', MATCH_A, 'applications', MALLORY),
        application(MALLORY),
      ),
    )
  })

  test('un miembro del grupo NO se postula (se anota derecho)', async () => {
    await assertFails(
      setDoc(
        doc(ctx(BOB), 'matches', PUBLIC_MATCH, 'applications', BOB),
        application(BOB),
      ),
    )
  })

  test('no se puede postular en nombre de otro', async () => {
    await assertFails(
      setDoc(
        doc(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'applications', 'otro-uid'),
        application('otro-uid'),
      ),
    )
  })

  test('la postulación nace siempre en pending, no aceptada', async () => {
    await assertFails(
      setDoc(doc(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'applications', MALLORY), {
        ...application(MALLORY), status: 'accepted',
      }),
    )
  })

  test('el organizador puede aceptar una postulación', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'matches', PUBLIC_MATCH, 'applications', MALLORY), {
        status: 'accepted', resolvedBy: ALICE,
      }),
    )
  })

  test('el postulante NO puede auto-aceptarse', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    await assertFails(
      updateDoc(doc(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'applications', MALLORY), {
        status: 'accepted', resolvedBy: MALLORY,
      }),
    )
  })

  test('el postulante SÍ puede retirarse mientras esté pendiente', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    await assertSucceeds(
      updateDoc(doc(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'applications', MALLORY), {
        status: 'withdrawn',
      }),
    )
  })

  test('una postulación ya resuelta no se puede reabrir', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        { ...application(MALLORY), status: 'rejected' },
      )
    })
    await assertFails(
      updateDoc(doc(ctx(ALICE), 'matches', PUBLIC_MATCH, 'applications', MALLORY), {
        status: 'accepted', resolvedBy: ALICE,
      }),
    )
  })

  test('las postulaciones no se borran', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    await assertFails(
      deleteDoc(doc(ctx(ALICE), 'matches', PUBLIC_MATCH, 'applications', MALLORY)),
    )
  })

  test('un miembro del grupo puede votar en el sondeo', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    await assertSucceeds(
      setDoc(
        doc(ctx(BOB), 'matches', PUBLIC_MATCH, 'applications', MALLORY, 'votes', BOB),
        { vote: 'up' },
      ),
    )
  })

  test('el postulante y el organizador pueden chatear', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    // El postulante escribe
    await assertSucceeds(
      addDoc(
        collection(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'applications', MALLORY, 'messages'),
        { senderId: MALLORY, senderName: 'Mallory', text: '¿Dónde es exactamente?' },
      ),
    )
    // El organizador responde
    await assertSucceeds(
      addDoc(
        collection(ctx(ALICE), 'matches', PUBLIC_MATCH, 'applications', MALLORY, 'messages'),
        { senderId: ALICE, senderName: 'Alice', text: 'En la cancha del parque' },
      ),
    )
  })

  test('un tercero NO puede leer ese chat', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    // Bob es del grupo pero no es ni el postulante ni quien gestiona
    await assertFails(
      getDocs(
        collection(ctx(BOB), 'matches', PUBLIC_MATCH, 'applications', MALLORY, 'messages'),
      ),
    )
  })

  test('no se puede escribir haciéndose pasar por otro', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    await assertFails(
      addDoc(
        collection(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'applications', MALLORY, 'messages'),
        { senderId: ALICE, senderName: 'Alice', text: 'Mensaje falso' },
      ),
    )
  })

  test('el propio postulante NO puede votarse a sí mismo', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    // No es miembro del grupo del partido → no vota
    await assertFails(
      setDoc(
        doc(ctx(MALLORY), 'matches', PUBLIC_MATCH, 'applications', MALLORY, 'votes', MALLORY),
        { vote: 'up' },
      ),
    )
  })

  // Regresión: "mis postulaciones" en el cliente usa un collectionGroup
  // filtrado por applicantId (subscribeToMyApplications). isMemberOfMatchGroup
  // hace un get() a matches/$(matchId) que no tiene un matchId concreto en
  // esta query — si esa rama va ANTES de la que de verdad cubre este caso, el
  // get() revienta y tumba todo el `allow list` con permission-denied aunque
  // la otra rama fuera true.
  test('el postulante puede listar "mis postulaciones" via collectionGroup', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'matches', PUBLIC_MATCH, 'applications', MALLORY),
        application(MALLORY),
      )
    })
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(ctx(MALLORY), 'applications'),
          where('applicantId', '==', MALLORY),
          limit(50),
        ),
      ),
    )
  })
})

describe('Partidos: listar la colección exige un limit acotado', () => {
  // Las reglas NO pueden inspeccionar las cláusulas `where` de una query
  // (request.query solo expone limit/offset/orderBy), así que el aislamiento
  // por grupo al LISTAR no es expresable. Lo que sí se puede exigir es un tope
  // de resultados: sin él, una sola consulta barría la colección entera.
  test('listar sin limit falla', async () => {
    await assertFails(getDocs(collection(ctx(BOB), 'matches')))
  })

  test('listar con un limit por encima del tope falla', async () => {
    await assertFails(getDocs(query(collection(ctx(BOB), 'matches'), limit(500))))
  })

  test('listar con un limit dentro del tope funciona', async () => {
    await assertSucceeds(getDocs(query(collection(ctx(BOB), 'matches'), limit(200))))
  })

  test('un invitado anónimo NO puede listar partidos ni con limit', async () => {
    await assertFails(getDocs(query(collection(guestCtx(GUEST), 'matches'), limit(50))))
  })

  test('un admin global puede listar sin limit', async () => {
    await assertSucceeds(getDocs(collection(ctx(ADMIN, { admin: true }), 'matches')))
  })
})

describe('Reportes de usuarios', () => {
  const validReport = (reporter, reported) => ({
    reporterId: reporter, reportedUserId: reported,
    reason: 'behavior', details: 'Se peleó con todos.', status: 'pending',
  })

  test('cualquiera con cuenta puede reportar a otro', async () => {
    await assertSucceeds(
      addDoc(collection(ctx(BOB), 'reports'), validReport(BOB, MALLORY)),
    )
  })

  test('no se puede reportar en nombre de otro', async () => {
    await assertFails(
      addDoc(collection(ctx(BOB), 'reports'), validReport(ALICE, MALLORY)),
    )
  })

  test('no se puede reportar a uno mismo', async () => {
    await assertFails(
      addDoc(collection(ctx(BOB), 'reports'), validReport(BOB, BOB)),
    )
  })

  test('no se puede crear un reporte ya resuelto', async () => {
    await assertFails(
      addDoc(collection(ctx(BOB), 'reports'), {
        ...validReport(BOB, MALLORY), status: 'reviewed',
      }),
    )
  })

  test('el denunciante NO puede leer los reportes', async () => {
    await assertFails(getDocs(collection(ctx(BOB), 'reports')))
  })

  test('un admin global SÍ puede leerlos', async () => {
    await assertSucceeds(getDocs(collection(ctx(ADMIN, { admin: true }), 'reports')))
  })

  test('un invitado anónimo no puede reportar', async () => {
    await assertFails(
      addDoc(collection(guestCtx(GUEST), 'reports'), validReport(GUEST, BOB)),
    )
  })
})

describe('Calificar la descripción: solo entre compañeros de grupo', () => {
  test('un compañero del mismo grupo puede calificar', async () => {
    await assertSucceeds(
      setDoc(doc(ctx(ALICE), 'users', BOB, 'descriptionRatings', ALICE), {
        stars: 4, sharedGroupId: GROUP_A,
      }),
    )
  })

  test('alguien de otro grupo NO puede calificar', async () => {
    await assertFails(
      setDoc(doc(ctx(MALLORY), 'users', BOB, 'descriptionRatings', MALLORY), {
        stars: 1, sharedGroupId: GROUP_B,
      }),
    )
  })

  test('mentir sobre el grupo compartido no sirve', async () => {
    // Mallory no es miembro del grupo A, así que declararlo no la habilita.
    await assertFails(
      setDoc(doc(ctx(MALLORY), 'users', BOB, 'descriptionRatings', MALLORY), {
        stars: 1, sharedGroupId: GROUP_A,
      }),
    )
  })

  test('sin sharedGroupId falla aunque compartan grupo', async () => {
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', BOB, 'descriptionRatings', ALICE), { stars: 4 }),
    )
  })
})

describe('Perfil: preferencias de notificación', () => {
  test('el dueño puede escribir sus notificationPrefs', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx(BOB), 'users', BOB), { 'notificationPrefs.publicNearby': true }),
    )
  })

  test('nadie puede escribir las notificationPrefs de otro', async () => {
    await assertFails(
      updateDoc(doc(ctx(MALLORY), 'users', BOB), { 'notificationPrefs.publicNearby': true }),
    )
  })
})

describe('Partidos: quién puede borrarlos', () => {
  test('el creador puede borrar su partido', async () => {
    await assertSucceeds(deleteDoc(doc(ctx(ALICE), 'matches', MATCH_A)))
  })

  test('un miembro común NO puede borrar el partido', async () => {
    await assertFails(deleteDoc(doc(ctx(BOB), 'matches', MATCH_A)))
  })

  test('alguien de otro grupo NO puede borrar el partido', async () => {
    await assertFails(deleteDoc(doc(ctx(MALLORY), 'matches', MATCH_A)))
  })

  test('un admin global puede borrar cualquier partido', async () => {
    await assertSucceeds(deleteDoc(doc(ctx(ADMIN, { admin: true }), 'matches', MATCH_A)))
  })
})

describe('Partidos: no cerrar la lista por la rama de resultado', () => {
  test('un miembro NO puede mandar status closed disfrazado de resultado', async () => {
    await assertFails(updateDoc(doc(ctx(BOB), 'matches', MATCH_A), {
      scoreA: 0, scoreB: 0, status: 'closed',
    }))
  })

  test('un miembro SÍ puede cargar un resultado (status finished)', async () => {
    await assertSucceeds(updateDoc(doc(ctx(BOB), 'matches', MATCH_A), {
      scoreA: 3, scoreB: 1, status: 'finished',
    }))
  })
})

describe('playerStats: cualquier miembro carga las estadísticas', () => {
  // Este bloque fija el bug que dejaba cargar stats SOLO al admin global:
  // la regla comparaba `request.resource.data.team in ['A','B',null]`, pero un
  // jugador sin equipo asignado no trae el campo `team` (Firestore descarta los
  // undefined), y sobre un campo AUSENTE esa comparación da falso. El admin se
  // colaba por la rama `|| isAdmin()`, así que el dueño de la app no veía nunca
  // el error y a todos los demás les saltaba PERMISSION_DENIED.
  test('un miembro común puede cargar stats CON equipo asignado', async () => {
    await assertSucceeds(setDoc(doc(ctx(BOB), 'matches', MATCH_A, 'playerStats', BOB), {
      userId: BOB, displayName: 'Bob', goals: 2, assists: 1, team: 'A', groupId: GROUP_A,
    }))
  })

  test('un miembro común puede cargar stats SIN equipo (campo team ausente)', async () => {
    await assertSucceeds(setDoc(doc(ctx(BOB), 'matches', MATCH_A, 'playerStats', BOB), {
      userId: BOB, displayName: 'Bob', goals: 1, assists: 0, groupId: GROUP_A,
    }))
  })

  test('un miembro puede cargar las stats DE OTRO jugador del partido', async () => {
    // Cargar el resultado es tarea de uno solo para todo el equipo: el que
    // carga anota los goles de los demás, no solo los propios.
    await assertSucceeds(setDoc(doc(ctx(BOB), 'matches', MATCH_A, 'playerStats', ALICE), {
      userId: ALICE, displayName: 'Alice', goals: 3, assists: 0, team: 'B', groupId: GROUP_A,
    }))
  })

  test('alguien de OTRO grupo NO puede cargar stats', async () => {
    await assertFails(setDoc(doc(ctx(MALLORY), 'matches', MATCH_A, 'playerStats', MALLORY), {
      userId: MALLORY, displayName: 'Mallory', goals: 9, assists: 0, team: 'A', groupId: GROUP_A,
    }))
  })

  test('no se puede escribir stats a nombre de otro uid (userId != docId)', async () => {
    await assertFails(setDoc(doc(ctx(BOB), 'matches', MATCH_A, 'playerStats', BOB), {
      userId: ALICE, displayName: 'Bob', goals: 5, assists: 0, team: 'A', groupId: GROUP_A,
    }))
  })

  test('un miembro NO puede fijar el mvp a mano (lo decide la votación)', async () => {
    await assertFails(setDoc(doc(ctx(BOB), 'matches', MATCH_A, 'playerStats', BOB), {
      userId: BOB, displayName: 'Bob', goals: 1, assists: 0, team: 'A', mvp: true, groupId: GROUP_A,
    }))
  })

  test('goles negativos rechazados', async () => {
    await assertFails(setDoc(doc(ctx(BOB), 'matches', MATCH_A, 'playerStats', BOB), {
      userId: BOB, displayName: 'Bob', goals: -1, assists: 0, team: 'A', groupId: GROUP_A,
    }))
  })
})

describe('Resultado: sin límite de 36hs (resultLocked)', () => {
  // El auto-cierre marcaba resultLocked a las 36hs y la regla lo exigía en false
  // para los miembros pero no para el admin: un grupo que tardaba dos días en
  // cargar el partido se quedaba afuera de sus propias estadísticas.
  test('un miembro puede cargar el resultado aunque el partido esté bloqueado', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), 'matches', MATCH_A), { resultLocked: true })
    })
    await assertSucceeds(updateDoc(doc(ctx(BOB), 'matches', MATCH_A), {
      scoreA: 2, scoreB: 2, status: 'finished',
    }))
  })

  test('un miembro puede cargar stats aunque el partido esté bloqueado', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), 'matches', MATCH_A), { resultLocked: true })
    })
    await assertSucceeds(setDoc(doc(ctx(BOB), 'matches', MATCH_A, 'playerStats', BOB), {
      userId: BOB, displayName: 'Bob', goals: 1, assists: 1, team: 'A', groupId: GROUP_A,
    }))
  })
})

describe('memberCount: solo miembros del grupo', () => {
  test('alguien de otro grupo NO puede tocar el memberCount', async () => {
    // Este era el agujero: isOwner(request.auth.uid) siempre daba true.
    await assertFails(updateDoc(doc(ctx(MALLORY), 'groups', GROUP_A), { memberCount: 99 }))
  })

  test('ni siquiera moviéndolo de a uno', async () => {
    await assertFails(updateDoc(doc(ctx(MALLORY), 'groups', GROUP_A), { memberCount: 3 }))
  })

  test('un miembro del grupo SÍ puede moverlo de a uno', async () => {
    await assertSucceeds(updateDoc(doc(ctx(BOB), 'groups', GROUP_A), { memberCount: 3 }))
  })
})

describe('Invitado anónimo: confinado al partido de su link', () => {
  test('puede leer el partido de su link', async () => {
    await assertSucceeds(getDoc(doc(guestCtx(GUEST), 'matches', MATCH_A)))
  })

  test('NO puede mover los cupos de un partido ajeno', async () => {
    await assertFails(updateDoc(doc(guestCtx(GUEST), 'matches', 'matchB'), { currentPlayers: 1 }))
  })

  test('SÍ puede mover los cupos del partido donde está anotado', async () => {
    await assertSucceeds(updateDoc(doc(guestCtx(GUEST), 'matches', MATCH_A), { currentPlayers: 1 }))
  })

  // Un invitado anónimo SÍ puede leer la lista de anotados de cualquier
  // partido, incluso uno que no es el de su link. Es una concesión deliberada,
  // no un descuido: la restricción anterior ("solo la lista del partido donde
  // ya estás anotado") era imposible de sostener por dos motivos técnicos.
  //
  //  (1) Dependencia circular: para anotarse, registerEntry abre la
  //      transacción LEYENDO su propio doc de inscripción (que todavía no
  //      existe) para detectar dobles altas. Si leer exige estar anotado, el
  //      alta nunca puede ocurrir → 403 PERMISSION_DENIED al apretar
  //      "Anotarme". Era el bug que originó este cambio.
  //  (2) `list` no puede depender de un doc puntual: Firestore evalúa las
  //      reglas de query sin leer documentos, así que el onSnapshot de la
  //      lista se rechazaba entero igual.
  //
  // El riesgo real es bajo: para leer una lista hay que conocer el matchId
  // exacto, que es justamente el link que a esa persona le compartieron. Lo
  // que de verdad confina al invitado —mover cupos, crear/borrar su
  // inscripción— sigue verificado por guestHasEntryInMatch (tests de arriba).
  test('puede leer listas de otros partidos (concesión: ver comentario)', async () => {
    await assertSucceeds(getDocs(collection(guestCtx(GUEST), 'matches', 'matchB', 'registrations')))
  })

  test('puede darse de baja de su propia inscripción', async () => {
    await assertSucceeds(deleteDoc(doc(guestCtx(GUEST), 'matches', MATCH_A, 'registrations', GUEST)))
  })

  test('NO puede crear una inscripción con un docId que no es su uid', async () => {
    await assertFails(setDoc(doc(guestCtx(GUEST), 'matches', MATCH_A, 'registrations', 'otroId'), {
      userId: null, isGuest: true, guestName: 'Colado', addedBy: GUEST,
      displayName: 'Colado', position: 2, isOnWaitlist: false,
    }))
  })
})

describe('Perfil: campos que el cliente nunca puede escribir', () => {
  test('un usuario NO puede inflarse las estadísticas', async () => {
    await assertFails(updateDoc(doc(ctx(BOB), 'users', BOB), {
      stats: { goals: 999, assists: 999, matchesPlayed: 999 },
    }))
  })

  test('un usuario NO puede hacerse admin', async () => {
    await assertFails(updateDoc(doc(ctx(BOB), 'users', BOB), { role: 'admin' }))
  })

  test('un usuario SÍ puede editar su apodo', async () => {
    await assertSucceeds(updateDoc(doc(ctx(BOB), 'users', BOB), { nickname: 'Bobby' }))
  })

  test('un usuario NO puede editar el perfil de otro', async () => {
    await assertFails(updateDoc(doc(ctx(MALLORY), 'users', BOB), { nickname: 'Hackeado' }))
  })
})

describe('Insignias: premio público que nadie se puede autoasignar', () => {
  const BADGE_ID = '2026-07_topScorer_' + GROUP_A

  test('un compañero de grupo puede ver las insignias', async () => {
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'users', BOB, 'badges', BADGE_ID)))
  })

  test('alguien de AFUERA del grupo también las ve (son un premio público)', async () => {
    await assertSucceeds(getDoc(doc(ctx(MALLORY), 'users', BOB, 'badges', BADGE_ID)))
  })

  test('el dueño del perfil NO puede otorgarse una insignia', async () => {
    await assertFails(setDoc(doc(ctx(BOB), 'users', BOB, 'badges', '2026-08_topScorer_' + GROUP_A), {
      type: 'topScorer', groupId: GROUP_A, period: '2026-08', value: 99,
    }))
  })

  test('un tercero NO puede otorgarle una insignia a otro', async () => {
    await assertFails(setDoc(doc(ctx(MALLORY), 'users', BOB, 'badges', '2026-08_topMvp_' + GROUP_A), {
      type: 'topMvp', groupId: GROUP_A, period: '2026-08', value: 5,
    }))
  })

  test('ni siquiera un admin global puede escribir insignias', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN, { admin: true }), 'users', BOB, 'badges', '2026-08_topScorer_' + GROUP_A), {
      type: 'topScorer', groupId: GROUP_A, period: '2026-08', value: 99,
    }))
  })

  test('el dueño NO puede inflar el valor de una insignia que ganó', async () => {
    await assertFails(updateDoc(doc(ctx(BOB), 'users', BOB, 'badges', BADGE_ID), { value: 999 }))
  })

  test('el dueño NO puede borrar una insignia', async () => {
    await assertFails(deleteDoc(doc(ctx(BOB), 'users', BOB, 'badges', BADGE_ID)))
  })
})

describe('Miembros: no auto-promoverse', () => {
  test('nadie puede darse de alta como admin de un grupo ajeno', async () => {
    await assertFails(setDoc(doc(ctx(MALLORY), 'groups', GROUP_A, 'members', MALLORY), {
      userId: MALLORY, role: 'admin', og: true,
    }))
  })

  test('nadie puede autoasignarse OG al unirse', async () => {
    await assertFails(setDoc(doc(ctx(MALLORY), 'groups', GROUP_A, 'members', MALLORY), {
      userId: MALLORY, role: 'member', og: true,
    }))
  })

  test('unirse como member sin OG está permitido', async () => {
    await assertSucceeds(setDoc(doc(ctx(MALLORY), 'groups', GROUP_A, 'members', MALLORY), {
      userId: MALLORY, role: 'member', og: false,
    }))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Lectura de los votos de MVP (voto secreto + podio)', () => {
  // Las reglas de escritura de mvpVotes ya se cubren indirectamente en el
  // bloque de Muralla (son idénticas). Acá se fija lo propio de la LECTURA,
  // que es lo que sostiene el voto secreto mientras la votación transcurre.

  test('con la votación ABIERTA, cada uno lee SOLO su propio voto', async () => {
    // Voto secreto: si cualquiera pudiera leer el voto ajeno, esconder el
    // recuento en la pantalla sería maquillaje — se cuenta desde la consola.
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'matches', FINISHED_MATCH, 'mvpVotes', ALICE), {
        votedForUserId: BOB,
      })
    })
    await assertFails(
      getDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'mvpVotes', ALICE)),
    )
    await assertSucceeds(
      getDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'mvpVotes', BOB)),
    )
  })

  test('con la votación ABIERTA nadie puede listar los votos', async () => {
    await assertFails(
      getDocs(collection(ctx(BOB), 'matches', FINISHED_MATCH, 'mvpVotes')),
    )
  })

  test('CERRADA la votación, los votos se pueden listar (alimentan el podio)', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), 'matches', FINISHED_MATCH), {
        mvpVotingClosed: true,
      })
    })
    await assertSucceeds(
      getDocs(collection(ctx(BOB), 'matches', FINISHED_MATCH, 'mvpVotes')),
    )
    await assertSucceeds(
      getDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'mvpVotes', ALICE)),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Votación de Muralla (mejor defensor)', () => {
  // Mismas reglas que mvpVotes en una colección aparte: son votaciones
  // INDEPENDIENTES (cada una la cierra su propia Cloud Function). Lo que se
  // fija acá es que el voto sea del que vota, sobre alguien que realmente jugó
  // ese partido, y solo mientras la votación siga abierta.

  test('un miembro del grupo puede votar a otro titular', async () => {
    await assertSucceeds(
      setDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', BOB), {
        votedForUserId: ALICE,
      }),
    )
  })

  test('nadie se puede votar a sí mismo', async () => {
    await assertFails(
      setDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', BOB), {
        votedForUserId: BOB,
      }),
    )
  })

  test('no se puede escribir el voto de OTRO (docId != uid)', async () => {
    // El docId ES la identidad del votante: si se pudiera elegir, uno votaría
    // por los demás y la votación no valdría nada.
    await assertFails(
      setDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', ALICE), {
        votedForUserId: BOB,
      }),
    )
  })

  test('alguien de OTRO grupo no puede votar', async () => {
    await assertFails(
      setDoc(doc(ctx(MALLORY), 'matches', FINISHED_MATCH, 'murallaVotes', MALLORY), {
        votedForUserId: ALICE,
      }),
    )
  })

  test('no se puede votar a un SUPLENTE (no jugó)', async () => {
    await assertFails(
      setDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', BOB), {
        votedForUserId: CARLOS,
      }),
    )
  })

  test('no se puede votar a alguien que ni siquiera está anotado', async () => {
    await assertFails(
      setDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', BOB), {
        votedForUserId: MALLORY,
      }),
    )
  })

  test('no se puede votar en un partido que todavía no terminó', async () => {
    await assertFails(
      setDoc(doc(ctx(BOB), 'matches', MATCH_A, 'murallaVotes', BOB), {
        votedForUserId: GUEST,
      }),
    )
  })

  test('con la votación ya cerrada no se puede votar más', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), 'matches', FINISHED_MATCH), {
        murallaVotingClosed: true,
      })
    })
    await assertFails(
      setDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', BOB), {
        votedForUserId: ALICE,
      }),
    )
  })

  test('cerrar la votación de MVP no cierra la de Muralla (son independientes)', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), 'matches', FINISHED_MATCH), {
        mvpVotingClosed: true,
      })
    })
    await assertSucceeds(
      setDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', BOB), {
        votedForUserId: ALICE,
      }),
    )
  })

  test('el voto se puede cambiar mientras la votación siga abierta', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'matches', FINISHED_MATCH, 'murallaVotes', BOB), {
        votedForUserId: CARLOS,
      })
    })
    await assertSucceeds(
      updateDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', BOB), {
        votedForUserId: ALICE,
      }),
    )
  })

  test('con la votación ABIERTA, cada uno lee SOLO su propio voto', async () => {
    // Voto secreto: si cualquiera pudiera leer el voto ajeno, esconder el
    // recuento en la pantalla sería maquillaje — se cuenta desde la consola.
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'matches', FINISHED_MATCH, 'murallaVotes', ALICE), {
        votedForUserId: BOB,
      })
    })
    await assertFails(
      getDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', ALICE)),
    )
    await assertSucceeds(
      getDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', BOB)),
    )
  })

  test('con la votación ABIERTA nadie puede listar los votos', async () => {
    await assertFails(
      getDocs(collection(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes')),
    )
  })

  test('CERRADA la votación, los votos se pueden listar (alimentan el podio)', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), 'matches', FINISHED_MATCH), {
        murallaVotingClosed: true,
      })
    })
    await assertSucceeds(
      getDocs(collection(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes')),
    )
    await assertSucceeds(
      getDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', ALICE)),
    )
  })

  test('un jugador NO puede borrar su voto; un admin sí', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'matches', FINISHED_MATCH, 'murallaVotes', BOB), {
        votedForUserId: ALICE,
      })
    })
    await assertFails(
      deleteDoc(doc(ctx(BOB), 'matches', FINISHED_MATCH, 'murallaVotes', BOB)),
    )
    await assertSucceeds(
      deleteDoc(doc(ctx(ADMIN, { admin: true }), 'matches', FINISHED_MATCH, 'murallaVotes', BOB)),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Historial cara a cara (chemistry / rivalry)', () => {
  // Agregados objetivos que alimentan el "versus" del perfil y los mensajes de
  // hype. Se leen abiertos (mismo criterio que las stats) y NADIE los escribe
  // desde el cliente: si se pudieran editar, uno se inventaría el historial
  // contra un rival.

  test('cualquier usuario puede leer la rivalidad de otro', async () => {
    await assertSucceeds(getDoc(doc(ctx(MALLORY), 'users', BOB, 'rivalry', ALICE)))
  })

  test('cualquier usuario puede leer la química de otro', async () => {
    await assertSucceeds(getDoc(doc(ctx(MALLORY), 'users', BOB, 'chemistry', ALICE)))
  })

  test('el dueño NO puede escribir su propia rivalidad', async () => {
    await assertFails(setDoc(doc(ctx(BOB), 'users', BOB, 'rivalry', ALICE), {
      gamesAgainst: 99, winsAgainst: 99, drawsAgainst: 0, lossesAgainst: 0,
    }))
  })

  test('el dueño NO puede escribir su propia química', async () => {
    await assertFails(setDoc(doc(ctx(BOB), 'users', BOB, 'chemistry', ALICE), {
      gamesTogether: 99, winsTogether: 99, drawsTogether: 0, lossesTogether: 0,
    }))
  })

  test('ni siquiera un admin global las puede escribir', async () => {
    await assertFails(setDoc(doc(ctx(ADMIN, { admin: true }), 'users', BOB, 'rivalry', ALICE), {
      gamesAgainst: 1, winsAgainst: 1, drawsAgainst: 0, lossesAgainst: 0,
    }))
  })

  test('nadie puede borrarlas', async () => {
    await assertFails(deleteDoc(doc(ctx(BOB), 'users', BOB, 'rivalry', ALICE)))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('Equipos armados: el sello teamsAssignedAt', () => {
  // Lo escribe assignTeams (useRegistration.js) en el mismo batch que reparte
  // los `team`. Es lo que le da el pie al aviso de hype: sin este sello, el
  // mensaje no puede afirmar contra quién jugás hoy. Mismo permiso que asignar
  // los equipos — acceso anticipado en el grupo (OG/owner/admin) o admin.

  test('quien arma los equipos puede sellar el momento', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'matches', MATCH_A), {
        teamsAssignedAt: new Date(), updatedAt: new Date(),
      }),
    )
  })

  test('un miembro común NO puede sellarlo (tampoco puede armar equipos)', async () => {
    await assertFails(
      updateDoc(doc(ctx(BOB), 'matches', MATCH_A), {
        teamsAssignedAt: new Date(), updatedAt: new Date(),
      }),
    )
  })

  test('alguien de otro grupo NO puede sellarlo', async () => {
    await assertFails(
      updateDoc(doc(ctx(MALLORY), 'matches', MATCH_A), {
        teamsAssignedAt: new Date(), updatedAt: new Date(),
      }),
    )
  })

  test('por esta rama NO se puede colar ningún otro campo', async () => {
    // Si el sello sirviera de rendija para tocar otra cosa, quien arma los
    // equipos podría cerrar la lista o cambiar el resultado de paso.
    await assertFails(
      updateDoc(doc(ctx(ALICE), 'matches', MATCH_A), {
        teamsAssignedAt: new Date(), status: 'closed',
      }),
    )
    await assertFails(
      updateDoc(doc(ctx(ALICE), 'matches', MATCH_A), {
        teamsAssignedAt: new Date(), maxPlayers: 99,
      }),
    )
  })

  test('nadie puede marcar hypeMsgSent desde el cliente', async () => {
    // Lo escribe SOLO runMatchHypeNotify por admin SDK. Si el cliente pudiera,
    // cualquiera se saltearía el aviso de todo el grupo poniéndolo en true.
    await assertFails(
      updateDoc(doc(ctx(ALICE), 'matches', MATCH_A), { hypeMsgSent: true }),
    )
    await assertFails(
      updateDoc(doc(ctx(BOB), 'matches', MATCH_A), { hypeMsgSent: true }),
    )
  })
})
