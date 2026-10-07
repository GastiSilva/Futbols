// src/utils/serverClock.js
// ─────────────────────────────────────────────────────────────────────────────
// Hora del SERVIDOR, estimada desde el cliente.
//
// Las reglas de Firestore deciden si la lista está abierta con `request.time`
// (reloj de Google). El cliente lo decidía con `Date.now()` (reloj del celular).
// Con el celular adelantado unos segundos, la cuenta regresiva llegaba a cero
// antes de tiempo, el botón "Anotarme" se habilitaba, el chequeo del cliente
// pasaba… y las reglas rechazaban la inscripción con permission-denied —
// justo en el momento en que todo el grupo está apretando a la vez.
//
// La corrección se saca del header `Date` de una respuesta HEAD de Firebase
// Hosting: no cuesta ninguna lectura de Firestore y el Service Worker no la
// intercepta (Workbox solo enruta GET). El header tiene precisión de segundos
// (truncado hacia abajo), así que la estimación queda a lo sumo ~1s ATRASADA
// respecto del servidor, nunca adelantada: lo seguro es habilitar el botón un
// segundo tarde, no un segundo antes de que las reglas lo acepten.
// ─────────────────────────────────────────────────────────────────────────────

let offsetMs = 0
let syncPromise = null

// Ahora, según el servidor (mejor estimación). Sin sincronizar todavía (o si
// la sincronización falló) devuelve el reloj local: nunca peor que antes.
export function serverNow() {
  return Date.now() + offsetMs
}

// Diferencia actual reloj-del-servidor menos reloj-local (para diagnósticos).
export function serverClockOffsetMs() {
  return offsetMs
}

// Mide el desfasaje una vez por carga de la app. Seguro de llamar varias veces.
export function syncServerClock() {
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    try {
      const res = await fetch(`/?_clock=${Date.now()}`, { method: 'HEAD', cache: 'no-store' })
      const receivedAt = Date.now()
      const header = res.headers.get('date')
      const serverMs = header ? Date.parse(header) : NaN
      if (Number.isNaN(serverMs)) return
      offsetMs = serverMs - receivedAt
      if (Math.abs(offsetMs) > 2000) {
        console.warn(`[serverClock] el reloj del dispositivo difiere ${Math.round(offsetMs / 1000)}s del servidor`)
      }
    } catch (err) {
      // Sin conexión o sin header: se sigue con el reloj local.
      console.warn('[serverClock] no se pudo sincronizar', err)
      syncPromise = null // reintenta en la próxima llamada
    }
  })()
  return syncPromise
}
