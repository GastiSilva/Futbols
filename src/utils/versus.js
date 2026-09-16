// ─────────────────────────────────────────────────────────────────────────────
// Frase del cara a cara ("vos vs Fulano") a partir de chemistry/rivalry.
//
// Antes el tono salía SOLO de `ganados / jugados`: con 2 ganados, 2 empates y
// 2 perdidos de 6 daba 33% y la frase era negativa, como si los otros cuatro
// fueran derrotas. Peor: con 0 perdidos de 6 (todo empates o casi) decía
// "perdés 0 de 6. Ponete las pilas hoy." con carita triste. Ahora el tono sale
// de comparar GANADOS contra PERDIDOS (el empate no suma para ningún lado) y
// la frase muestra siempre el registro completo, así nadie tiene que adivinar
// qué pasó con los partidos que no nombra.
//
// ⚠️ Duplicado en functions/index.js (describeVersus) para el aviso previo al
// partido. Si cambia el criterio acá, cambiarlo allá también.
// ─────────────────────────────────────────────────────────────────────────────

function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

// "2 ganados, 2 empatados y 2 perdidos" — omite los ceros para no leer
// "0 perdidos" como algo que pasó.
export function formatRecord(wins, draws, losses) {
  const parts = []
  if (wins > 0) parts.push(plural(wins, 'ganado', 'ganados'))
  if (draws > 0) parts.push(plural(draws, 'empatado', 'empatados'))
  if (losses > 0) parts.push(plural(losses, 'perdido', 'perdidos'))
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

// tone: 'good' | 'even' | 'bad'. `kind` = 'rival' (lo enfrentás) o 'mate'
// (juegan juntos). Devuelve null si no hay partidos.
export function describeVersus(kind, name, { games = 0, wins = 0, draws = 0, losses = 0 } = {}) {
  if (games <= 0) return null
  const record = formatRecord(wins, draws, losses)
  const rival = kind === 'rival'

  if (wins === 0 && losses === 0) {
    return {
      tone: 'even',
      text: rival
        ? `Con ${name} empatan siempre: ${plural(draws, 'empate', 'empates')} en ${games}. Hoy alguien tiene que ganar.`
        : `Con ${name} en el mismo equipo empatan siempre (${plural(draws, 'empate', 'empates')}). Hoy toca ganar.`,
    }
  }
  if (losses === 0) {
    return {
      tone: 'good',
      text: rival
        ? `Contra ${name} estás invicto: ${record}. Que no se entere.`
        : `Con ${name} no pierden nunca: ${record}. Sos su amuleto.`,
    }
  }
  if (wins > losses) {
    return {
      tone: 'good',
      text: rival
        ? `Contra ${name} vas arriba: ${record}.`
        : `Con ${name} les va bien: ${record}.`,
    }
  }
  if (wins === losses) {
    return {
      tone: 'even',
      text: rival
        ? `Contra ${name} está parejo: ${record}. Hoy se desempata.`
        : `Con ${name} están parejos: ${record}. Hoy se desempata.`,
    }
  }
  return {
    tone: 'bad',
    text: rival
      ? `Contra ${name} vas abajo: ${record}. Hoy es el día de descontar.`
      : `Con ${name} les cuesta: ${record}. A ver si hoy cambia.`,
  }
}
