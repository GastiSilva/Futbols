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

// Geocodifica una dirección a { lat, lng } usando Nominatim (OpenStreetMap,
// gratis, sin API key). Se llama UNA sola vez por sede (al crear/editar), no
// por partido — costo esporádico y bajo. Si falla o no hay match, devuelve
// null y la sede queda sin coordenadas (el clima del partido simplemente no
// se muestra, no rompe nada más).
async function geocodeAddress(address) {
  const trimmed = address?.trim()
  if (!trimmed) return null
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(trimmed)}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const results = await res.json()
    const first = results?.[0]
    if (!first) return null
    return { lat: parseFloat(first.lat), lng: parseFloat(first.lon) }
  } catch {
    return null // sin conexión o servicio caído: la sede queda sin coordenadas
  }
}

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
  // groupId: null → sede GLOBAL (solo admin puede crearla, lo exigen las
  // reglas). Un usuario común debe pasar el id de un grupo del que es miembro.
  async function createVenue({ name, address = '', mapsUrl = '', notes = '', groupId = null }) {
    loading.value = true
    error.value = null
    try {
      const uid = authStore.user.uid
      const trimmedName = name.trim()
      const trimmedAddress = address.trim()
      const coords = await geocodeAddress(trimmedAddress)

      const venueRef = await addDoc(collection(db, 'venues'), {
        name: trimmedName,
        nameLower: trimmedName.toLowerCase(),
        address: trimmedAddress,
        mapsUrl: mapsUrl.trim() || null,
        notes: notes.trim(),
        groupId: groupId ?? null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
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
      const trimmedAddress = address.trim()
      const fields = {
        name: trimmedName,
        nameLower: trimmedName.toLowerCase(),
        address: trimmedAddress,
        mapsUrl: mapsUrl.trim() || null,
        notes: notes.trim(),
        updatedAt: serverTimestamp(),
      }

      // Solo re-geocodificar si la dirección cambió (evita llamar la API en
      // cada edición trivial de nombre/notas).
      const prevVenue = venues.value.find((v) => v.id === venueId)
      if (prevVenue?.address !== trimmedAddress) {
        const coords = await geocodeAddress(trimmedAddress)
        fields.lat = coords?.lat ?? null
        fields.lng = coords?.lng ?? null
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

  // ¿Puede EDITAR esta sede? Admin global siempre. Una sede de grupo la puede
  // editar cualquier miembro de ESE grupo. Una sede global (groupId null) solo
  // la edita un admin (así lo exigen las reglas también).
  function canEditVenue(venue) {
    if (authStore.isAdmin) return true
    return !!venue?.groupId && authStore.isMemberOfGroup(venue.groupId)
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
