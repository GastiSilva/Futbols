<template>
  <q-page class="bg-grey-1" padding>

    <!-- ── Saludo ──────────────────────────────────────────────────────────── -->
    <div class="row items-center q-mb-lg no-wrap">
      <div class="col overflow-hidden">
        <div class="text-h6 text-weight-bold ellipsis">¡Hola, {{ firstName }}!</div>
        <div class="text-caption text-grey-6 text-capitalize">{{ today }}</div>
      </div>
    </div>

    <!-- ── Sin partidos próximos ──────────────────────────────────────────── -->
    <div v-if="upcomingMatches.length === 0" class="column items-center q-mt-xl text-grey-5 q-gutter-sm">
      <q-icon name="sports_soccer" size="80px" />
      <div class="text-h6">No hay partidos programados</div>
      <div class="text-body2">Volvé pronto o avisale al admin</div>
    </div>

    <!-- ── Lista de próximos partidos ────────────────────────────────────── -->
    <template v-else>

      <div class="text-overline text-green-9 text-weight-bold q-mb-sm dash-overline">
        PRÓXIMOS PARTIDOS ({{ upcomingMatches.length }})
      </div>

      <!-- ── Cards comprimidas de partidos ────────────────────────────────── -->
      <div class="q-gutter-sm q-mb-lg">
        <q-expansion-item
          v-for="match in upcomingMatches"
          :key="match.id"
          flat
          bordered
          :icon="getStatusIcon(match.status)"
          :header-class="getHeaderClass(match.id)"
          @show="selectedMatchId = match.id"
        >
          <template #header>
            <div class="row items-center q-gutter-md full-width">
              <div class="col">
                <div class="text-weight-bold">{{ match.title }}</div>
                <div class="text-caption text-grey-6">
                  <q-icon name="calendar_today" size="xs" class="q-mr-xs" />{{ formatMatchDate(match.date) }}
                  <q-icon name="schedule" size="xs" class="q-ml-sm q-mr-xs" />{{ formatMatchTime(match.date) }}
                </div>
              </div>
              <div class="text-right">
                <div class="text-caption text-weight-bold" :class="getCuposColor(match)">
                  {{ match.currentPlayers }} / {{ match.maxPlayers }}
                </div>
                <q-linear-progress
                  :value="match.currentPlayers / match.maxPlayers"
                  :color="getProgressColor(match)"
                  size="4px"
                  style="width: 80px"
                />
              </div>
              <q-chip
                dense
                :color="getStatusColor(match.status)"
                text-color="white"
                :label="getStatusLabel(match.status)"
                size="sm"
              />
            </div>
          </template>

          <!-- ── Contenido expandido del partido ──────────────────────────── -->
          <q-separator />

          <q-card-section class="q-pa-lg">

            <!-- Detalles: fecha, hora, formato, ubicación -->
            <div class="row q-col-gutter-md q-mb-lg text-center">
              <div class="col-12 col-sm-4">
                <q-icon name="calendar_today" color="green-9" size="26px" />
                <div class="text-caption text-grey-6 q-mt-xs">Fecha</div>
                <div class="text-body2 text-weight-medium">{{ formatMatchDate(match.date) }}</div>
              </div>
              <div class="col-12 col-sm-4">
                <q-icon name="schedule" color="green-9" size="26px" />
                <div class="text-caption text-grey-6 q-mt-xs">Hora</div>
                <div class="text-body2 text-weight-medium">{{ formatMatchTime(match.date) }}</div>
              </div>
              <div class="col-12 col-sm-4">
                <q-icon name="sports_soccer" color="green-9" size="26px" />
                <div class="text-caption text-grey-6 q-mt-xs">Formato</div>
                <div class="text-body2 text-weight-medium">{{ match.format }}</div>
              </div>
            </div>

            <q-separator class="q-my-md" />

            <!-- Ubicación -->
            <div class="row q-mb-lg">
              <q-icon name="place" color="green-9" size="24px" class="q-mr-md" />
              <div class="col">
                <div class="text-caption text-grey-6 text-uppercase">Ubicación</div>
                <div class="text-body2 text-weight-medium">{{ match.location }}</div>
              </div>
            </div>

            <!-- Barra de cupos -->
            <div class="q-mb-lg">
              <div class="row justify-between items-center q-mb-xs">
                <span class="text-caption text-grey-6 text-uppercase">Cupos</span>
                <span class="text-caption text-weight-bold">
                  {{ match.currentPlayers }} / {{ match.maxPlayers }}
                </span>
              </div>
              <q-linear-progress
                :value="match.currentPlayers / match.maxPlayers"
                :color="getProgressColor(match)"
                track-color="grey-3"
                rounded
                size="8px"
              />
            </div>

            <q-separator class="q-my-md" />

            <!-- ── Zona de acción principal ────────────────────────────────── -->

            <!-- ① Ya anotado -->
            <template v-if="getUserRegistrationForMatch(match.id)">
              <div class="column items-center q-gutter-sm">
                <q-icon
                  :name="getUserRegistrationForMatch(match.id).isOnWaitlist ? 'hourglass_empty' : 'check_circle'"
                  :color="getUserRegistrationForMatch(match.id).isOnWaitlist ? 'orange-8' : 'positive'"
                  size="52px"
                />
                <div class="text-subtitle1 text-weight-bold text-center">
                  <span v-if="!getUserRegistrationForMatch(match.id).isOnWaitlist" class="text-positive">
                    ¡Sos Titular! &nbsp;·&nbsp; Posición #{{ getUserRegistrationForMatch(match.id).position }}
                  </span>
                  <span v-else class="text-orange-8">
                    Lista de espera &nbsp;·&nbsp; Puesto #{{ getUserRegistrationForMatch(match.id).position - match.maxPlayers }}
                  </span>
                </div>
                <div class="text-caption text-grey-6 text-center">
                  {{ getUserRegistrationForMatch(match.id).isOnWaitlist
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
                  @click="handleLeave(match.id)"
                />
              </div>
            </template>

            <!-- ② Cuenta regresiva (partido scheduled) -->
            <template v-else-if="match.status === 'scheduled' && msUntilOpen(match) > 0">
              <div class="column items-center q-gutter-xs">
                <q-icon name="lock_clock" color="blue-grey-5" size="36px" />
                <div class="text-caption text-grey-6 text-uppercase text-weight-bold q-mt-xs">
                  La lista abre en
                </div>
                <div
                  class="text-h3 text-weight-bold text-green-9"
                  style="font-variant-numeric: tabular-nums; letter-spacing: 3px"
                >
                  {{ getCountdownForMatch(match.id) }}
                </div>
                <div class="text-caption text-grey-5">hh : mm : ss</div>
              </div>
            </template>

            <!-- ③ Botón ANOTARME -->
            <q-btn
              v-else-if="canRegister(match)"
              unelevated
              color="green-9"
              class="full-width"
              size="lg"
              style="font-size: 1.05rem; letter-spacing: 1px"
              :loading="loading"
              @click="handleJoin(match.id)"
            >
              <q-icon name="sports_soccer" left />
              ANOTARME
            </q-btn>

            <!-- ④ Cerrado / finalizado -->
            <div v-else class="column items-center q-gutter-sm">
              <div class="row justify-center items-center q-gutter-xs text-grey-5 q-mb-sm">
                <q-icon name="lock" size="24px" />
                <span class="text-body2">Inscripción cerrada</span>
              </div>
              <!-- Si el jugador estaba anotado puede cargar resultado -->
              <q-btn
                v-if="getUserRegistrationForMatch(match.id) && !getUserRegistrationForMatch(match.id).isOnWaitlist"
                unelevated
                color="orange-7"
                class="full-width"
                icon="scoreboard"
                label="Cargar resultado"
                :to="{ name: 'post-match', params: { id: match.id } }"
              />
            </div>

          </q-card-section>
        </q-expansion-item>
      </div>

      <!-- ── Seleccionar el match de la expansion actual para los inscritos ──── -->

      <template v-if="selectedMatch">

        <!-- ── Stats del jugador ────────────────────────────────────────────── -->
        <div class="text-overline text-grey-6 q-mb-sm dash-overline">MIS ESTADÍSTICAS</div>

        <!-- En el grupo de este partido (si pertenece a uno) -->
        <template v-if="selectedMatchGroupStats">
          <div class="text-caption text-weight-bold text-green-9 q-mb-xs">EN ESTE GRUPO</div>
          <div class="row q-col-gutter-sm q-mb-md">
            <div class="col-4">
              <q-card flat bordered class="text-center q-pa-sm">
                <div class="text-h5 text-weight-bold text-green-9">{{ selectedMatchGroupStats.goals ?? 0 }}</div>
                <div class="text-caption text-grey-6">Goles</div>
              </q-card>
            </div>
            <div class="col-4">
              <q-card flat bordered class="text-center q-pa-sm">
                <div class="text-h5 text-weight-bold text-blue-9">{{ selectedMatchGroupStats.assists ?? 0 }}</div>
                <div class="text-caption text-grey-6">Asistencias</div>
              </q-card>
            </div>
            <div class="col-4">
              <q-card flat bordered class="text-center q-pa-sm">
                <div class="text-h5 text-weight-bold text-orange-9">{{ selectedMatchGroupStats.matchesPlayed ?? 0 }}</div>
                <div class="text-caption text-grey-6">Partidos</div>
              </q-card>
            </div>
          </div>
          <div class="text-caption text-weight-bold text-grey-7 q-mb-xs">TOTAL INDIVIDUAL (TODOS LOS GRUPOS)</div>
        </template>

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
          ANOTADOS ({{ titularesSeleccionado.length }})
          <span v-if="suplentesSelectorado.length > 0"> · SUPLENTES ({{ suplentesSelectorado.length }})</span>
        </div>

        <q-card flat bordered>
          <q-list separator>

            <!-- Titulares -->
            <q-item
              v-for="reg in titularesSeleccionado"
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
            <template v-if="suplentesSelectorado.length > 0">
              <q-separator />
              <q-item-label
                header
                class="text-orange-8 text-caption text-uppercase bg-orange-1 q-py-xs q-px-md"
              >
                <q-icon name="hourglass_empty" size="xs" class="q-mr-xs" />Lista de espera
              </q-item-label>

              <q-item
                v-for="reg in suplentesSelectorado"
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
                    :label="`Esp. #${reg.position - selectedMatch.maxPlayers}`"
                  />
                </q-item-section>
              </q-item>
            </template>

            <!-- Lista vacía -->
            <q-item v-if="registrationsSeleccionadas.length === 0" class="q-py-md">
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

    </template>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'
import { useRegistration } from 'src/composables/useRegistration'
import { useMatch, getEffectiveStatus } from 'src/composables/useMatch'

const $q = useQuasar()
const { user } = useAuth()
const { joinMatch, leaveMatch, canRegister, msUntilOpen, subscribeToRegistrations, stopListening, loading } = useRegistration()
const { matches, subscribeToUpcoming: subscribeToMatchesUpcoming } = useMatch()

// ── Matches próximos ─────────────────────────────────────────────────────────
const upcomingMatches = computed(() =>
  matches.value?.map((m) => ({
    id: m.id,
    title: m.title,
    location: m.location,
    date: m.date,
    openAt: m.openAt,
    format: m.format,
    maxPlayers: m.maxPlayers,
    currentPlayers: m.currentPlayers ?? 0,
    status: getEffectiveStatus(m),
    groupId: m.groupId ?? null,
  })) ?? [],
)

// ── Stats del grupo del match seleccionado (si pertenece a uno) ─────────────
const selectedMatchGroupStats = computed(() => {
  const groupId = selectedMatch.value?.groupId
  if (!groupId) return null
  return user.value?.statsByGroup?.[groupId] ?? { goals: 0, assists: 0, matchesPlayed: 0 }
})

// ── Match seleccionado (expandido) ───────────────────────────────────────────
const selectedMatchId = ref(null)

const selectedMatch = computed(() =>
  upcomingMatches.value.find((m) => m.id === selectedMatchId.value),
)

// ── Registraciones globales ──────────────────────────────────────────────────
// Un Map<matchId, registraciones[]> para mantener registraciones por match
const registracionesPorMatch = ref(new Map())

// ── Registraciones del match seleccionado ───────────────────────────────────
const registrationsSeleccionadas = computed(() =>
  registracionesPorMatch.value.get(selectedMatchId.value) ?? [],
)

const titularesSeleccionado = computed(() =>
  registrationsSeleccionadas.value.filter((r) => !r.isOnWaitlist),
)

const suplentesSelectorado = computed(() =>
  registrationsSeleccionadas.value.filter((r) => r.isOnWaitlist),
)

// ── Datos derivados globales ────────────────────────────────────────────────
const firstName = computed(() => user.value?.displayName?.split(' ')[0] ?? 'jugador')

const today = computed(() =>
  new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date()),
)

// ── Formateadores ───────────────────────────────────────────────────────────
function formatMatchDate(dateTimestamp) {
  const d = dateTimestamp?.toDate?.()
  return d
    ? new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
    : '—'
}

function formatMatchTime(dateTimestamp) {
  const d = dateTimestamp?.toDate?.()
  return d ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(d) : '—'
}

// ── Status helpers ──────────────────────────────────────────────────────────
function getStatusColor(status) {
  return {
    scheduled: 'blue-grey-6',
    open: 'green-9',
    closed: 'red-7',
    finished: 'grey-6',
  }[status] ?? 'grey-6'
}

function getStatusLabel(status) {
  return {
    scheduled: 'Programado',
    open: 'Abierto',
    closed: 'Cerrado',
    finished: 'Finalizado',
  }[status] ?? status
}

function getStatusIcon(status) {
  return {
    scheduled: 'pending',
    open: 'radio_button_checked',
    closed: 'lock',
    finished: 'done_all',
  }[status] ?? 'help'
}

function getHeaderClass(matchId) {
  return selectedMatchId.value === matchId ? 'bg-green-1' : ''
}

function getProgressColor(match) {
  const ratio = (match.currentPlayers ?? 0) / (match.maxPlayers ?? 1)
  return ratio >= 1 ? 'red-7' : ratio >= 0.8 ? 'orange-7' : 'green-9'
}

function getCuposColor(match) {
  const ratio = (match.currentPlayers ?? 0) / (match.maxPlayers ?? 1)
  return ratio >= 1 ? 'text-red-7' : ratio >= 0.8 ? 'text-orange-7' : 'text-green-9'
}

// ── Countdowns por match ─────────────────────────────────────────────────────
const countdownsPerMatch = ref(new Map())
let countdownTimers = new Map()

function tickCountdown(matchId) {
  const match = upcomingMatches.value.find((m) => m.id === matchId)
  if (!match) return

  const ms = msUntilOpen(match)
  if (ms <= 0) {
    countdownsPerMatch.value.set(matchId, '00:00:00')
    if (countdownTimers.has(matchId)) {
      clearInterval(countdownTimers.get(matchId))
      countdownTimers.delete(matchId)
    }
    return
  }

  const s = Math.floor(ms / 1000)
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  countdownsPerMatch.value.set(matchId, `${hh}:${mm}:${ss}`)
}

function getCountdownForMatch(matchId) {
  return countdownsPerMatch.value.get(matchId) ?? '--:--:--'
}

function startCountdownForMatch(matchId) {
  tickCountdown(matchId)
  if (!countdownTimers.has(matchId)) {
    const timer = setInterval(() => tickCountdown(matchId), 1000)
    countdownTimers.set(matchId, timer)
  }
}

function stopCountdownForMatch(matchId) {
  if (countdownTimers.has(matchId)) {
    clearInterval(countdownTimers.get(matchId))
    countdownTimers.delete(matchId)
  }
}

// ── Obtener registración del usuario para un match específico ────────────────
function getUserRegistrationForMatch(matchId) {
  const regs = registracionesPorMatch.value.get(matchId) ?? []
  return regs.find((r) => r.userId === user.value?.uid)
}

// ── Acciones ────────────────────────────────────────────────────────────────
async function handleJoin(matchId) {
  const match = upcomingMatches.value.find((m) => m.id === matchId)
  if (!match) return

  try {
    const result = await joinMatch(matchId)
    $q.notify({
      type: 'positive',
      icon: result.isOnWaitlist ? 'hourglass_empty' : 'check_circle',
      message: result.isOnWaitlist
        ? `Estás en lista de espera — puesto #${result.position - match.maxPlayers}`
        : `¡Te anotaste! Sos el jugador #${result.position}`,
      timeout: 4500,
    })
  } catch (err) {
    $q.notify({ type: 'negative', icon: 'error', message: err.message })
  }
}

function handleLeave(matchId) {
  const match = upcomingMatches.value.find((m) => m.id === matchId)
  if (!match) return

  $q.dialog({
    title: 'Cancelar inscripción',
    message: `¿Seguro que querés salir de "${match.title}"?`,
    cancel: { flat: true, label: 'No, quedarme' },
    ok: { unelevated: true, color: 'negative', label: 'Sí, salir' },
    persistent: true,
  }).onOk(async () => {
    try {
      await leaveMatch(matchId)
      $q.notify({ type: 'info', message: 'Inscripción cancelada correctamente' })
    } catch (err) {
      $q.notify({ type: 'negative', message: err.message })
    }
  })
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(() => {
  subscribeToMatchesUpcoming()
})

// Watcher: cuando hay matches, inicializa contadores y suscripciones
watch(
  () => upcomingMatches.value.map((m) => m.id),
  (matchIds) => {
    matchIds.forEach((matchId) => {
      // Si el partido es scheduled, inicia el countdown
      const match = upcomingMatches.value.find((m) => m.id === matchId)
      if (match?.status === 'scheduled') {
        startCountdownForMatch(matchId)
      } else {
        stopCountdownForMatch(matchId)
      }

      // Suscríbete a registraciones de este match (si aún no lo has hecho)
      if (!registracionesPorMatch.value.has(matchId)) {
        subscribeToRegistrations(matchId, (regs) => {
          registracionesPorMatch.value.set(matchId, regs)
        })
      }
    })
  },
  { immediate: false },
)

// Watcher: cuando se selecciona un match, cambia las registraciones
watch(
  () => selectedMatchId.value,
  (newMatchId) => {
    if (newMatchId && !registracionesPorMatch.value.has(newMatchId)) {
      subscribeToRegistrations(newMatchId, (regs) => {
        registracionesPorMatch.value.set(newMatchId, regs)
      })
    }
  },
)

onUnmounted(() => {
  countdownTimers.forEach((timer) => clearInterval(timer))
  countdownTimers.clear()
  stopListening()
})
</script>

<style scoped>
.dash-overline {
  letter-spacing: 0.08em;
}
</style>


