// ─────────────────────────────────────────────────────────────────────────────
// Registro de bajas (solo lectura, solo admin global).
//
// Las filas de `dropouts` las escriben las Cloud Functions: onRegistrationDeleted
// ('left': se bajó o lo bajaron) y replaceRegistration ('replaced': otro jugó en
// su lugar). Acá solo se leen y se agrupan por jugador para el panel de admin.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { collection, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { db } from 'src/services/firebase'

// Bajarse con menos de esto antes del partido es lo que de verdad complica:
// ya no hay tiempo de conseguir a otro. Avisar con días no cuenta como tarde.
export const LATE_DROPOUT_HOURS = 24
const MAX_ROWS = 1000

export function useDropouts() {
  const loading = ref(false)
  const error = ref(null)

  async function fetchDropouts(days) {
    loading.value = true
    error.value = null
    try {
      const since = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000)
      const snap = await getDocs(
        query(
          collection(db, 'dropouts'),
          where('droppedAt', '>=', since),
          orderBy('droppedAt', 'desc'),
          limit(MAX_ROWS),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  return { loading, error, fetchDropouts }
}

// Agrupa por jugador. "Tarde" = titular que se bajó con menos de
// LATE_DROPOUT_HOURS (o directamente no vino): la baja de un suplente no le
// deja un hueco a nadie. Ordena por lo que más molesta primero.
export function summarizeDropouts(rows) {
  const byUser = new Map()
  for (const r of rows) {
    if (!r.userId) continue
    const entry = byUser.get(r.userId) ?? {
      userId: r.userId,
      displayName: r.displayName || 'Sin nombre',
      total: 0,
      late: 0,
      replaced: 0,
      rows: [],
    }
    entry.total += 1
    if (r.kind === 'replaced') entry.replaced += 1
    const isLate = r.hoursBeforeMatch != null && r.hoursBeforeMatch < LATE_DROPOUT_HOURS
    if (r.wasStarter !== false && (isLate || r.kind === 'replaced')) entry.late += 1
    entry.rows.push(r)
    byUser.set(r.userId, entry)
  }
  return [...byUser.values()].sort(
    (a, b) => b.late - a.late || b.total - a.total || a.displayName.localeCompare(b.displayName),
  )
}
