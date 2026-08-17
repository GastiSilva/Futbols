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
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
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
