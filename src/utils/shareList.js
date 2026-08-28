// src/utils/shareList.js
// ─────────────────────────────────────────────────────────────────────────────
// Armado y compartido de la lista de anotados en texto plano (WhatsApp).
//
// Vivía duplicado en DashboardPage y MatchDetailPage: dos copias de la misma
// función que ya habían divergido (la del dashboard nunca aprendió a mostrar
// los equipos A/B). Una sola implementación, con los equipos como parte
// opcional, sirve a las dos pantallas.
// ─────────────────────────────────────────────────────────────────────────────
import { buildMatchInviteLink } from 'src/composables/useMatchInvite'

/**
 * Texto plano de la lista, listo para pegar en un chat.
 *
 * @param {object}   opts
 * @param {object}   opts.match         partido (title, location, maxPlayers, id)
 * @param {string}   [opts.when]        fecha/hora ya formateada ("sáb 12 - 20:00")
 * @param {Array}    opts.starters      titulares (con position y displayName)
 * @param {Array}    [opts.waitlist]    suplentes
 * @param {boolean}  [opts.teamsAssigned] si hay equipos armados, se listan por equipo
 * @param {Array}    [opts.teamA]       titulares del equipo A
 * @param {Array}    [opts.teamB]       titulares del equipo B
 * @param {Array}    [opts.noTeam]      titulares todavía sin equipo
 * @param {boolean}  [opts.includeInviteLink=true] un invitado anónimo no comparte link
 * @returns {string}
 */
export function buildListText({
  match,
  when = '',
  starters = [],
  waitlist = [],
  teamsAssigned = false,
  teamA = [],
  teamB = [],
  noTeam = [],
  includeInviteLink = true,
}) {
  if (!match) return ''

  const lines = []
  lines.push(`⚽ ${match.title}`)
  if (match.location) lines.push(`📍 ${match.location}`)
  if (when) lines.push(`🕒 ${when}`)
  lines.push('')

  if (teamsAssigned) {
    lines.push('Equipo A:')
    teamA.forEach((r) => lines.push(`- ${r.displayName}`))
    lines.push('')
    lines.push('Equipo B:')
    teamB.forEach((r) => lines.push(`- ${r.displayName}`))
    if (noTeam.length > 0) {
      lines.push('')
      lines.push('Sin equipo asignado:')
      noTeam.forEach((r) => lines.push(`- ${r.displayName}`))
    }
  } else {
    // Se numera por el ORDEN del array, no por `r.position`: ese campo puede
    // venir con huecos si el renumerado de fondo no corrió, y el mensaje que
    // se pega en WhatsApp saltaría del 5 al 9.
    starters.forEach((r, i) => lines.push(`${i + 1}. ${r.displayName}`))
  }

  if (waitlist.length > 0) {
    lines.push('')
    lines.push('Suplentes:')
    // 1º suplente, 2º suplente… sale del orden del array, así que no depende
    // de `position` ni de restar `maxPlayers` (que en formato libre es null y
    // daba NaN).
    waitlist.forEach((r, i) => lines.push(`${i + 1}. ${r.displayName}`))
  }

  // Link de invitación: quien lo abre cae en la landing que le deja elegir
  // entre entrar como invitado o con su cuenta. Un invitado anónimo no lo
  // comparte — su link no serviría para sumar a nadie a un grupo del que él
  // mismo no forma parte, y de paso evita que la cadena se propague.
  // El link va SOLO en su renglón y sin emojis alrededor: WhatsApp deja de
  // autolinkear una URL si tiene texto o caracteres no-ASCII pegados.
  if (includeInviteLink) {
    lines.push('')
    lines.push('Anotate acá:')
    lines.push(buildMatchInviteLink(match.id))
  }

  return lines.join('\n')
}

/**
 * Comparte el texto por el share nativo, o lo copia al portapapeles.
 * `notify` es la instancia de Quasar ($q.notify) — se inyecta para que este
 * módulo no dependa del framework.
 */
export async function shareListText(text, notify) {
  if (!text) return

  if (navigator.share) {
    try {
      await navigator.share({ text })
    } catch {
      // el usuario canceló el share nativo — no hay nada que informar
    }
    return
  }

  try {
    await navigator.clipboard.writeText(text)
    notify?.({ type: 'positive', icon: 'content_copy', message: 'Lista copiada al portapapeles' })
  } catch {
    notify?.({ type: 'negative', message: 'No se pudo copiar la lista' })
  }
}
