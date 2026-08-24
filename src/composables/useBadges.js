// src/composables/useBadges.js
// ─────────────────────────────────────────────────────────────────────────────
//  Lectura de las insignias mensuales de un perfil.
//
//  Solo lectura a propósito: las insignias las otorga la tarea runMonthlyBadges
//  (functions/index.js) con el admin SDK, y las reglas niegan TODA escritura
//  desde el cliente. Acá no hay ni puede haber un `awardBadge`.
// ─────────────────────────────────────────────────────────────────────────────

import { ref } from 'vue'
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore'
import { db } from 'src/services/firebase'

// Techo de insignias a traer. Un perfil con años de historial no necesita
// bajarse todo para pintar una fila de chips.
const BADGE_QUERY_LIMIT = 60

export function useBadges() {
  const loading = ref(false)
  const error = ref(null)

  /**
   * Insignias de un usuario, de la más reciente a la más vieja.
   * Se ordena por `period` (string '2026-08') y no por `wonAt`: el período es
   * el dato real del premio, mientras que wonAt es cuándo corrió la tarea.
   * Como el formato es AAAA-MM, el orden alfabético ES el cronológico.
   */
  async function getUserBadges(uid) {
    if (!uid) return []
    loading.value = true
    error.value = null
    try {
      const snap = await getDocs(
        query(
          collection(db, 'users', uid, 'badges'),
          orderBy('period', 'desc'),
          limit(BADGE_QUERY_LIMIT),
        ),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    } catch (err) {
      error.value = err.message ?? 'No se pudieron cargar las insignias.'
      console.error('getUserBadges:', err)
      return []
    } finally {
      loading.value = false
    }
  }

  return { getUserBadges, loading, error }
}
