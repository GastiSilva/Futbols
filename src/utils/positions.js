// src/utils/positions.js
// ─────────────────────────────────────────────────────────────────────────────
// Posiciones de cancha para el selector visual del perfil (estilo FIFA).
// Pensadas para partidos de F7 / F8: arquero, línea de fondo, mediocampo y
// ataque. Las coordenadas (x, y) están en % sobre una cancha VERTICAL con el
// arco propio abajo (y≈100) y el ataque arriba (y≈0).
// ─────────────────────────────────────────────────────────────────────────────

export const PITCH_POSITIONS = [
  { code: 'ARQ', label: 'Arquero', short: 'ARQ', x: 50, y: 127, zone: 'arco' },
  { code: 'LTI', label: 'Lateral izquierdo', short: 'LTI', x: 16, y: 106, zone: 'defensa' },
  { code: 'DFC', label: 'Defensor central', short: 'DFC', x: 50, y: 109, zone: 'defensa' },
  { code: 'LTD', label: 'Lateral derecho', short: 'LTD', x: 84, y: 106, zone: 'defensa' },
  { code: 'MCD', label: 'Volante defensivo', short: 'MCD', x: 50, y: 88, zone: 'medio' },
  { code: 'MI', label: 'Volante izquierdo', short: 'MI', x: 18, y: 69, zone: 'medio' },
  { code: 'MC', label: 'Mediocampista central', short: 'MC', x: 50, y: 67, zone: 'medio' },
  { code: 'MD', label: 'Volante derecho', short: 'MD', x: 82, y: 69, zone: 'medio' },
  { code: 'MCO', label: 'Enganche', short: 'MCO', x: 50, y: 48, zone: 'ataque' },
  { code: 'EI', label: 'Extremo izquierdo', short: 'EI', x: 18, y: 28, zone: 'ataque' },
  { code: 'DC', label: 'Delantero centro', short: 'DC', x: 50, y: 20, zone: 'ataque' },
  { code: 'ED', label: 'Extremo derecho', short: 'ED', x: 82, y: 28, zone: 'ataque' },
]

// Máximo de posiciones favoritas que puede elegir un jugador.
export const MAX_FAVORITE_POSITIONS = 5

const BY_CODE = Object.fromEntries(PITCH_POSITIONS.map((p) => [p.code, p]))

// Devuelve la definición de una posición por su código.
export function getPosition(code) {
  return BY_CODE[code] ?? null
}

// Etiqueta legible de un código ('DC' → 'Delantero centro').
export function positionLabel(code) {
  return BY_CODE[code]?.label ?? code
}

// Filtra/ordena una lista de códigos según el orden natural de la cancha
// (arco → defensa → medio → ataque), descartando códigos desconocidos.
export function normalizePositions(codes) {
  if (!Array.isArray(codes)) return []
  const set = new Set(codes)
  return PITCH_POSITIONS.filter((p) => set.has(p.code)).map((p) => p.code)
}
