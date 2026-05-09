<template>
  <q-page padding>
    <div class="row q-col-gutter-lg">

      <!-- ── Bienvenida ─────────────────────────────────────────────────── -->
      <div class="col-12">
        <div class="text-h5 text-weight-bold">
          Hola, {{ user?.displayName?.split(' ')[0] }} 👋
        </div>
        <div class="text-body2 text-grey-6">
          Bienvenido al organizador de partidos
        </div>
      </div>

      <!-- ── Próximo partido ────────────────────────────────────────────── -->
      <div class="col-12 col-md-7">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold q-mb-md">
              <q-icon name="sports_soccer" color="green-8" class="q-mr-xs" />
              Próximo partido
            </div>

            <div v-if="!nextMatch" class="text-grey-6 text-center q-pa-lg">
              No hay partidos programados
            </div>

            <template v-else>
              <div class="text-h6 text-weight-bold">{{ nextMatch.title }}</div>
              <div class="text-body2 text-grey-7 q-mb-xs">
                <q-icon name="calendar_today" size="16px" class="q-mr-xs" />
                {{ formatDate(nextMatch.date) }}
              </div>
              <div class="text-body2 text-grey-7 q-mb-md" v-if="nextMatch.location">
                <q-icon name="location_on" size="16px" class="q-mr-xs" />
                {{ nextMatch.location }}
              </div>

              <!-- Barra de cupos -->
              <div class="q-mb-xs text-body2 text-grey-8">
                Cupos: {{ nextMatch.currentPlayers }} / {{ nextMatch.maxPlayers }}
              </div>
              <q-linear-progress
                :value="nextMatch.currentPlayers / nextMatch.maxPlayers"
                :color="progressColor"
                rounded
                size="10px"
                class="q-mb-md"
              />

              <!-- Estado y countdown -->
              <div v-if="nextMatch.status === 'scheduled'" class="q-mb-md">
                <q-banner class="bg-blue-grey-1 rounded-borders" dense>
                  <template #avatar>
                    <q-icon name="schedule" color="blue-grey-7" />
                  </template>
                  La lista abre en: <strong>{{ countdown }}</strong>
                </q-banner>
              </div>

              <!-- Botón Anotarme / Estado de inscripción -->
              <template v-if="userRegistration">
                <q-banner class="bg-green-1 rounded-borders" dense>
                  <template #avatar>
                    <q-icon name="check_circle" color="green-8" />
                  </template>
                  <span v-if="!userRegistration.isOnWaitlist">
                    ¡Estás anotado! Posición #{{ userRegistration.position }}
                  </span>
                  <span v-else>
                    Estás en lista de espera (posición {{ userRegistration.position }})
                  </span>
                  <template #action>
                    <q-btn flat color="negative" label="Cancelar" @click="handleLeave" :loading="regLoading" />
                  </template>
                </q-banner>
              </template>

              <template v-else>
                <q-btn
                  label="¡Anotarme!"
                  color="green-8"
                  unelevated
                  size="lg"
                  class="full-width"
                  icon="add_circle"
                  :loading="regLoading"
                  :disable="!canRegisterNow"
                  @click="handleJoin"
                >
                  <q-tooltip v-if="!canRegisterNow">
                    {{ nextMatch.status === 'closed' ? 'Cupos llenos' : 'La lista aún no está abierta' }}
                  </q-tooltip>
                </q-btn>
              </template>
            </template>
          </q-card-section>
        </q-card>
      </div>

      <!-- ── Mis stats ──────────────────────────────────────────────────── -->
      <div class="col-12 col-md-5">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold q-mb-md">
              <q-icon name="bar_chart" color="green-8" class="q-mr-xs" />
              Mis estadísticas
            </div>
            <div class="row q-col-gutter-sm">
              <div class="col-4">
                <q-card flat class="bg-green-1 text-center q-pa-sm rounded-borders">
                  <div class="text-h5 text-weight-bold text-green-9">{{ user?.stats?.goals ?? 0 }}</div>
                  <div class="text-caption text-grey-7">Goles</div>
                </q-card>
              </div>
              <div class="col-4">
                <q-card flat class="bg-blue-1 text-center q-pa-sm rounded-borders">
                  <div class="text-h5 text-weight-bold text-blue-9">{{ user?.stats?.assists ?? 0 }}</div>
                  <div class="text-caption text-grey-7">Asistencias</div>
                </q-card>
              </div>
              <div class="col-4">
                <q-card flat class="bg-orange-1 text-center q-pa-sm rounded-borders">
                  <div class="text-h5 text-weight-bold text-orange-9">{{ user?.stats?.matchesPlayed ?? 0 }}</div>
                  <div class="text-caption text-grey-7">Partidos</div>
                </q-card>
              </div>
            </div>
          </q-card-section>
        </q-card>

        <!-- Ir al ranking -->
        <q-btn
          flat
          color="green-8"
          label="Ver ranking completo"
          icon-right="arrow_forward"
          class="full-width q-mt-md"
          :to="{ name: 'leaderboard' }"
        />
      </div>

      <!-- ── Lista de inscriptos ──────────────────────────────────────────── -->
      <div class="col-12" v-if="nextMatch">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle1 text-weight-bold q-mb-md">
              Inscriptos ({{ confirmedPlayers.length }}/{{ nextMatch.maxPlayers }})
            </div>

            <div class="row q-col-gutter-sm">
              <div
                v-for="reg in confirmedPlayers"
                :key="reg.userId"
                class="col-6 col-sm-4 col-md-3"
              >
                <div class="row items-center no-wrap q-pa-xs">
                  <q-chip
                    square
                    dense
                    color="green-1"
                    text-color="green-9"
                    class="q-mr-xs"
                    style="min-width:28px"
                  >
                    {{ reg.position }}
                  </q-chip>
                  <q-avatar size="28px" class="q-mr-xs">
                    <img :src="reg.photoURL" />
                  </q-avatar>
                  <span class="text-caption ellipsis">{{ reg.displayName }}</span>
                </div>
              </div>
            </div>

            <div v-if="waitlistPlayers.length" class="q-mt-md">
              <div class="text-caption text-grey-6 q-mb-xs">Lista de espera</div>
              <div class="row q-col-gutter-xs">
                <q-chip
                  v-for="reg in waitlistPlayers"
                  :key="reg.userId"
                  dense
                  outline
                  color="grey-6"
                  :label="`${reg.position}. ${reg.displayName}`"
                />
              </div>
            </div>
          </q-card-section>
        </q-card>
      </div>

    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useQuasar, date } from 'quasar'
