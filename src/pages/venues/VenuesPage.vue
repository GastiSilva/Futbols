<template>
  <q-page padding class="bg-grey-1">

    <div class="row items-center q-mb-md">
      <div class="col">
        <div class="text-h5 text-weight-bold">
          <q-icon name="stadium" color="green-8" class="q-mr-sm" />
          Sedes
        </div>
        <div class="text-caption text-grey-6">Canchas donde se juegan los partidos</div>
      </div>
      <q-btn
        unelevated
        color="primary"
        icon="add"
        label="Nueva sede"
        class="pill-btn"
        @click="openCreateDialog"
      />
    </div>

    <!-- Loading -->
    <div v-if="loading && venues.length === 0" class="row justify-center q-mt-xl">
      <q-spinner-dots color="green-9" size="48px" />
    </div>

    <!-- Sin sedes -->
    <div
      v-else-if="venues.length === 0"
      class="column items-center q-mt-xl text-grey-5 q-gutter-sm"
    >
      <q-icon name="stadium" size="72px" />
      <div class="text-h6">Todavía no hay sedes cargadas</div>
      <div class="text-body2">Creá la primera para asociarla a los partidos</div>
    </div>

    <!-- Lista de sedes -->
    <div v-else class="row q-col-gutter-md">
      <div v-for="venue in venues" :key="venue.id" class="col-12 col-sm-6 col-md-4">
        <q-card flat bordered class="full-height column">
          <q-card-section class="col">
            <div class="row items-start no-wrap">
              <div class="col">
                <div class="row items-center q-gutter-xs">
                  <div class="text-subtitle1 text-weight-bold">{{ venue.name }}</div>
                  <q-badge
                    :color="venue.groupId ? 'blue-grey-6' : 'green-9'"
                    :label="venue.groupId ? (groupNames[venue.groupId] ?? 'Grupo') : 'Global'"
                  />
                </div>
                <div v-if="venue.address" class="text-caption text-grey-7 q-mt-xs">
                  <q-icon name="place" size="xs" class="q-mr-xs" />{{ venue.address }}
                </div>
              </div>
              <q-btn
                v-if="canManageVenue(venue)"
                flat
                round
                dense
                icon="more_vert"
                color="grey-6"
              >
                <q-menu auto-close>
                  <q-list dense style="min-width: 140px">
                    <q-item v-if="canEditVenue(venue)" clickable @click="openEditDialog(venue)">
                      <q-item-section avatar><q-icon name="edit" size="xs" /></q-item-section>
                      <q-item-section>Editar</q-item-section>
                    </q-item>
                    <q-item
                      v-if="canDeleteVenue(venue)"
                      clickable
                      class="text-negative"
                      @click="confirmDelete(venue)"
                    >
                      <q-item-section avatar><q-icon name="delete" size="xs" /></q-item-section>
                      <q-item-section>Eliminar</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
            </div>

            <div v-if="venue.notes" class="text-body2 text-grey-8 q-mt-sm">
              {{ venue.notes }}
            </div>
          </q-card-section>

          <q-card-actions v-if="venue.mapsUrl" class="q-px-md q-pb-md">
            <q-btn
              outline
              color="green-9"
              icon="map"
              label="Ver en Google Maps"
              class="full-width pill-btn"
              type="a"
              :href="venue.mapsUrl"
              target="_blank"
              rel="noopener"
            />
          </q-card-actions>
        </q-card>
      </div>
    </div>

    <!-- ── Dialog crear / editar sede ─────────────────────────────────────── -->
    <q-dialog v-model="showDialog" persistent>
      <q-card style="min-width: 320px; max-width: 480px; width: 100%">
        <q-card-section class="text-h6">
          {{ editingVenueId ? 'Editar sede' : 'Nueva sede' }}
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-form @submit.prevent="handleSave" class="q-gutter-y-md">
            <q-select
              v-model="form.groupId"
              :options="groupOptions"
              option-label="name"
              option-value="id"
              emit-value
              map-options
              label="Grupo"
              outlined
              :disable="!!editingVenueId"
              :rules="authStore.isAdmin ? [] : [v => !!v || 'Elegí un grupo']"
              :hint="editingVenueId ? 'No se puede cambiar el grupo de una sede ya creada' : (authStore.isAdmin ? 'Vacío = sede global, para todos los grupos' : 'Va a quedar disponible solo para ese grupo')"
            >
              <template #prepend>
                <q-icon name="group" />
              </template>
            </q-select>

            <q-input
              v-model="form.name"
              label="Nombre *"
              outlined
              autofocus
              maxlength="60"
              :rules="[v => !!v?.trim() || 'Campo requerido']"
            >
              <template #prepend><q-icon name="stadium" /></template>
            </q-input>

            <q-input
              v-model="form.address"
              label="Dirección"
              outlined
              maxlength="120"
              hint="Calle, número y ciudad"
            >
              <template #prepend><q-icon name="place" /></template>
            </q-input>

            <q-input
              v-model="form.mapsUrl"
              label="Link de Google Maps"
              outlined
              type="url"
              hint="Pegá el enlace de 'Compartir' de Google Maps"
              :rules="[validateMapsUrl]"
            >
              <template #prepend><q-icon name="map" /></template>
            </q-input>

            <q-input
              v-model="form.notes"
              label="Observaciones"
              outlined
              type="textarea"
              autogrow
              maxlength="300"
              counter
              hint="Ej: se paga en efectivo, hay vestuarios, estacionamiento"
            >
              <template #prepend><q-icon name="notes" /></template>
            </q-input>
          </q-form>
        </q-card-section>

        <q-card-actions align="right" class="q-pb-md q-px-md">
          <q-btn flat label="Cancelar" v-close-popup :disable="loading" />
          <q-btn
            unelevated
            color="primary"
            class="pill-btn"
            :label="editingVenueId ? 'Guardar' : 'Crear sede'"
            :loading="loading"
            @click="handleSave"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useVenues } from 'src/composables/useVenues'
