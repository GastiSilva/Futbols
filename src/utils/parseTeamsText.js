// src/utils/parseTeamsText.js
// ─────────────────────────────────────────────────────────────────────────────
// Lee un listado de equipos escrito a mano (el mensaje de WhatsApp donde el
// grupo ya armó A y B) y lo traduce a asignaciones sobre las inscripciones
// reales del partido.
//
// Por qué existe: muchos grupos arman los equipos en el chat, no en la app.
// Sin esta puerta de entrada había que reasignar de a un jugador por vez con
// los chips — y como la app no se enteraba, el aviso previo (`match_hype`),
// las estadísticas por equipo y el resultado quedaban sin la formación real.
//
// Función PURA: recibe el texto y la lista de inscriptos, devuelve qué le
// tocaría a cada uno. No escribe nada — decide el que pegó el texto, después
// de ver la propuesta en pantalla.
// ─────────────────────────────────────────────────────────────────────────────

// Normaliza un nombre para comparar: sin tildes, sin emojis, sin puntuación,
// minúsculas y con los espacios colapsados. "José  Pérez ⚽" → "jose perez".
function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Saca el "1." / "- " / "• " del principio del renglón. La numeración del
// mensaje de WhatsApp no es dato: el orden lo define el equipo, no el número.
function stripListMarker(line) {
  return line.replace(/^\s*(?:\d{1,2}\s*[).\-:º°]?|[-–—•*·▪◦>])\s*/, '').trim()
}

// ── Encabezados ───────────────────────────────────────────────────────────
// Un renglón es encabezado solo si TODO el renglón lo es. Aceptarlo como
// prefijo haría que un "Equipo A vs Equipo B" partiera el listado por la
// mitad sin que se note.
const TEAM_WORD = '(?:equipo|equipos|team|eq|grupo)'
const HEADER_A = new RegExp(`^${TEAM_WORD}\\s*(?:a|1|uno|i)$`)
const HEADER_B = new RegExp(`^${TEAM_WORD}\\s*(?:b|2|dos|ii)$`)
// Forma corta ("A:" / "1:"). Se exige que el renglón original termine en ':'
// porque "A" a secas puede ser el apodo de alguien.
const SHORT_A = /^(?:a|1|i)$/
const SHORT_B = /^(?:b|2|ii)$/
const HEADER_NONE = /^(?:suplentes?|reservas?|banco|sin equipo(?: asignado)?|afuera)$/

/**
 * @param {string} rawLine renglón ya sin el marcador de lista
 * @returns {'A'|'B'|null|undefined} el equipo que abre, o undefined si no es encabezado
 */
function headerTeam(rawLine) {
  const endsWithColon = /[:：]\s*$/.test(rawLine)
  const key = normalizeName(rawLine)
  if (!key) return undefined
  if (HEADER_A.test(key)) return 'A'
  if (HEADER_B.test(key)) return 'B'
  if (HEADER_NONE.test(key)) return null
  if (endsWithColon && SHORT_A.test(key)) return 'A'
  if (endsWithColon && SHORT_B.test(key)) return 'B'
  return undefined
}

// Renglones que no son ni encabezado ni jugador: el título del partido, la
// sede, el horario, el link para anotarse. Se descartan para que no terminen
// buscando a un jugador llamado "Cancha 3".
function isNoise(line) {
  if (!line) return true
  if (/^(?:https?:\/\/|www\.)/i.test(line)) return true
  // Los emojis con los que "Compartir lista" encabeza título/sede/horario.
  if (/^[⚽📍🕒📅🏟]/u.test(line)) return true
  // Texto suelto terminado en ':' que no es ninguno de los encabezados
  // conocidos ("Anotate acá:").
  if (/[:：]\s*$/.test(line) && headerTeam(line) === undefined) return true
  return false
}

/**
 * Separa el texto en los nombres de cada equipo.
 * @returns {{ A: string[], B: string[], none: string[], sawHeaders: boolean }}
 */
