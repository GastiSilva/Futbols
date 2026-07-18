// src/utils/calendar.js
// ─────────────────────────────────────────────────────────────────────────────
// Genera un link "Agregar a Google Calendar" para un partido. Como todos entran
// con Google, el link de plantilla les abre el evento listo para guardar (no
// requiere permisos extra ni backend). En iPhone el mismo link abre Google
// Calendar web si tienen la cuenta iniciada.
// ─────────────────────────────────────────────────────────────────────────────

// Duración por defecto del evento (min) cuando el partido no la especifica.
const DEFAULT_DURATION_MIN = 90

// Fecha en formato básico UTC que espera Google Calendar: YYYYMMDDTHHMMSSZ
function toCalDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// Normaliza el campo `date` del partido (Timestamp de Firestore o Date/número).
function resolveStart(match) {
  const raw = match?.date
  if (!raw) return null
  if (typeof raw.toDate === 'function') return raw.toDate()
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

// URL para agregar el partido a Google Calendar, o null si no hay fecha.
export function buildGoogleCalendarUrl(match) {
  const start = resolveStart(match)
  if (!start) return null

  const durationMin = Number(match?.durationMin) || DEFAULT_DURATION_MIN
  const end = new Date(start.getTime() + durationMin * 60 * 1000)

  const details = []
  if (match?.format) details.push(`Formato: ${match.format}`)
  if (match?.venueMapsUrl) details.push(`Ubicación en Maps: ${match.venueMapsUrl}`)

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `⚽ ${match?.title || 'Partido'}`,
    dates: `${toCalDate(start)}/${toCalDate(end)}`,
    details: details.join('\n'),
    location: match?.location || '',
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
