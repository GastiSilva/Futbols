// src/utils/provincias.js
// ─────────────────────────────────────────────────────────────────────────────
//  Provincias argentinas: lista fija + normalización de nombres.
//
//  La lista es fija a propósito: son 24 y no cambian. Guardar un catálogo de
//  provincias/ciudades en Firestore sería mantener un dato que ya existe y no
//  se mueve.
//
//  La CIUDAD, en cambio, NO se lista: viene de lo que devuelve el geocoding y
//  se guarda como texto en cada sede. Un catálogo de las ~2000 localidades
//  argentinas sería mantener datos innecesarios.
// ─────────────────────────────────────────────────────────────────────────────

export const PROVINCIAS = [
  'Buenos Aires',
  'Ciudad Autónoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
]

// Nominatim y Georef nombran algunas provincias distinto entre sí (y distinto
// de como las escribiría un usuario). Sin normalizar, "CABA" y "Ciudad
// Autónoma de Buenos Aires" serían dos provincias diferentes en el filtro y
// los partidos quedarían repartidos entre ambas.
const ALIASES = {
  'caba': 'Ciudad Autónoma de Buenos Aires',
  'capital federal': 'Ciudad Autónoma de Buenos Aires',
  'ciudad de buenos aires': 'Ciudad Autónoma de Buenos Aires',
  'ciudad autonoma de buenos aires': 'Ciudad Autónoma de Buenos Aires',
  'buenos aires city': 'Ciudad Autónoma de Buenos Aires',
  'autonomous city of buenos aires': 'Ciudad Autónoma de Buenos Aires',
  'provincia de buenos aires': 'Buenos Aires',
  'tierra del fuego, antártida e islas del atlántico sur': 'Tierra del Fuego',
  'tierra del fuego, antartida e islas del atlantico sur': 'Tierra del Fuego',
}

// Quita tildes y pasa a minúsculas, para comparar sin depender de cómo esté
// escrito ("Córdoba" / "cordoba" / "CÓRDOBA" son la misma provincia).
function fold(value) {
  return (value ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Devuelve el nombre canónico de la provincia, o null si no se reconoce.
 * Acepta lo que venga de Nominatim, de Georef o escrito a mano.
 */
export function normalizeProvincia(raw) {
  const folded = fold(raw)
  if (!folded) return null

  const alias = ALIASES[folded]
  if (alias) return alias

  return PROVINCIAS.find((p) => fold(p) === folded) ?? null
}
