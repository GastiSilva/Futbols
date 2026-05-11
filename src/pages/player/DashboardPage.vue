<template>
  <q-page class="bg-grey-1" padding>

    <!-- ── Saludo ──────────────────────────────────────────────────────────── -->
    <div class="row items-center q-mb-lg no-wrap">
      <q-avatar size="52px" class="q-mr-md shadow-2">
        <img
          :src="user?.photoURL ?? 'icons/icon-128x128.png'"
          :alt="user?.displayName ?? 'usuario'"
          referrerpolicy="no-referrer"
        />
      </q-avatar>
      <div class="col overflow-hidden">
        <div class="text-h6 text-weight-bold ellipsis">¡Hola, {{ firstName }}!</div>
        <div class="text-caption text-grey-6 text-capitalize">{{ today }}</div>
      </div>
    </div>

    <!-- ── Sin partido próximo ─────────────────────────────────────────────── -->
    <div v-if="!nextMatch" class="column items-center q-mt-xl text-grey-5 q-gutter-sm">
      <q-icon name="sports_soccer" size="80px" />
      <div class="text-h6">No hay partidos programados</div>
      <div class="text-body2">Volvé pronto o avisale al admin</div>
    </div>

    <!-- ── Card del próximo partido ───────────────────────────────────────── -->
    <template v-else>

      <div class="text-overline text-green-9 text-weight-bold q-mb-sm dash-overline">
        PRÓXIMO PARTIDO
      </div>

      <q-card flat bordered class="q-mb-lg">

        <!-- Título + status chip -->
        <q-card-section class="q-pb-sm">
          <div class="row justify-between items-start no-wrap q-gutter-x-sm">
            <div class="col overflow-hidden">
              <div class="text-h6 text-weight-bold ellipsis">{{ nextMatch.title }}</div>
              <div class="text-caption text-grey-6 q-mt-xs ellipsis">
                <q-icon name="place" size="xs" class="q-mr-xs" />{{ nextMatch.location }}
              </div>
            </div>
            <q-chip
              dense
              :color="statusColor"
              text-color="white"
              :icon="statusIcon"
              :label="statusLabel"
              class="q-mt-xs"
              style="flex-shrink: 0"
            />
          </div>
        </q-card-section>

        <q-separator inset />

        <!-- Detalles: fecha, hora, formato -->
        <q-card-section class="q-py-md">
          <div class="row q-col-gutter-md text-center">
            <div class="col-4">
              <q-icon name="calendar_today" color="green-9" size="26px" />
              <div class="text-caption text-grey-6 q-mt-xs">Fecha</div>
              <div class="text-body2 text-weight-medium">{{ matchDate }}</div>
            </div>
            <div class="col-4">
              <q-icon name="schedule" color="green-9" size="26px" />
              <div class="text-caption text-grey-6 q-mt-xs">Hora</div>
              <div class="text-body2 text-weight-medium">{{ matchTime }}</div>
            </div>
            <div class="col-4">
              <q-icon name="sports_soccer" color="green-9" size="26px" />
              <div class="text-caption text-grey-6 q-mt-xs">Formato</div>
              <div class="text-body2 text-weight-medium">{{ nextMatch.format }}</div>
            </div>
          </div>
        </q-card-section>

        <!-- Barra de cupos -->
        <q-card-section class="q-pt-none q-pb-md">
          <div class="row justify-between items-center q-mb-xs">
            <span class="text-caption text-grey-6">Cupos</span>
            <span class="text-caption text-weight-bold">
              {{ nextMatch.currentPlayers }} / {{ nextMatch.maxPlayers }}
            </span>
          </div>
          <q-linear-progress
            :value="nextMatch.currentPlayers / nextMatch.maxPlayers"
            :color="progressColor"
            track-color="grey-3"
            rounded
            size="8px"
          />
        </q-card-section>

        <q-separator />

        <!-- ── Zona de acción principal ─────────────────────────────────── -->
        <q-card-section class="q-pa-lg">

          <!-- ① Ya anotado -->
          <template v-if="userRegistration">
            <div class="column items-center q-gutter-sm">
              <q-icon
                :name="userRegistration.isOnWaitlist ? 'hourglass_empty' : 'check_circle'"
                :color="userRegistration.isOnWaitlist ? 'orange-8' : 'positive'"
                size="52px"
              />
              <div class="text-subtitle1 text-weight-bold text-center">
                <span v-if="!userRegistration.isOnWaitlist" class="text-positive">
                  ¡Sos Titular! &nbsp;·&nbsp; Posición #{{ userRegistration.position }}
                </span>
                <span v-else class="text-orange-8">
                  Lista de espera &nbsp;·&nbsp; Puesto #{{ userRegistration.position - nextMatch.maxPlayers }}
                </span>
              </div>
              <div class="text-caption text-grey-6 text-center">
                {{ userRegistration.isOnWaitlist
                  ? 'Entrás si alguien cancela antes del partido'
                  : 'Guardá el día en tu agenda 📅' }}
              </div>
              <q-btn
                flat
                dense
                color="negative"
                label="Cancelar inscripción"
                icon="cancel"
                size="sm"
                class="q-mt-xs"
                :loading="loading"
                @click="handleLeave"
              />
            </div>
          </template>

          <!-- ② Cuenta regresiva (partido scheduled) -->
          <template v-else-if="nextMatch.status === 'scheduled' && msUntilOpen(nextMatch) > 0">
            <div class="column items-center q-gutter-xs">
              <q-icon name="lock_clock" color="blue-grey-5" size="36px" />
              <div class="text-caption text-grey-6 text-uppercase text-weight-bold q-mt-xs">
                La lista abre en
              </div>
              <div
                class="text-h3 text-weight-bold text-green-9"
                style="font-variant-numeric: tabular-nums; letter-spacing: 3px"
              >
                {{ countdown }}
              </div>
              <div class="text-caption text-grey-5">hh : mm : ss</div>
            </div>
          </template>

          <!-- ③ Botón ANOTARME -->
          <q-btn
            v-else-if="canRegister(nextMatch)"
            unelevated
            color="green-9"
            class="full-width"
            size="lg"
            style="font-size: 1.05rem; letter-spacing: 1px"
            :loading="loading"
            @click="handleJoin"
          >
            <q-icon name="sports_soccer" left />
            ANOTARME
          </q-btn>

          <!-- ④ Cerrado / finalizado -->
          <div v-else class="row justify-center items-center q-gutter-xs text-grey-5">
            <q-icon name="lock" size="24px" />
            <span class="text-body2">Inscripción cerrada</span>
          </div>

        </q-card-section>
      </q-card>

      <!-- ── Stats del jugador ────────────────────────────────────────────── -->
      <div class="text-overline text-grey-6 q-mb-sm dash-overline">MIS ESTADÍSTICAS</div>
      <div class="row q-col-gutter-sm q-mb-lg">
        <div class="col-4">
          <q-card flat bordered class="text-center q-pa-sm">
            <div class="text-h5 text-weight-bold text-green-9">{{ user?.stats?.goals ?? 0 }}</div>
            <div class="text-caption text-grey-6">Goles</div>
          </q-card>
        </div>
        <div class="col-4">
          <q-card flat bordered class="text-center q-pa-sm">
            <div class="text-h5 text-weight-bold text-blue-9">{{ user?.stats?.assists ?? 0 }}</div>
            <div class="text-caption text-grey-6">Asistencias</div>
          </q-card>
        </div>
        <div class="col-4">
          <q-card flat bordered class="text-center q-pa-sm">
            <div class="text-h5 text-weight-bold text-orange-9">{{ user?.stats?.matchesPlayed ?? 0 }}</div>
            <div class="text-caption text-grey-6">Partidos</div>
          </q-card>
        </div>
      </div>

      <!-- ── Lista de inscriptos ──────────────────────────────────────────── -->
      <div class="text-overline text-grey-6 q-mb-sm dash-overline">
        ANOTADOS ({{ titulares.length }})
        <span v-if="suplentes.length > 0"> · SUPLENTES ({{ suplentes.length }})</span>
      </div>

      <q-card flat bordered>
        <q-list separator>

          <!-- Titulares -->
          <q-item
            v-for="reg in titulares"
            :key="reg.userId"
            class="q-py-sm"
            :class="{ 'bg-green-1': reg.userId === user?.uid }"
          >
            <q-item-section avatar>
              <q-avatar size="36px">
                <img
                  v-if="reg.photoURL"
                  :src="reg.photoURL"
                  :alt="reg.displayName"
                  referrerpolicy="no-referrer"
                />
                <q-icon v-else name="person" />
              </q-avatar>
            </q-item-section>

            <q-item-section>
              <q-item-label>
                {{ reg.displayName }}
                <q-icon
                  v-if="reg.userId === user?.uid"
                  name="star"
                  color="amber-7"
                  size="14px"
                  class="q-ml-xs"
                />
              </q-item-label>
            </q-item-section>

            <q-item-section side>
              <q-badge color="green-2" text-color="green-9" :label="`#${reg.position}`" />
            </q-item-section>
          </q-item>

          <!-- Separador suplentes -->
          <template v-if="suplentes.length > 0">
            <q-separator />
            <q-item-label
              header
              class="text-orange-8 text-caption text-uppercase bg-orange-1 q-py-xs q-px-md"
            >
              <q-icon name="hourglass_empty" size="xs" class="q-mr-xs" />Lista de espera
            </q-item-label>

            <q-item
              v-for="reg in suplentes"
              :key="reg.userId"
              class="q-py-sm"
              :class="{ 'bg-orange-1': reg.userId === user?.uid }"
            >
              <q-item-section avatar>
                <q-avatar size="36px">
                  <img
                    v-if="reg.photoURL"
                    :src="reg.photoURL"
                    :alt="reg.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <q-icon v-else name="person" />
                </q-avatar>
              </q-item-section>

              <q-item-section>
                <q-item-label>{{ reg.displayName }}</q-item-label>
              </q-item-section>

              <q-item-section side>
                <q-badge
                  color="orange-2"
                  text-color="orange-9"
                  :label="`Esp. #${reg.position - nextMatch.maxPlayers}`"
                />
              </q-item-section>
            </q-item>
          </template>

          <!-- Lista vacía -->
          <q-item v-if="registrations.length === 0" class="q-py-md">
            <q-item-section class="text-center text-grey-5">
              <q-icon name="people_outline" size="28px" class="q-mb-xs" />
              Nadie anotado todavía — ¡sé el primero!
            </q-item-section>
          </q-item>

        </q-list>
      </q-card>

      <q-btn
        flat
        color="green-9"
        label="Ver ranking completo"
        icon-right="arrow_forward"
        class="full-width q-mt-md"
        :to="{ name: 'leaderboard' }"
      />

    </template>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'
