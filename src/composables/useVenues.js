// src/composables/useVenues.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable para gestionar las SEDES (canchas) donde se juegan los partidos.
// Cada sede guarda: nombre, dirección, link de Google Maps y observaciones.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

// Estado reactivo compartido entre instancias del composable
const venues = ref([])

export function useVenues() {
  const authStore = useAuthStore()
  const loading = ref(false)
  const error = ref(null)

  // ── Listar todas las sedes ─────────────────────────────────────────────────
  async function fetchVenues() {
    loading.value = true
    error.value = null
    try {
      const q = query(collection(db, 'venues'), orderBy('nameLower', 'asc'))
      const snaps = await getDocs(q)
      venues.value = snaps.docs.map((d) => ({ id: d.id, ...d.data() }))
      return venues.value
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Obtener una sede ───────────────────────────────────────────────────────
  async function getVenue(venueId) {
    const snap = await getDoc(doc(db, 'venues', venueId))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() }
  }

  // ── Crear sede ─────────────────────────────────────────────────────────────
  async function createVenue({ name, address = '', mapsUrl = '', notes = '' }) {
    loading.value = true
    error.value = null
    try {
      const uid = authStore.user.uid
      const trimmedName = name.trim()

      const venueRef = await addDoc(collection(db, 'venues'), {
        name: trimmedName,
        nameLower: trimmedName.toLowerCase(),
        address: address.trim(),
        mapsUrl: mapsUrl.trim() || null,
        notes: notes.trim(),
        createdBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // Actualizar estado reactivo al instante
      const newSnap = await getDoc(venueRef)
      if (newSnap.exists()) {
        venues.value = [...venues.value, { id: newSnap.id, ...newSnap.data() }].sort((a, b) =>
          (a.nameLower ?? '').localeCompare(b.nameLower ?? ''),
        )
      }

      return venueRef.id
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Editar sede ────────────────────────────────────────────────────────────
  async function updateVenue(venueId, { name, address = '', mapsUrl = '', notes = '' }) {
    loading.value = true
    error.value = null
    try {
      const trimmedName = name.trim()
      const fields = {
        name: trimmedName,
        nameLower: trimmedName.toLowerCase(),
        address: address.trim(),
        mapsUrl: mapsUrl.trim() || null,
        notes: notes.trim(),
        updatedAt: serverTimestamp(),
      }

      await updateDoc(doc(db, 'venues', venueId), fields)

      venues.value = venues.value
        .map((v) => (v.id === venueId ? { ...v, ...fields } : v))
        .sort((a, b) => (a.nameLower ?? '').localeCompare(b.nameLower ?? ''))
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Borrar sede ────────────────────────────────────────────────────────────
  // Los partidos que la referenciaban conservan su `location`/`venueMapsUrl`
  // denormalizados, así que no se rompen.
  async function deleteVenue(venueId) {
    loading.value = true
    error.value = null
    try {
      await deleteDoc(doc(db, 'venues', venueId))
      venues.value = venues.value.filter((v) => v.id !== venueId)
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ¿Puede EDITAR esta sede? Admin global, cualquier OG (OG/owner/admin en al
  // menos un grupo) o quien la creó. Pensado para corregir datos de una cancha.
  function canEditVenue(venue) {
    return (
      authStore.isAdmin ||
      authStore.ogGroupIds.length > 0 ||
      venue?.createdBy === authStore.user?.uid
    )
  }

  // ¿Puede BORRARLA? Acción destructiva → solo el creador o un admin global.
  function canDeleteVenue(venue) {
    return authStore.isAdmin || venue?.createdBy === authStore.user?.uid
  }

  // Compat: el botón de menú se muestra si puede al menos editar.
  function canManageVenue(venue) {
    return canEditVenue(venue)
  }

  return {
    venues,
    loading,
    error,
    fetchVenues,
    getVenue,
    createVenue,
    updateVenue,
    deleteVenue,
    canEditVenue,
    canDeleteVenue,
    canManageVenue,
  }
}
