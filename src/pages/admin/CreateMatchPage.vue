<template>
  <q-page padding>
    <div class="row justify-center">
      <div class="col-12 col-md-7 col-lg-6">
        <div class="text-h5 text-weight-bold q-mb-lg">
          <q-icon name="add_circle" color="green-8" class="q-mr-sm" />
          Crear nuevo partido
        </div>

        <q-card flat bordered>
          <q-card-section>
            <q-form @submit.prevent="handleSubmit" greedy class="q-gutter-y-md">

              <!-- Grupo -->
              <q-select
                v-model="form.groupId"
                :options="groups"
                option-label="name"
                option-value="id"
                emit-value
                map-options
                label="Grupo"
                outlined
                :clearable="!presetGroupId && authStore.isAdmin"
                :disable="!!presetGroupId"
                :rules="authStore.isAdmin ? [] : [val => !!val || 'Elegí un grupo']"
                :hint="presetGroupId ? 'Partido de este grupo' : 'Grupo al que pertenece este partido' + (authStore.isAdmin ? ' (opcional)' : '')"
              >
                <template #prepend>
                  <q-icon name="group" />
                </template>
              </q-select>

              <!-- Título -->
              <q-input
                v-model="form.title"
                label="Título del partido"
                outlined
                :rules="[val => !!val || 'Campo requerido']"
              />

              <!-- Sede (de la lista, o escrita a mano con el tilde) -->
              <q-select
                v-model="form.venueId"
                :options="venues"
                option-label="name"
                option-value="id"
                emit-value
                map-options
                label="Sede"
                outlined
                clearable
                :disable="manualLocation"
                :hint="manualLocation ? 'Desactivado: estás escribiendo el lugar a mano' : 'Elegí una sede guardada (opcional)'"
                @update:model-value="onVenueSelected"
              >
                <template #prepend>
                  <q-icon name="stadium" />
                </template>
              </q-select>

              <q-toggle
                v-model="manualLocation"
                color="green-9"
                label="La sede no está en la lista (escribir a mano)"
                dense
                @update:model-value="onManualLocationToggle"
              />

              <!-- Ubicación -->
              <q-input
                v-model="form.location"
                label="Lugar / Cancha"
                outlined
                :readonly="!manualLocation"
                :hint="manualLocation ? 'Ej: Cancha Sintética La Plata' : 'Se completa solo al elegir una sede'"
              />

              <!-- Fecha y hora del partido -->
              <q-input
                :model-value="formatDateDisplay(form.date)"
                label="Fecha y hora del partido"
                outlined
                readonly
                clearable
                hint="Podés completarlo después"
                @clear="form.date = ''"
              >
                <template #append>
                  <q-icon name="event" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-date v-model="form.date" mask="YYYY-MM-DDTHH:mm" today-btn>
                        <div class="row items-center justify-end">
                          <q-btn v-close-popup label="Cerrar" color="primary" flat />
                        </div>
                      </q-date>
                    </q-popup-proxy>
                  </q-icon>
                  <q-icon name="schedule" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-time v-model="form.date" mask="YYYY-MM-DDTHH:mm" format24h>
                        <div class="row items-center justify-end">
                          <q-btn v-close-popup label="Cerrar" color="primary" flat />
                        </div>
                      </q-time>
                    </q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>

              <!-- Hora de apertura de lista -->
              <q-input
                :model-value="formatDateDisplay(form.openAt)"
                label="Hora de inicio de lista (apertura de inscripción)"
                outlined
                readonly
                clearable
                hint="Cuándo se habilita el botón 'Anotarme' (opcional)"
                :rules="[validateOpenAt]"
                @clear="form.openAt = ''"
              >
                <template #append>
                  <q-icon name="event" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-date v-model="form.openAt" mask="YYYY-MM-DDTHH:mm" today-btn @update:model-value="syncNotifyAt">
                        <div class="row items-center justify-end">
                          <q-btn v-close-popup label="Cerrar" color="primary" flat />
                        </div>
                      </q-date>
                    </q-popup-proxy>
                  </q-icon>
                  <q-icon name="schedule" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-time v-model="form.openAt" mask="YYYY-MM-DDTHH:mm" format24h @update:model-value="syncNotifyAt">
                        <div class="row items-center justify-end">
                          <q-btn v-close-popup label="Cerrar" color="primary" flat />
                        </div>
                      </q-time>
                    </q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>

              <!-- Primera notificación -->
              <q-input
                :model-value="formatDateDisplay(form.notifyAt)"
                label="Primera notificación"
                outlined
                readonly
                clearable
                hint="Notificación recordatoria (por defecto 3 h antes de la apertura)"
                :rules="[validateNotifyAt]"
                @clear="form.notifyAt = ''"
              >
                <template #append>
                  <q-icon name="event" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-date v-model="form.notifyAt" mask="YYYY-MM-DDTHH:mm" today-btn>
                        <div class="row items-center justify-end">
                          <q-btn v-close-popup label="Cerrar" color="primary" flat />
                        </div>
                      </q-date>
                    </q-popup-proxy>
                  </q-icon>
                  <q-icon name="schedule" class="cursor-pointer">
                    <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                      <q-time v-model="form.notifyAt" mask="YYYY-MM-DDTHH:mm" format24h>
                        <div class="row items-center justify-end">
                          <q-btn v-close-popup label="Cerrar" color="primary" flat />
                        </div>
                      </q-time>
                    </q-popup-proxy>
                  </q-icon>
                </template>
              </q-input>

              <!-- Formato del partido -->
              <q-select
                v-model="form.format"
                :options="FORMAT_OPTIONS"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                label="Formato del partido"
                outlined
                :rules="[val => !!val || 'Selecciona un formato']"
              >
                <template #prepend>
                  <q-icon name="group" />
                </template>
              </q-select>

              <!-- Info de cupos -->
              <q-banner
                v-if="form.format"
                class="bg-green-1 text-green-9 rounded-borders"
                dense
              >
                <template #avatar>
                  <q-icon name="info" color="green-8" />
                </template>
                Cupos máximos: <strong>{{ selectedFormat?.maxPlayers }}</strong> jugadores
              </q-banner>

              <q-btn
                type="submit"
                label="Crear Partido"
                color="primary"
                unelevated
                size="lg"
                class="full-width pill-btn"
                :loading="loading"
                icon="sports_soccer"
              />
            </q-form>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useQuasar } from 'quasar'
