// src/composables/useSanction.js
// ─────────────────────────────────────────────────────────────────────────────
// Sanción por bajas — lado cliente (solo lectura + el "¿seguro?").
//
// Las reglas viven en el backend (functions/sanctions.js); `sanctions/{groupId}_{uid}`
// lo escribe únicamente la Cloud Function. Acá solo se lee la propia para avisarle
// al jugador, ANTES de anotarse, que esta inscripción va con prioridad baja.
// No bloquea: la sanción se aplica igual en el servidor, el diálogo es para que
// sepa lo que está haciendo.
// ─────────────────────────────────────────────────────────────────────────────
import { doc, getDoc } from 'firebase/firestore'
import { useQuasar } from 'quasar'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

export function useSanction() {
  const $q = useQuasar()
  const authStore = useAuthStore()

  // ¿Tiene una sanción pendiente (vigente) en este grupo?
  async function hasPendingSanction(groupId) {
    const uid = authStore.user?.uid
    if (!groupId || !uid || authStore.isGuest) return false
    try {
      const snap = await getDoc(doc(db, 'sanctions', `${groupId}_${uid}`))
      if (!snap.exists()) return false
      const s = snap.data()
      const expiresMs = s.expiresAt?.toMillis?.() ?? 0
      return s.pending === true && expiresMs > Date.now()
    } catch {
      // Si no se puede leer, no se frena la inscripción por una pregunta de cortesía.
      return false
    }
  }

  // Resuelve true si puede seguir con la inscripción (sin sanción, o la confirmó).
  async function confirmJoinIfSanctioned(groupId) {
    if (!(await hasPendingSanction(groupId))) return true
    return new Promise((resolve) => {
      $q.dialog({
        title: '¿Seguro que vas a dejar a los pibes colgados una vez más?',
        message:
          'Venís con varias bajas en los últimos 2 meses. Podés anotarte, pero con prioridad baja: ' +
          'si se llena la lista y se suma un suplente, te quedás afuera. Después de esta, arrancás de cero.',
        cancel: { flat: true, label: 'Mejor no' },
        ok: { unelevated: true, color: 'orange-8', label: 'Anotarme igual' },
        persistent: true,
      })
        .onOk(() => resolve(true))
        .onCancel(() => resolve(false))
        .onDismiss(() => resolve(false))
    })
  }

  return { hasPendingSanction, confirmJoinIfSanctioned }
}
