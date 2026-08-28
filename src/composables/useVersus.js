// src/composables/useVersus.js
// ─────────────────────────────────────────────────────────────────────────────
// Historial cara a cara entre DOS jugadores: como compañeros (chemistry) y
// como rivales (rivalry). Puramente de lectura — ambas subcolecciones las
// escribe solo el backend (updateChemistryForPlayerStat en functions/index.js).
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { doc, getDoc } from 'firebase/firestore'
import { db } from 'src/services/firebase'

export function useVersus() {
  const loading = ref(false)
  const error = ref(null)

  /**
   * Trae el historial de `viewerUid` con `otherUid`, desde la perspectiva de
   * `viewerUid` (winsTogether/winsAgainst son SUS victorias, no las del otro).
   * @returns {Promise<{ chemistry: object|null, rivalry: object|null }>}
   */
  async function fetchVersus(viewerUid, otherUid) {
    loading.value = true
    error.value = null
    try {
      const [chemSnap, rivSnap] = await Promise.all([
        getDoc(doc(db, 'users', viewerUid, 'chemistry', otherUid)),
        getDoc(doc(db, 'users', viewerUid, 'rivalry', otherUid)),
      ])
      return {
        chemistry: chemSnap.exists() ? chemSnap.data() : null,
        rivalry: rivSnap.exists() ? rivSnap.data() : null,
      }
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  return { loading, error, fetchVersus }
}
