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
                v-model="form.date"
                label="Fecha y hora del partido"
                outlined
                type="datetime-local"
                :rules="[val => !!val || 'Campo requerido']"
              />

              <!-- Fecha y hora de apertura de inscripción -->
              <q-input
                v-model="form.openAt"
                label="Apertura de lista (fecha y hora)"
                outlined
                type="datetime-local"
                hint="Cuándo se habilitará el botón 'Anotarme'"
                :rules="[val => !!val || 'Campo requerido', validateOpenAt]"
              />

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

              <!-- Info de cupos (dinámica según formato) -->
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
                color="green-8"
                unelevated
                size="lg"
                class="full-width"
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
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useMatch, FORMAT_OPTIONS } from 'src/composables/useMatch'
import { httpsCallable } from 'firebase/functions'
import { functions } from 'src/services/firebase'

const $q = useQuasar()
const router = useRouter()
const { createMatch, loading } = useMatch()

const form = ref({
  title: '',
  location: '',
  date: '',
  openAt: '',
  format: null,
})

const selectedFormat = computed(() =>
  FORMAT_OPTIONS.find((f) => f.value === form.value.format),
)

function validateOpenAt(val) {
  if (!val || !form.value.date) return true
  return new Date(val) < new Date(form.value.date) || 'La apertura debe ser antes del partido'
}

async function handleSubmit() {
  try {
    const matchId = await createMatch(form.value)

    // Programa la notificación push vía Cloud Function
    const scheduleNotification = httpsCallable(functions, 'scheduleMatchOpenNotification')
    await scheduleNotification({
      matchId,
      openAt: new Date(form.value.openAt).toISOString(),
      matchTitle: form.value.title,
    })

    $q.notify({
      type: 'positive',
      message: '¡Partido creado y notificación programada!',
      icon: 'check_circle',
    })

    router.push({ name: 'admin-dashboard' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  }
}
</script>
