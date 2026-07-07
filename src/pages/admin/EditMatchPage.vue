<template>
  <q-page padding>
    <div class="row justify-center">
      <div class="col-12 col-md-7 col-lg-6">
        <div class="row items-center q-mb-lg">
          <q-btn flat round icon="arrow_back" color="green-8" @click="router.back()" class="q-mr-sm" />
          <div class="text-h5 text-weight-bold">
            <q-icon name="edit" color="green-8" class="q-mr-sm" />
            Editar partido
          </div>
        </div>

        <q-skeleton v-if="loadingMatch" type="rect" height="400px" />

        <q-card v-else flat bordered>
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
                clearable
                hint="Grupo al que pertenece este partido (opcional)"
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

              <!-- Ubicación -->
              <q-input
                v-model="form.location"
                label="Lugar / Cancha"
                outlined
                hint="Ej: Cancha Sintética La Plata"
              />

              <!-- Fecha y hora del partido -->
              <q-input
                :model-value="formatDateDisplay(form.date)"
                label="Fecha y hora del partido"
                outlined
                readonly
                clearable
                hint="Podés dejarlo vacío si todavía no está confirmado"
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
                hint="Cuándo se habilita el botón 'Anotarme'"
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
                hint="Notificación recordatoria (por defecto 3 h antes)"
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

              <!-- Estado del partido -->
              <q-select
                v-model="form.status"
                :options="STATUS_OPTIONS"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                label="Estado del partido"
                outlined
              >
                <template #prepend>
                  <q-icon name="flag" />
                </template>
              </q-select>

              <div class="row q-gutter-sm">
                <q-btn
                  type="submit"
                  label="Guardar cambios"
                  color="primary"
                  unelevated
                  size="lg"
                  class="col pill-btn"
                  :loading="saving"
                  icon="save"
                />
                <q-btn
                  flat
                  label="Cancelar"
                  color="grey-7"
                  size="lg"
                  @click="router.back()"
                />
              </div>
            </q-form>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useMatch, FORMAT_OPTIONS } from 'src/composables/useMatch'
import { useGroups } from 'src/composables/useGroups'
import { httpsCallable } from 'firebase/functions'
import { functions } from 'src/services/firebase'

const $q = useQuasar()
const route = useRoute()
const router = useRouter()
const matchId = route.params.id
const { fetchMatch, updateMatch } = useMatch()
const { getMyGroups } = useGroups()

const STATUS_OPTIONS = [
  { label: '🕐 Programado', value: 'scheduled' },
  { label: '✅ Abierto', value: 'open' },
  { label: '🔒 Cerrado', value: 'closed' },
  { label: '🏁 Finalizado', value: 'finished' },
]

const groups = ref([])
const loadingMatch = ref(true)
const saving = ref(false)

const form = ref({
  groupId: null,
  title: '',
  location: '',
  date: '',
  openAt: '',
  notifyAt: '',
  format: null,
  status: 'scheduled',
})

function toDatetimeLocal(ts) {
  if (!ts) return ''
  const d = ts?.toDate ? ts.toDate() : new Date(ts)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Muestra "DD-MM - HH:mm" en el input en vez del ISO crudo (YYYY-MM-DDTHH:mm)
function formatDateDisplay(iso) {
  if (!iso) return ''
  const [datePart, timePart] = iso.split('T')
  if (!datePart) return ''
  const [, month, day] = datePart.split('-')
  return timePart ? `${day}-${month} - ${timePart}` : `${day}-${month}`
}

onMounted(async () => {
  try {
    ;[groups.value] = await Promise.all([getMyGroups()])
    const match = await fetchMatch(matchId)
    form.value = {
      groupId: match.groupId ?? null,
      title: match.title ?? '',
      location: match.location ?? '',
      date: toDatetimeLocal(match.date),
      openAt: toDatetimeLocal(match.openAt),
      notifyAt: toDatetimeLocal(match.notifyAt),
      format: match.format ?? null,
      status: match.status ?? 'scheduled',
    }
  } catch (err) {
    $q.notify({ type: 'negative', message: 'No se pudo cargar el partido' })
    router.back()
  } finally {
    loadingMatch.value = false
  }
})

const selectedFormat = computed(() =>
  FORMAT_OPTIONS.find((f) => f.value === form.value.format),
)

function syncNotifyAt(newOpenAt) {
  if (!newOpenAt) return
  const openAtMs = new Date(newOpenAt).getTime()
  if (isNaN(openAtMs)) return
  const threeHoursBefore = new Date(openAtMs - 3 * 60 * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  const d = threeHoursBefore
  form.value.notifyAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function validateOpenAt() {
  const val = form.value.openAt
  if (!val || !form.value.date) return true
  return new Date(val) < new Date(form.value.date) || 'La apertura debe ser antes del partido'
}

function validateNotifyAt() {
  const val = form.value.notifyAt
  if (!val || !form.value.openAt) return true
  return new Date(val) < new Date(form.value.openAt) || 'La notificación debe ser antes de la apertura'
}

async function handleSubmit() {
  saving.value = true
  try {
    // Actualiza el partido en Firestore
    await updateMatch(matchId, form.value)

    // Si se modificó openAt, reprogramar notificaciones
    if (form.value.openAt) {
      try {
        const scheduleOpen = httpsCallable(functions, 'scheduleMatchOpenNotification')
        await scheduleOpen({
          matchId,
          openAt: new Date(form.value.openAt).toISOString(),
          matchTitle: form.value.title,
        })
      } catch (notifErr) {
        console.warn('[Notif] No se pudo reprogramar notificación:', notifErr.message)
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
          console.warn('[Notif] No se pudo reprogramar recordatorio:', notifErr.message)
        }
      }
    }

    $q.notify({ type: 'positive', message: '¡Partido actualizado!', icon: 'check_circle' })
    router.push({ name: 'admin-dashboard' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    saving.value = false
  }
}
</script>