import { useRegistration } from 'src/composables/useRegistration'

const $q = useQuasar()
const { user } = useAuth()
const {
  registrations,
  userRegistration,
  loading,
  joinMatch,
  leaveMatch,
  canRegister,
  msUntilOpen,
  subscribeToRegistrations,
  stopListening,
} = useRegistration()

// ── Mock del próximo partido ──────────────────────────────────────────────────
// TODO: reemplazar con subscribeToUpcoming() + nextMatch de useMatch
// cuando el backend esté listo. Solo cambiar el bloque ref() de abajo.
//
// Para probar el countdown: cambiar status a 'scheduled' y openAt a fecha futura:
//   const _openAt = new Date(_now.getTime() + 90 * 60 * 1000) // 90 min desde ahora
const _now = new Date()
const _openAt = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate(), 20, 0, 0)
const _matchAt = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate(), 21, 0, 0)

/** Crea un objeto con la misma interfaz que Firestore Timestamp */
function ts(date) {
  return { toMillis: () => date.getTime(), toDate: () => date }
}

const nextMatch = ref({
  id: 'mock-partido-01',
  title: 'Partido del Jueves',
  location: 'Cancha de Palermo, Sector A',
  date: ts(_matchAt),
  openAt: ts(_openAt),
  format: '7v7',
  maxPlayers: 14,
  currentPlayers: 8,
  status: 'open', // ← 'scheduled' | 'open' | 'closed'
})

