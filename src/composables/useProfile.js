// src/composables/useProfile.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable para ver el perfil de OTRO usuario (compañero de grupo) y para
// calificar en privado si su descripción es real (1-5 estrellas).
// El promedio lo calcula la Cloud Function onDescriptionRatingWritten — acá
// solo se lee lo ya calculado (users/{uid}/private/descriptionStars) o el
// propio voto (users/{uid}/descriptionRatings/{miUid}).
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

export function useProfile() {
  const authStore = useAuthStore()
  const loading = ref(false)
  const error = ref(null)

  // Perfil completo de otro usuario (mismos campos que se muestran en el propio).
  async function fetchProfile(uid) {
    loading.value = true
    error.value = null
    try {
      const snap = await getDoc(doc(db, 'users', uid))
      if (!snap.exists()) throw new Error('Perfil no encontrado.')
      return { uid: snap.id, ...snap.data() }
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // Promedio de estrellas de MI PROPIA descripción (solo yo puedo leerlo).
  async function fetchMyDescriptionStars() {
    const uid = authStore.user?.uid
    if (!uid) return { avg: 0, count: 0 }
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'private', 'descriptionStars'))
      return snap.exists() ? snap.data() : { avg: 0, count: 0 }
    } catch {
      // Puede no existir todavía (nadie calificó) o fallar sin conexión
      return { avg: 0, count: 0 }
    }
  }

  // Mi voto previo sobre la descripción de otro usuario (para mostrar "ya lo calificaste").
  async function fetchMyRatingFor(targetUid) {
    const uid = authStore.user?.uid
    if (!uid || uid === targetUid) return null
    try {
      const snap = await getDoc(doc(db, 'users', targetUid, 'descriptionRatings', uid))
      return snap.exists() ? snap.data().stars : null
    } catch {
      return null
    }
  }

  // ── ¿Comparto algún grupo con esta persona? ─────────────────────────────────
  // Devuelve el id del PRIMER grupo en común, o null si no comparten ninguno.
  // Se usa para dos cosas: decidir si mostrar el bloque de calificación en el
  // perfil, y para mandar ese id en el voto (las reglas lo exigen y verifican
  // que ambos sean miembros de ese grupo — ver descriptionRatings).
  //
  // Recorre MIS grupos preguntando si el otro es miembro, en vez de pedir los
  // grupos del otro: `members` es legible globalmente, pero enumerar los grupos
  // de otra persona expondría su mapa social a cualquiera que abra su perfil.
  async function findSharedGroupId(targetUid) {
    const uid = authStore.user?.uid
    if (!uid || !targetUid || uid === targetUid) return null

    const myGroupIds = authStore.memberGroupIds ?? []
    for (const groupId of myGroupIds) {
      try {
        const snap = await getDoc(doc(db, 'groups', groupId, 'members', targetUid))
        if (snap.exists()) return groupId
      } catch {
        // sin permiso o sin conexión → se sigue con el próximo grupo
      }
    }
    return null
  }

  // Califica (o actualiza mi calificación de) la descripción de otro usuario.
  // Solo se puede calificar a alguien con quien se comparte un grupo: un
  // desconocido no tiene forma de saber si la descripción es real, y con los
  // partidos públicos ese voto sería un arma contra quien se postula de afuera.
  async function rateDescription(targetUid, stars, sharedGroupId = null) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('Usuario no autenticado')
    if (uid === targetUid) throw new Error('No podés calificar tu propia descripción.')
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      throw new Error('La calificación debe ser de 1 a 5 estrellas.')
    }

    const groupId = sharedGroupId ?? (await findSharedGroupId(targetUid))
    if (!groupId) {
      throw new Error('Solo podés calificar a jugadores con los que compartís un grupo.')
    }

    await setDoc(doc(db, 'users', targetUid, 'descriptionRatings', uid), {
      stars,
      sharedGroupId: groupId,
      updatedAt: serverTimestamp(),
    })
  }

  return {
    loading,
    error,
    fetchProfile,
    fetchMyDescriptionStars,
    fetchMyRatingFor,
    findSharedGroupId,
    rateDescription,
  }
}
