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
import { normalizeProvincia } from 'src/utils/provincias'

// Estado reactivo compartido entre instancias del composable
const venues = ref([])

// Geocodifica una dirección a { lat, lng, provincia, ciudad } usando Nominatim
// (OpenStreetMap, gratis, sin API key). Se llama UNA sola vez por sede (al
// crear/editar), no por partido — costo esporádico y bajo. Si falla o no hay
// match, devuelve null y la sede queda sin datos de ubicación (el clima del
// partido simplemente no se muestra y no entra en el filtro por provincia,
// pero sigue apareciendo en el listado general).
//
// `addressdetails=1` pide el desglose administrativo (provincia/ciudad) en la
// MISMA respuesta que ya se usaba para lat/lng: no cuesta una llamada extra,
// solo se estaba descartando.
async function geocodeAddress(address) {
  const trimmed = address?.trim()
  if (!trimmed) return null
  try {
    const url =
      'https://nominatim.openstreetmap.org/search' +
      `?format=json&limit=1&addressdetails=1&countrycodes=ar&q=${encodeURIComponent(trimmed)}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      // Nominatim limita por uso (429) y rechaza clientes sin identificar.
      // Antes esto se tragaba en silencio y la sede quedaba sin coordenadas
      // para siempre — con el efecto visible de que el clima del partido no
      // aparecía nunca, sin ninguna pista de por qué.
      console.warn(`Geocodificación fallida (${res.status}) para "${trimmed}"`)
      return null
    }
    const results = await res.json()
    const first = results?.[0]
    if (!first) {
      console.warn(`Sin resultados de geocodificación para "${trimmed}"`)
      return null
    }

    const lat = parseFloat(first.lat)
    const lng = parseFloat(first.lon)
    const addr = first.address ?? {}

    // Nominatim no es consistente en qué campo trae la localidad: según la
    // zona puede venir como city, town, village o municipality. Se toma el
    // primero que exista.
    const ciudad =
      addr.city || addr.town || addr.village || addr.municipality || addr.suburb || null

    let provincia = normalizeProvincia(addr.state)

    // Respaldo con Georef (datos oficiales del Estado argentino) cuando
    // Nominatim no devuelve la provincia — pasa seguido con direcciones mal
    // escritas o zonas rurales. Solo se llama en ese caso, no siempre.
    if (!provincia && Number.isFinite(lat) && Number.isFinite(lng)) {
      provincia = await fetchProvinciaFromGeoref(lat, lng)
    }

    return { lat, lng, provincia, ciudad }
  } catch (err) {
    console.warn(`Geocodificación no disponible para "${trimmed}":`, err.message)
    return null // sin conexión o servicio caído: la sede queda sin coordenadas
  }
}

// Georef (API pública del Estado argentino) resuelve coordenadas → provincia
// oficial. Es el respaldo de Nominatim, no la fuente principal: se consulta
// solo cuando Nominatim no trajo la provincia, para no sumar una llamada de
// red a cada alta de sede.
async function fetchProvinciaFromGeoref(lat, lng) {
  try {
    const url = `https://apis.datos.gob.ar/georef/api/ubicacion?lat=${lat}&lon=${lng}&campos=provincia`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    return normalizeProvincia(data?.ubicacion?.provincia?.nombre)
  } catch {
    // Georef caído o sin conexión: la sede queda sin provincia y simplemente
    // no entra en el filtro (sigue visible en el listado general).
    return null
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
        // Derivados del mismo geocoding (no cuestan una llamada extra) —
        // habilitan el filtro por provincia en "Partidos abiertos".
        provincia: coords?.provincia ?? null,
        ciudad: coords?.ciudad ?? null,
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

      // Re-geocodificar si la dirección cambió, O si la sede todavía no tiene
      // coordenadas. Este segundo caso importa: las sedes creadas antes de que
      // existiera la geocodificación (y las que fallaron por un 429 puntual)
      // quedaban con lat/lng null PARA SIEMPRE, porque editar el nombre no
      // dispara el reintento y la dirección nunca "cambia". Sin coordenadas no
      // hay clima en el partido, que era el síntoma visible.
      const prevVenue = venues.value.find((v) => v.id === venueId)
      const addressChanged = prevVenue?.address !== trimmedAddress
      const missingCoords = prevVenue?.lat == null || prevVenue?.lng == null
      // Las sedes creadas antes de que existiera el filtro por provincia no
      // tienen ese campo: se re-geocodifican al editarlas para completarlo.
      const missingProvincia = prevVenue?.provincia == null
      if (addressChanged || missingCoords || missingProvincia) {
        const coords = await geocodeAddress(trimmedAddress)
        fields.lat = coords?.lat ?? null
        fields.lng = coords?.lng ?? null
        fields.provincia = coords?.provincia ?? null
        fields.ciudad = coords?.ciudad ?? null
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
