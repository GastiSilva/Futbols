// src/composables/useReports.js
// ─────────────────────────────────────────────────────────────────────────────
// Denuncias de usuarios. Mínimo viable de moderación: se escribe el reporte y
// un admin lo revisa a mano desde la consola de Firebase (no hay panel).
//
// Nadie puede LEER los reportes salvo un admin — ni siquiera quien los escribió
// (ver firestore.rules). Por eso acá solo hay una función de escritura.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

// Motivos predefinidos. Tener una lista cerrada (en vez de solo texto libre)
// hace que los reportes se puedan agrupar y priorizar sin leerlos todos.
export const REPORT_REASONS = [
  { value: 'no_show', label: 'No se presentó al partido' },
  { value: 'behavior', label: 'Mala conducta o agresión' },
  { value: 'fake_profile', label: 'Perfil falso o datos inventados' },
  { value: 'payment', label: 'No pagó su parte de la cancha' },
  { value: 'spam', label: 'Spam o mensajes molestos' },
  { value: 'other', label: 'Otro motivo' },
]

export const MAX_REPORT_DETAILS = 1000

export function useReports() {
  const authStore = useAuthStore()
  const loading = ref(false)
  const error = ref(null)

  /**
   * Denuncia a otro usuario.
   * @param {string} reportedUserId  a quién se reporta
   * @param {string} reason          uno de REPORT_REASONS (value)
   * @param {string} details         texto libre opcional del denunciante
   * @param {string|null} matchId    partido donde pasó, si aplica (da contexto)
   */
  async function reportUser(reportedUserId, reason, details = '', matchId = null) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('Usuario no autenticado')
    if (!reportedUserId) throw new Error('Falta a quién reportar.')
    if (reportedUserId === uid) throw new Error('No podés reportarte a vos mismo.')
    if (!REPORT_REASONS.some((r) => r.value === reason)) {
      throw new Error('Elegí un motivo para el reporte.')
    }

    const trimmed = (details ?? '').trim().slice(0, MAX_REPORT_DETAILS)

    loading.value = true
    error.value = null
    try {
      await addDoc(collection(db, 'reports'), {
        reporterId: uid,
        reporterName: authStore.user?.nickname || authStore.user?.displayName || null,
        reportedUserId,
        reason,
        details: trimmed,
        matchId: matchId ?? null,
        status: 'pending',
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  return { loading, error, reportUser }
}