// ── Datos derivados ───────────────────────────────────────────────────────────
const firstName = computed(() => user.value?.displayName?.split(' ')[0] ?? 'jugador')

const today = computed(() =>
  new Intl.DateTimeFormat('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date()),
)

const matchDate = computed(() => {
  const d = nextMatch.value?.date?.toDate?.()
  return d
    ? new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
    : '—'
})

const matchTime = computed(() => {
  const d = nextMatch.value?.date?.toDate?.()
  return d
    ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(d)
    : '—'
})

const statusColor = computed(() => ({
  scheduled: 'blue-grey-6',
  open:       'green-9',
  closed:     'red-7',
  finished:   'grey-6',
}[nextMatch.value?.status] ?? 'grey-6'))

const statusLabel = computed(() => ({
  scheduled: 'Programado',
  open:       'Abierto',
  closed:     'Cerrado',
  finished:   'Finalizado',
}[nextMatch.value?.status] ?? nextMatch.value?.status))

const statusIcon = computed(() => ({
  scheduled: 'pending',
  open:       'radio_button_checked',
  closed:     'lock',
  finished:   'done_all',
}[nextMatch.value?.status] ?? 'help'))

const progressColor = computed(() => {
  const ratio = (nextMatch.value?.currentPlayers ?? 0) / (nextMatch.value?.maxPlayers ?? 1)
  return ratio >= 1 ? 'red-7' : ratio >= 0.8 ? 'orange-7' : 'green-9'
})

const titulares = computed(() => registrations.value.filter(r => !r.isOnWaitlist))
const suplentes = computed(() => registrations.value.filter(r => r.isOnWaitlist))

// ── Cuenta regresiva ──────────────────────────────────────────────────────────
const countdown = ref('--:--:--')
let countdownTimer = null

function tickCountdown() {
  const ms = msUntilOpen(nextMatch.value)
  if (ms <= 0) {
    countdown.value = '00:00:00'
    clearInterval(countdownTimer)
    return
  }
  const s = Math.floor(ms / 1000)
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  countdown.value = `${hh}:${mm}:${ss}`
}

// ── Acciones ──────────────────────────────────────────────────────────────────
async function handleJoin() {
  try {
    const result = await joinMatch(nextMatch.value.id)
    $q.notify({
      type: 'positive',
      icon: result.isOnWaitlist ? 'hourglass_empty' : 'check_circle',
      message: result.isOnWaitlist
        ? `Estás en lista de espera — puesto #${result.position - nextMatch.value.maxPlayers}`
        : `¡Te anotaste! Sos el jugador #${result.position}`,
      timeout: 4500,
    })
  } catch (err) {
    $q.notify({ type: 'negative', icon: 'error', message: err.message })
  }
}

function handleLeave() {
  $q.dialog({
    title: 'Cancelar inscripción',
    message: '¿Seguro que querés salir del partido?',
    cancel: { flat: true, label: 'No, quedarme' },
    ok: { unelevated: true, color: 'negative', label: 'Sí, salir' },
    persistent: true,
  }).onOk(async () => {
    try {
      await leaveMatch(nextMatch.value.id)
      $q.notify({ type: 'info', message: 'Inscripción cancelada correctamente' })
    } catch (err) {
      $q.notify({ type: 'negative', message: err.message })
    }
  })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => {
  subscribeToRegistrations(nextMatch.value.id)

  if (nextMatch.value?.status === 'scheduled') {
    tickCountdown()
    countdownTimer = setInterval(tickCountdown, 1000)
  }
})

onUnmounted(() => {
  clearInterval(countdownTimer)
  stopListening()
})
</script>

<style scoped>
.dash-overline {
  letter-spacing: 0.08em;
}
</style>