import { useGroups } from 'src/composables/useGroups'
import { useAuthStore } from 'src/stores/auth.store'

const $q = useQuasar()
const authStore = useAuthStore()
const {
  venues,
  loading,
  fetchVenues,
  createVenue,
  updateVenue,
  deleteVenue,
  canManageVenue,
  canEditVenue,
  canDeleteVenue,
} = useVenues()
const { getMyGroups, getGroup } = useGroups()

const showDialog = ref(false)
const editingVenueId = ref(null)
const form = ref({ name: '', address: '', mapsUrl: '', notes: '', groupId: null })

const myGroups = ref([])
// Nombres de TODOS los grupos que aparecen en alguna sede (no solo los míos),
// para poder mostrar el badge de la tarjeta aunque sea de un grupo ajeno.
const groupNames = ref({})

// Opciones del selector de grupo del formulario: un admin puede dejarla
// "Global" (id null); un usuario común elige entre sus propios grupos.
const groupOptions = computed(() => {
  const mine = myGroups.value.map((g) => ({ id: g.id, name: g.name }))
  return authStore.isAdmin ? [{ id: null, name: 'Global (todos los grupos)' }, ...mine] : mine
})

onMounted(async () => {
  try {
    myGroups.value = await getMyGroups()
  } catch {
    myGroups.value = []
  }
  try {
    await fetchVenues()
  } catch {
    $q.notify({ type: 'negative', message: 'No se pudieron cargar las sedes.' })
  }
})

// Completa los nombres de grupo faltantes cada vez que cambia la lista de sedes
watch(venues, async (list) => {
  const missing = [...new Set(list.map((v) => v.groupId).filter(Boolean))]
    .filter((gid) => !groupNames.value[gid])
  if (missing.length === 0) return
  const entries = await Promise.all(
    missing.map(async (gid) => {
      try {
        const g = await getGroup(gid)
        return [gid, g?.name ?? 'Grupo']
      } catch {
        return [gid, 'Grupo']
      }
    }),
  )
  groupNames.value = { ...groupNames.value, ...Object.fromEntries(entries) }
}, { immediate: true })

function validateMapsUrl(val) {
  if (!val?.trim()) return true
  return /^https?:\/\//.test(val.trim()) || 'Debe ser un link válido (https://...)'
}

function openCreateDialog() {
  if (!authStore.isAdmin && myGroups.value.length === 0) {
    $q.notify({ type: 'warning', message: 'Tenés que pertenecer a un grupo para crear una sede.' })
    return
  }
  editingVenueId.value = null
  form.value = {
    name: '',
    address: '',
    mapsUrl: '',
    notes: '',
    // Admin arranca en "Global"; un usuario con un solo grupo arranca ahí directo.
    groupId: authStore.isAdmin ? null : (myGroups.value.length === 1 ? myGroups.value[0].id : null),
  }
  showDialog.value = true
}

function openEditDialog(venue) {
  editingVenueId.value = venue.id
  form.value = {
    name: venue.name ?? '',
    address: venue.address ?? '',
    mapsUrl: venue.mapsUrl ?? '',
    notes: venue.notes ?? '',
    groupId: venue.groupId ?? null,
  }
  showDialog.value = true
}

async function handleSave() {
  if (!form.value.name?.trim()) {
    $q.notify({ type: 'warning', message: 'El nombre es obligatorio.' })
    return
  }
  if (!authStore.isAdmin && !editingVenueId.value && !form.value.groupId) {
    $q.notify({ type: 'warning', message: 'Elegí a qué grupo pertenece la sede.' })
    return
  }
  if (validateMapsUrl(form.value.mapsUrl) !== true) {
    $q.notify({ type: 'warning', message: 'El link de Google Maps no es válido.' })
    return
  }

  try {
    if (editingVenueId.value) {
      await updateVenue(editingVenueId.value, form.value)
      $q.notify({ type: 'positive', icon: 'check_circle', message: 'Sede actualizada.' })
    } else {
      await createVenue(form.value)
      $q.notify({ type: 'positive', icon: 'check_circle', message: '¡Sede creada!' })
    }
    showDialog.value = false
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  }
}

function confirmDelete(venue) {
  $q.dialog({
    title: 'Eliminar sede',
    message: `¿Seguro que querés eliminar "${venue.name}"? Los partidos existentes conservan su ubicación.`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { unelevated: true, color: 'negative', label: 'Sí, eliminar' },
    persistent: true,
  }).onOk(async () => {
    try {
      await deleteVenue(venue.id)
      $q.notify({ type: 'info', message: 'Sede eliminada.' })
    } catch (err) {
      $q.notify({ type: 'negative', message: err.message })
    }
  })
}
</script>
