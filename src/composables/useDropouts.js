// ─────────────────────────────────────────────────────────────────────────────
// Registro de bajas (solo lectura, solo admin global).
//
// Las filas de `dropouts` las escriben las Cloud Functions: onRegistrationDeleted
// ('left': se bajó o lo bajaron) y replaceRegistration ('replaced': otro jugó en
// su lugar). Acá solo se leen y se agrupan por jugador para el panel de admin.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import {
  collection, documentId, getDocs, limit, orderBy, query, Timestamp, where,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { errorCode } from 'src/utils/errors'

// Bajarse con menos de esto antes del partido es lo que de verdad complica:
// ya no hay tiempo de conseguir a otro. Avisar con días no cuenta como tarde.
export const LATE_DROPOUT_HOURS = 24
const MAX_ROWS = 1000
// Tope del operador `in` de Firestore: los nombres de grupo se piden en tandas.
const IN_BATCH = 30

export function useDropouts() {
  const loading = ref(false)
  const error = ref(null)

  function runQuery(since, groupId) {
    // El filtro por grupo va en la QUERY, no en memoria: así el tope de
    // MAX_ROWS se aplica al grupo elegido y no a la colección entera. Con el
    // filtro en memoria, un período con muchas bajas se cortaba en las 1000
    // más recientes de TODOS los grupos y el panel mostraba un grupo
    // incompleto sin avisar. Requiere el índice groupId + droppedAt.
    return getDocs(
      query(
        collection(db, 'dropouts'),
        ...(groupId ? [where('groupId', '==', groupId)] : []),
        where('droppedAt', '>=', since),
        orderBy('droppedAt', 'desc'),
        limit(MAX_ROWS),
      ),
    ).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  }

  /**
   * Bajas de los últimos `days` días, opcionalmente de un solo grupo.
   * @param {number} days
   * @param {string|null} groupId  null = todos los grupos
   */
  async function fetchDropouts(days, groupId = null) {
    loading.value = true
    error.value = null
    try {
      const since = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000)
      try {
        return await runQuery(since, groupId)
      } catch (err) {
        // El índice compuesto tarda unos minutos en construirse después de
        // desplegarlo, y hasta entonces la query por grupo falla entera. En esa
        // ventana se cae al filtro en memoria: el panel sigue andando (con el
        // tope aplicado a toda la colección) en vez de mostrar un error.
        if (groupId && errorCode(err) === 'failed-precondition') {
          const all = await runQuery(since, null)
          return all.filter((r) => r.groupId === groupId)
        }
        throw err
      }
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Nombres de los grupos que aparecen en las bajas, para el selector. Se
   * piden solo los ids presentes (no la colección entera): son un puñado y
   * así el panel no se trae cientos de grupos sin bajas.
   * @param {string[]} groupIds
   * @returns {Promise<Record<string, string>>} id → nombre
   */
  async function fetchGroupNames(groupIds) {
    const ids = [...new Set(groupIds.filter(Boolean))]
    if (ids.length === 0) return {}
    // Cada id pedido entra en el resultado, aunque el grupo esté borrado (ahí
    // queda en null). Si no, el id faltante se volvería a pedir en cada
    // recarga y el grupo no aparecería en el selector pese a tener bajas.
    const names = Object.fromEntries(ids.map((id) => [id, null]))
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      const batch = ids.slice(i, i + IN_BATCH)
      const snap = await getDocs(
        query(collection(db, 'groups'), where(documentId(), 'in', batch)),
      )
      snap.docs.forEach((d) => { names[d.id] = d.data().name ?? null })
    }
    return names
  }

  return { loading, error, fetchDropouts, fetchGroupNames }
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