function splitByTeam(text) {
  const rawLines = String(text ?? '').split(/\r?\n/)
  const out = { A: [], B: [], none: [], sawHeaders: false }
  let current // undefined hasta el primer encabezado

  const blocks = [[]] // para el fallback sin encabezados
  rawLines.forEach((raw) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      if (blocks[blocks.length - 1].length > 0) blocks.push([])
      return
    }
    const line = stripListMarker(trimmed)
    const header = headerTeam(line)
    if (header !== undefined) {
      out.sawHeaders = true
      current = header
      if (blocks[blocks.length - 1].length > 0) blocks.push([])
      return
    }
    if (isNoise(line)) return
    blocks[blocks.length - 1].push(line)
    if (current !== undefined) {
      if (current === null) out.none.push(line)
      else out[current].push(line)
    }
  })

  // Fallback: sin ningún encabezado, dos bloques separados por una línea en
  // blanco son la forma más común de escribir los equipos en el chat. Con uno
  // solo, o con tres o más, no hay manera de adivinar cuál es cuál: se
  // devuelve vacío y la pantalla pide que agreguen "Equipo A:" / "Equipo B:".
  if (!out.sawHeaders) {
    const full = blocks.filter((b) => b.length > 0)
    if (full.length === 2) {
      out.A = full[0]
      out.B = full[1]
    }
  }

  return out
}

// ── Emparejar un nombre escrito con una inscripción ───────────────────────
// Por niveles, de más seguro a más flojo. El que escribe en WhatsApp pone
// "Juan" donde la app tiene "Juan Pérez", así que el nombre de pila tiene que
// alcanzar; pero un "contiene" a secas emparejaría "Ana" con "Mariana", por
// eso los niveles flojos comparan palabras enteras, nunca pedazos.
function candidateScore(written, reg) {
  const w = written.norm
  const r = reg.norm
  if (!w || !r) return 0
  if (w === r) return 4
  if (r.startsWith(`${w} `) || w.startsWith(`${r} `)) return 3
  if (reg.tokens[0] && written.tokens[0] && reg.tokens[0] === written.tokens[0]) return 2
  if (reg.tokens.includes(w) || written.tokens.includes(r)) return 1
  return 0
}

/**
 * Traduce un listado de texto a asignaciones de equipo sobre las
 * inscripciones del partido.
 *
 * @param {string} text texto pegado (WhatsApp, notas, lo que sea)
 * @param {Array<{ id: string, displayName: string, userId?: string|null }>} registrations
 *        titulares del partido (los suplentes no se pasan: no se les arma equipo)
 * @returns {{
 *   assignments: Array<{ registrationId: string, displayName: string, userId: string|null, team: 'A'|'B'|null }>,
 *   unmatched: string[],   nombres del texto que no existen en la lista
 *   ambiguous: string[],   nombres que podían ser dos personas distintas
 *   missing: string[],     inscriptos que el texto no nombra (quedan sin equipo)
 *   assignedCount: number,
 *   sawHeaders: boolean,
 * }}
 */
export function parseTeamsText(text, registrations = []) {
  const { A, B, none, sawHeaders } = splitByTeam(text)

  const pool = registrations.map((r) => {
    const norm = normalizeName(r.displayName)
    return { reg: r, norm, tokens: norm.split(' ').filter(Boolean), taken: false }
  })

  const teamByRegId = new Map()
  const unmatched = []
  const ambiguous = []

  const assignName = (written, team) => {
    const norm = normalizeName(written)
    if (!norm) return
    const w = { norm, tokens: norm.split(' ').filter(Boolean) }

    let best = null
    let bestScore = 0
    let tiesAtBest = 0
    pool.forEach((c) => {
      if (c.taken) return
      const score = candidateScore(w, c)
      if (score > bestScore) {
        bestScore = score
        best = c
        tiesAtBest = 1
      } else if (score === bestScore && score > 0) {
        tiesAtBest += 1
      }
    })

    if (!best || bestScore === 0) {
      unmatched.push(written)
      return
    }
    // Dos personas empatadas en el mismo nivel de coincidencia (dos "Juan"):
    // se toma la primera para no dejar el equipo incompleto, pero se avisa,
    // porque acá la app puede estar poniendo al Juan equivocado.
    if (tiesAtBest > 1) ambiguous.push(written)
    best.taken = true
    teamByRegId.set(best.reg.id, team)
  }

  A.forEach((n) => assignName(n, 'A'))
  B.forEach((n) => assignName(n, 'B'))
  none.forEach((n) => assignName(n, null))

  const assignments = registrations.map((r) => ({
    registrationId: r.id,
    displayName: r.displayName,
    userId: r.userId ?? null,
    team: teamByRegId.has(r.id) ? teamByRegId.get(r.id) : null,
  }))

  const missing = pool.filter((c) => !c.taken).map((c) => c.reg.displayName)
  const assignedCount = assignments.filter((a) => a.team === 'A' || a.team === 'B').length

  return { assignments, unmatched, ambiguous, missing, assignedCount, sawHeaders }
}