import { useMatch, FORMAT_OPTIONS } from 'src/composables/useMatch'
import { useGroups } from 'src/composables/useGroups'
import { useVenues } from 'src/composables/useVenues'
import { useAuthStore } from 'src/stores/auth.store'
import { httpsCallable } from 'firebase/functions'
import { functions } from 'src/services/firebase'

const $q = useQuasar()
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { createMatch, loading } = useMatch()
const { getMyGroups } = useGroups()
const { venues, fetchVenues } = useVenues()

const groups = ref([])

// Si se entra desde un grupo (grupos/:id/crear-partido), el partido queda fijado
// a ese grupo (para admins de grupo que no son admin global).
const presetGroupId = route.params.id ?? null

const form = ref({
  groupId: presetGroupId,
  title: '',
  location: '',
  venueId: null,
  date: '',
  openAt: '',
  notifyAt: '',
  format: null,
})

onMounted(async () => {
  try {
    groups.value = await getMyGroups()
  } catch {
    groups.value = []
  }
  try {
    await fetchVenues()
  } catch {
    // sin sedes cargadas se puede seguir usando el campo de texto libre
  }
  if (presetGroupId) form.value.groupId = presetGroupId
})

// Al elegir una sede, autocompleta la ubicación con nombre + dirección
function onVenueSelected(venueId) {
  const venue = venues.value.find((v) => v.id === venueId)
  if (venue) {
    form.value.location = venue.address ? `${venue.name} — ${venue.address}` : venue.name
  } else {
    form.value.location = ''
  }
}

// Tilde "sede manual": desactiva el select y habilita el texto libre
const manualLocation = ref(false)

function onManualLocationToggle(enabled) {
  if (enabled) {
    form.value.venueId = null
    form.value.location = ''
  }
}

const selectedFormat = computed(() =>
  FORMAT_OPTIONS.find((f) => f.value === form.value.format),
)

// Cuando cambia openAt, actualiza notifyAt al valor por defecto (3 h antes)
function syncNotifyAt(newOpenAt) {
  if (!newOpenAt) return
  const openAtMs = new Date(newOpenAt).getTime()
  if (isNaN(openAtMs)) return
  const threeHoursBefore = new Date(openAtMs - 3 * 60 * 60 * 1000)
  form.value.notifyAt = toDatetimeLocal(threeHoursBefore)
}

function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Muestra "DD-MM - HH:mm" en el input en vez del ISO crudo (YYYY-MM-DDTHH:mm)
function formatDateDisplay(iso) {
  if (!iso) return ''
  const [datePart, timePart] = iso.split('T')
  if (!datePart) return ''
  const [, month, day] = datePart.split('-')
  return timePart ? `${day}-${month} - ${timePart}` : `${day}-${month}`
}

function validateOpenAt() {
  const val = form.value.openAt
  if (!val || !form.value.date) return true
  return new Date(val) < new Date(form.value.date) || 'La apertura debe ser antes del partido'
}

function validateNotifyAt() {
  const val = form.value.notifyAt
  if (!val || !form.value.openAt) return true
  return new Date(val) < new Date(form.value.openAt) || 'La notificación debe ser antes de la apertura de lista'
}

async function handleSubmit() {
  try {
    // Denormaliza el link de Maps de la sede en el partido (para mostrarlo
    // sin lecturas extra, y para que sobreviva si la sede se borra)
    const selectedVenue = venues.value.find((v) => v.id === form.value.venueId) ?? null
    const matchId = await createMatch({
      ...form.value,
      venueMapsUrl: selectedVenue?.mapsUrl ?? null,
    })

    // Solo programa notificaciones si se definió openAt
    if (form.value.openAt) {
      try {
        const scheduleOpen = httpsCallable(functions, 'scheduleMatchOpenNotification')
        await scheduleOpen({
          matchId,
          openAt: new Date(form.value.openAt).toISOString(),
          matchTitle: form.value.title,
        })
      } catch (notifErr) {
        console.warn('[Notif] Error al programar apertura:', notifErr.message)
      }

      if (form.value.notifyAt) {
        try {
          const scheduleReminder = httpsCallable(functions, 'scheduleMatchReminderNotification')
          await scheduleReminder({
            matchId,
            notifyAt: new Date(form.value.notifyAt).toISOString(),
            openAt: new Date(form.value.openAt).toISOString(),
            matchTitle: form.value.title,
          })
        } catch (notifErr) {
          console.warn('[Notif] Error al programar recordatorio:', notifErr.message)
        }
      }
    }

    $q.notify({
      type: 'positive',
      message: '¡Partido creado!',
      icon: 'check_circle',
    })

    router.push(
      presetGroupId
        ? { name: 'group-detail', params: { id: presetGroupId } }
        : { name: 'admin-dashboard' },
    )
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  }
}
</script>