import { useAuth } from 'src/composables/useAuth'
import { useMatch } from 'src/composables/useMatch'
import { useRegistration } from 'src/composables/useRegistration'

const $q = useQuasar()
const { user } = useAuth()
const { nextMatch, matches, subscribeToUpcoming, stopListening: stopMatch } = useMatch()
const {
  registrations,
  userRegistration,
  loading: regLoading,
  joinMatch,
  leaveMatch,
  canRegister,
  msUntilOpen,
  subscribeToRegistrations,
  stopListening: stopReg,
} = useRegistration()

// ── Countdown ──────────────────────────────────────────────────────────────
const countdown = ref('--:--:--')
let countdownTimer = null

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    const ms = msUntilOpen(nextMatch.value)
    if (ms <= 0) {
      countdown.value = '¡Abierto!'
      clearInterval(countdownTimer)
      return
    }
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    countdown.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }, 1000)
}

// ── Computed ───────────────────────────────────────────────────────────────
const canRegisterNow = computed(() => canRegister(nextMatch.value))
const confirmedPlayers = computed(() => registrations.value.filter((r) => !r.isOnWaitlist))
const waitlistPlayers = computed(() => registrations.value.filter((r) => r.isOnWaitlist))
const progressColor = computed(() => {
  if (!nextMatch.value) return 'green'
  const ratio = nextMatch.value.currentPlayers / nextMatch.value.maxPlayers
  return ratio >= 1 ? 'red-7' : ratio >= 0.8 ? 'orange-7' : 'green-7'
})

// ── Lifecycle ──────────────────────────────────────────────────────────────
let unsubReg = null
onMounted(async () => {
  subscribeToUpcoming()
  // Cuando nextMatch esté disponible, suscribirse a inscripciones
  const unwatchMatch = computed(() => nextMatch.value)
  // Watch simplificado: esperamos un tick y suscribimos
  setTimeout(() => {
    if (nextMatch.value?.id) {
      unsubReg = subscribeToRegistrations(nextMatch.value.id)
      startCountdown()
    }
  }, 500)
})

onUnmounted(() => {
  stopMatch()
  stopReg()
  if (countdownTimer) clearInterval(countdownTimer)
})

// ── Acciones ───────────────────────────────────────────────────────────────
async function handleJoin() {
  try {
    const result = await joinMatch(nextMatch.value.id)
    $q.notify({
      type: 'positive',
      message: result.isOnWaitlist
        ? `Anotado en lista de espera (posición ${result.position})`
        : `¡Anotado! Sos el jugador #${result.position}`,
      icon: 'check_circle',
    })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  }
}

async function handleLeave() {
  try {
    await leaveMatch(nextMatch.value.id)
    $q.notify({ type: 'info', message: 'Inscripción cancelada.' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  }
}

function formatDate(ts) {
  return ts ? date.formatDate(ts.toDate(), 'dddd DD/MM/YYYY [a las] HH:mm') : ''
}
</script>
