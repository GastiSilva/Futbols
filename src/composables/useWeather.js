// src/composables/useWeather.js
// ─────────────────────────────────────────────────────────────────────────────
// Clima del partido: pronóstico horario vía Open-Meteo (gratis, sin API key),
// llamado directo desde el navegador (sin Cloud Function — cero costo extra
// de invocaciones/lecturas). Solo se muestra en la página del partido, nunca
// como notificación push. Requiere que la sede tenga lat/lng geocodificados
// (useVenues.js) — si no los tiene, simplemente no hay nada que mostrar.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'

const CODE_LABELS = {
  0: 'despejado', 1: 'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'con niebla', 48: 'con niebla', 51: 'con llovizna', 53: 'con llovizna', 55: 'con llovizna',
  61: 'con lluvia', 63: 'con lluvia', 65: 'con lluvia fuerte',
  71: 'con nieve', 73: 'con nieve', 75: 'con nieve fuerte',
  80: 'con chaparrones', 81: 'con chaparrones', 82: 'con chaparrones fuertes',
  95: 'con tormenta', 96: 'con tormenta y granizo', 99: 'con tormenta y granizo',
}
const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99])

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Frases variadas según temperatura/lluvia/viento — se elige una al azar
// dentro de la categoría que corresponda, para que no sea siempre el mismo texto.
function buildPhrase({ temp, code, wind }) {
  const isRain = RAIN_CODES.has(code)
  const condition = CODE_LABELS[code] ?? 'variable'

  if (isRain) {
    return pick([
      `Se viene con lluvia (${Math.round(temp)}°) — llevá algo para cambiarte.`,
      `Va a estar ${condition}, ${Math.round(temp)}°. Puede complicar la cancha.`,
      `Pronóstico de lluvia para la hora del partido (${Math.round(temp)}°) — atentos.`,
    ])
  }
  if (temp <= 10) {
    return pick([
      `Va a estar frío para jugar (${Math.round(temp)}°) — abrigate bien.`,
      `Bajas temperaturas hoy (${Math.round(temp)}°), llevá campera para antes/después.`,
      `Frío en cancha: ${Math.round(temp)}°, ${condition}.`,
    ])
  }
  if (temp >= 28) {
    return pick([
      `Va a hacer calor (${Math.round(temp)}°) — hidratate bien antes del partido.`,
      `Altas temperaturas hoy (${Math.round(temp)}°), llevá agua de sobra.`,
      `Calor fuerte: ${Math.round(temp)}°, ${condition}.`,
    ])
  }
  if (wind >= 30) {
    return pick([
      `Va a soplar bastante viento (${Math.round(wind)} km/h) — puede afectar el juego.`,
      `Viento fuerte previsto (${Math.round(wind)} km/h), ${condition}.`,
    ])
  }
  return pick([
    `El clima está ideal para jugar — ${condition}, ${Math.round(temp)}°.`,
    `Buen clima para el partido: ${condition}, ${Math.round(temp)}°.`,
    `Condiciones parejas para jugar: ${Math.round(temp)}°, ${condition}.`,
  ])
}

// Cache en memoria por (lat,lng redondeados a 2 decimales) — evita repetir el
// fetch si se abre el mismo partido varias veces en la misma sesión.
const cache = new Map()
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 min

export function useWeather() {
  const loading = ref(false)
  const error = ref(null)

  /**
   * Trae el pronóstico horario más cercano a `targetDate` para (lat, lng).
   * Devuelve null si faltan coordenadas, la fecha está fuera de rango del
   * pronóstico (Open-Meteo da ~16 días), o falla la llamada (sin conexión).
   */
  async function fetchForecast(lat, lng, targetDate) {
    if (lat == null || lng == null || !targetDate) return null

    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`
    const cached = cache.get(cacheKey)
    const now = Date.now()

    loading.value = true
    error.value = null
    try {
      let hourly
      if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        hourly = cached.hourly
      } else {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&hourly=temperature_2m,weathercode,windspeed_10m&timezone=auto&forecast_days=16`
        const res = await fetch(url)
        if (!res.ok) return null
        const data = await res.json()
        hourly = data?.hourly
        if (!hourly?.time) return null
        cache.set(cacheKey, { hourly, fetchedAt: now })
      }

      // Encuentra la hora del pronóstico más cercana a targetDate
      const targetMs = targetDate.getTime()
      let bestIdx = -1
      let bestDiff = Infinity
      hourly.time.forEach((iso, idx) => {
        const diff = Math.abs(new Date(iso).getTime() - targetMs)
        if (diff < bestDiff) {
          bestDiff = diff
          bestIdx = idx
        }
      })
      // Más de 12hs de diferencia con el punto más cercano → fuera de rango útil
      if (bestIdx === -1 || bestDiff > 12 * 60 * 60 * 1000) return null

      const temp = hourly.temperature_2m[bestIdx]
      const code = hourly.weathercode[bestIdx]
      const wind = hourly.windspeed_10m[bestIdx]

      return {
        temp,
        code,
        wind,
        condition: CODE_LABELS[code] ?? 'variable',
        isRain: RAIN_CODES.has(code),
        phrase: buildPhrase({ temp, code, wind }),
      }
    } catch (err) {
      error.value = err.message
      return null
    } finally {
      loading.value = false
    }
  }

  return { loading, error, fetchForecast }
}
