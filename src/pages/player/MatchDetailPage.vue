<template>
  <q-page padding>
    <!-- Loading -->
    <div v-if="loading" class="row justify-center q-mt-xl">
      <q-spinner-dots color="green-9" size="48px" />
    </div>

    <!-- No encontrado -->
    <div v-else-if="!match" class="text-center q-mt-xl text-grey-6">
      <q-icon name="sports_soccer" size="72px" class="q-mb-md" />
      <div class="text-h6">Partido no encontrado</div>
      <q-btn flat color="green-9" label="Volver" icon="arrow_back" class="q-mt-md" @click="$router.back()" />
    </div>

    <!-- Detalle del partido -->
    <template v-else>
      <div class="row items-center q-mb-md no-wrap">
        <q-btn flat round icon="arrow_back" @click="$router.back()" />
        <div class="col q-ml-sm">
          <div class="text-h5 text-weight-bold ellipsis">{{ match.title }}</div>
          <div class="text-caption text-grey-6">
            <q-icon name="place" size="xs" class="q-mr-xs" />{{ match.location }}
            <a
              v-if="match.venueMapsUrl"
              :href="match.venueMapsUrl"
              target="_blank"
              rel="noopener"
              class="text-green-8 q-ml-sm"
            >
              <q-icon name="map" size="xs" class="q-mr-xs" />Ver en Maps
            </a>
          </div>
        </div>
        <q-chip
          dense
          :color="statusColor"
          text-color="white"
          :label="statusLabel"
        />
      </div>

      <!-- Info -->
      <q-card flat bordered class="q-mb-md">
        <q-card-section>
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
              <div class="text-body2 text-weight-medium">{{ match.format }}</div>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Agregar a Google Calendar -->
      <q-btn
        v-if="calendarUrl"
        :href="calendarUrl"
        target="_blank"
        rel="noopener"
        outline
        no-caps
        color="green-9"
        icon="event"
        label="Agregar a Google Calendar"
        class="full-width q-mb-md"
      />

      <!-- Cupos -->
      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <div class="row justify-between items-center q-mb-xs">
            <span class="text-caption text-grey-6">Cupos</span>
            <span class="text-caption text-weight-bold">
              {{ visibleCupos.current }} / {{ visibleCupos.max }}
            </span>
          </div>
          <q-linear-progress
            :value="visibleCupos.ratio"
            color="green-9"
            track-color="grey-3"
            rounded
            size="8px"
          />
        </q-card-section>
      </q-card>

      <!-- Inscripción (anotarse / cancelar directo desde el detalle) -->
      <q-card v-if="eStatus !== 'finished'" flat bordered class="q-mb-md">
        <q-card-section>
          <!-- ① Ya estás anotado -->
          <template v-if="userRegistration">
            <div class="column items-center q-gutter-xs">
              <q-icon
                :name="userRegistration.isOnWaitlist ? 'hourglass_top' : 'check_circle'"
                :color="userRegistration.isOnWaitlist ? 'orange-8' : 'positive'"
                size="34px"
              />
              <div class="text-subtitle1 text-weight-bold text-center">
                <span v-if="!userRegistration.isOnWaitlist" class="text-positive">
                  ¡Sos titular! · Posición #{{ userRegistration.position }}
                </span>
                <span v-else class="text-orange-8">
                  Lista de espera · Puesto #{{ userRegistration.position - match.maxPlayers }}
                </span>
              </div>
              <q-btn
                flat
                dense
                color="negative"
                label="Cancelar inscripción"
                icon="cancel"
                size="sm"
                :loading="regLoading"
                @click="handleLeave"
              />
            </div>
          </template>

          <!-- ② Podés anotarte (como suplente si está lleno) -->
          <template v-else-if="canRegister(match)">
            <q-banner
              v-if="eStatus === 'full'"
              dense
              class="bg-orange-1 text-orange-9 rounded-borders q-mb-sm"
            >
              <template #avatar><q-icon name="hourglass_top" color="orange-8" /></template>
              Cupo completo — te anotás como suplente y entrás automáticamente si alguien se baja.
            </q-banner>
            <q-banner
              v-else-if="isInEarlyWindow(match)"
              dense
              class="bg-blue-1 text-blue-9 rounded-borders q-mb-sm"
            >
              <template #avatar><q-icon name="bolt" color="blue-8" /></template>
              Acceso anticipado — te estás anotando antes de que abra la lista.
            </q-banner>
            <q-btn
              unelevated
              :color="eStatus === 'full' ? 'orange-8' : 'primary'"
              class="full-width pill-btn"
              size="lg"
              :loading="regLoading"
              @click="handleJoin"
            >
              <q-icon :name="eStatus === 'full' ? 'hourglass_top' : 'sports_soccer'" left />
              {{ eStatus === 'full' ? 'ANOTARME COMO SUPLENTE' : 'ANOTARME' }}
            </q-btn>
          </template>

          <!-- ③ Todavía no abre la lista -->
          <template v-else-if="notYetOpen">
            <div class="column items-center q-gutter-xs text-grey-6">
              <q-icon name="lock_clock" color="blue-grey-5" size="32px" />
              <div class="text-body2 text-center">
                La lista abre el <b>{{ openAtLabel }}</b>
              </div>
            </div>
          </template>

          <!-- ④ Cerrada -->
          <div v-else class="row justify-center items-center q-gutter-xs text-grey-5">
            <q-icon name="lock" size="22px" />
            <span class="text-body2">Inscripción cerrada</span>
          </div>
        </q-card-section>
      </q-card>

      <!-- Lista de anotados (visible desde el horario de acceso de cada uno) -->
      <q-card v-if="!canSeeRegistrations(match) && registrations.length > 0" flat bordered class="q-mb-md">
        <q-card-section class="row items-center q-gutter-sm text-grey-6">
          <q-icon name="visibility_off" size="22px" />
          <span class="text-body2">La lista de anotados se va a ver a las {{ myRegistrationsVisibleAtLabel }}.</span>
        </q-card-section>
      </q-card>

      <q-card v-else-if="registrations.length > 0" flat bordered class="q-mb-md">
        <q-card-section class="q-pb-none">
          <div class="text-overline text-green-9 text-weight-bold">
            Anotados ({{ starters.length }}/{{ match.maxPlayers }})
          </div>
        </q-card-section>
        <q-list dense>
          <q-item v-for="reg in starters" :key="reg.id">
            <q-item-section avatar>
              <q-avatar size="28px" color="green-2" text-color="green-9">
                {{ reg.position }}
              </q-avatar>
            </q-item-section>
            <q-item-section>{{ reg.displayName }}</q-item-section>
            <q-item-section v-if="reg.isGuest" side>
              <q-badge color="grey-5" label="Invitado" />
            </q-item-section>
          </q-item>
        </q-list>
        <template v-if="waitlist.length > 0">
          <q-separator />
          <q-card-section class="q-pb-none">
            <div class="text-overline text-orange-8 text-weight-bold">
              Suplentes ({{ waitlist.length }})
            </div>
          </q-card-section>
          <q-list dense>
            <q-item v-for="reg in waitlist" :key="reg.id">
              <q-item-section avatar>
                <q-avatar size="28px" color="orange-2" text-color="orange-9">
                  {{ reg.position - match.maxPlayers }}
                </q-avatar>
              </q-item-section>
              <q-item-section>{{ reg.displayName }}</q-item-section>
              <q-item-section v-if="reg.isGuest" side>
                <q-badge color="grey-5" label="Invitado" />
              </q-item-section>
            </q-item>
          </q-list>
        </template>
      </q-card>

      <!-- Resultado (si finalizado) -->
      <q-card v-if="match.status === 'finished' && match.scoreA != null" flat bordered class="q-mb-md bg-green-1">
        <q-card-section class="text-center">
          <div class="text-overline text-grey-6">Resultado final</div>
          <div class="text-h3 text-weight-bold text-green-9">
            {{ match.scoreA }} — {{ match.scoreB }}
          </div>
          <div v-if="match.mvpName" class="q-mt-sm">
            <q-chip color="amber-8" text-color="white" icon="military_tech">
              MVP: {{ match.mvpName }}
            </q-chip>
          </div>

          <!-- Goleadores por equipo -->
          <template v-if="scorers.length > 0">
            <q-separator class="q-my-md" />
            <div class="text-overline text-grey-6 q-mb-xs">Goleadores</div>
            <div class="row q-col-gutter-md text-left">
              <div class="col-6">
                <div class="text-caption text-weight-bold text-grey-7 q-mb-xs">Equipo A</div>
                <div v-if="scorersA.length === 0" class="text-caption text-grey-5">—</div>
                <div v-for="s in scorersA" :key="s.userId" class="text-body2">
                  ⚽ {{ s.displayName }}<span v-if="s.goals > 1" class="text-weight-bold"> ×{{ s.goals }}</span>
                </div>
              </div>
              <div class="col-6">
                <div class="text-caption text-weight-bold text-grey-7 q-mb-xs">Equipo B</div>
                <div v-if="scorersB.length === 0" class="text-caption text-grey-5">—</div>
                <div v-for="s in scorersB" :key="s.userId" class="text-body2">
                  ⚽ {{ s.displayName }}<span v-if="s.goals > 1" class="text-weight-bold"> ×{{ s.goals }}</span>
                </div>
              </div>
            </div>
            <div v-if="scorersNoTeam.length > 0" class="text-left q-mt-sm">
              <div class="text-caption text-weight-bold text-grey-7 q-mb-xs">Sin equipo asignado</div>
              <div v-for="s in scorersNoTeam" :key="s.userId" class="text-body2">
                ⚽ {{ s.displayName }}<span v-if="s.goals > 1" class="text-weight-bold"> ×{{ s.goals }}</span>
              </div>
            </div>
          </template>
        </q-card-section>
      </q-card>

      <!-- Cargar / editar resultado (miembros del grupo o admin) -->
      <q-btn
        v-if="canLoadResult"
        unelevated
        color="orange-7"
        class="full-width pill-btn q-mt-sm"
        icon="scoreboard"
        :label="match.status === 'finished' ? 'Editar resultado' : 'Cargar resultado'"
        :to="{ name: 'post-match', params: { id: match.id } }"
      />
    </template>
  </q-page>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { date, useQuasar } from 'quasar'
import { useMatch, getEffectiveStatus } from 'src/composables/useMatch'
import { useGroups } from 'src/composables/useGroups'
import { usePlayerStats } from 'src/composables/usePlayerStats'
import { useRegistration } from 'src/composables/useRegistration'
import { useAuthStore } from 'src/stores/auth.store'
import { buildGoogleCalendarUrl } from 'src/utils/calendar'

const $q = useQuasar()
const route = useRoute()
const { currentMatch: match, loading, subscribeToMatch, stopListening } = useMatch()
const { getMyRole } = useGroups()
const { fetchPlayerStats } = usePlayerStats()
const authStore = useAuthStore()
const {
  registrations,
  userRegistration,
  loading: regLoading,
  joinMatch,
  leaveMatch,
  canRegister,
  isInEarlyWindow,
  msUntilOpen,
  canSeeRegistrations,
  subscribeToRegistrations,
  stopListening: stopRegistrations,
} = useRegistration()

onMounted(() => {
  subscribeToMatch(route.params.id)
  subscribeToRegistrations(route.params.id)
})
onUnmounted(() => {
  stopListening()
  stopRegistrations()
})

// ── Inscripción ─────────────────────────────────────────────────────────────
const eStatus = computed(() => getEffectiveStatus(match.value))
const notYetOpen = computed(() => !!match.value && msUntilOpen(match.value) > 0)
const openAtLabel = computed(() =>
  match.value?.openAt ? date.formatDate(match.value.openAt.toDate(), 'DD/MM HH:mm') : '',
)
// Hora en la que ESTE usuario puntual va a poder ver la lista de anotados
// (creador: siempre; OG: 30 min antes; miembro común: la hora oficial).
const myRegistrationsVisibleAtLabel = computed(() => {
  if (!match.value) return ''
  const ms = msUntilOpen(match.value)
  if (ms <= 0) return ''
  return date.formatDate(new Date(Date.now() + ms), 'DD/MM HH:mm')
})
// Cupos "engaño visual": antes del horario de acceso de cada uno se muestran
// en 0/0, igual que la lista de anotados — no debe notarse que ya hay gente.
const visibleCupos = computed(() => {
  if (!match.value || !canSeeRegistrations(match.value)) return { current: 0, max: 0, ratio: 0 }
  const current = match.value.currentPlayers ?? 0
  const max = match.value.maxPlayers ?? 0
  return { current, max, ratio: max ? current / max : 0 }
})
const starters = computed(() => registrations.value.filter((r) => !r.isOnWaitlist))
const waitlist = computed(() => registrations.value.filter((r) => r.isOnWaitlist))

async function handleJoin() {
  try {
    const result = await joinMatch(route.params.id)
    $q.notify({
      type: 'positive',
      icon: result.isOnWaitlist ? 'hourglass_empty' : 'check_circle',
      message: result.isOnWaitlist
        ? `Estás en lista de espera — puesto #${result.position - match.value.maxPlayers}`
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
    message: `¿Seguro que querés salir de "${match.value?.title}"?`,
    cancel: { flat: true, label: 'No, quedarme' },
    ok: { unelevated: true, color: 'negative', label: 'Sí, salir' },
    persistent: true,
  }).onOk(async () => {
    try {
      await leaveMatch(route.params.id)
      $q.notify({ type: 'info', message: 'Inscripción cancelada correctamente' })
    } catch (err) {
      $q.notify({ type: 'negative', message: err.message })
    }
  })
}

// ── Goleadores (playerStats del partido finalizado) ─────────────────────────
const playerStats = ref([])
watch(
  () => match.value?.status,
  async (status) => {
    if (status !== 'finished') return
    try {
      playerStats.value = await fetchPlayerStats(route.params.id)
    } catch {
      playerStats.value = []
    }
  },
  { immediate: true },
)

const scorers = computed(() =>
  playerStats.value
    .filter((p) => (p.goals ?? 0) > 0)
    .sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0)),
)
const scorersA = computed(() => scorers.value.filter((p) => p.team === 'A'))
const scorersB = computed(() => scorers.value.filter((p) => p.team === 'B'))
const scorersNoTeam = computed(() =>
  scorers.value.filter((p) => p.team !== 'A' && p.team !== 'B'),
)

// ── ¿Puede cargar el resultado? (miembro del grupo del partido, o admin) ─────
const myGroupRole = ref(null)
watch(
  () => match.value?.groupId,
  async (gid) => {
    if (!gid) { myGroupRole.value = null; return }
    try { myGroupRole.value = await getMyRole(gid) } catch { myGroupRole.value = null }
  },
  { immediate: true },
)

const canLoadResult = computed(() => {
  const st = getEffectiveStatus(match.value)
  const done = st === 'closed' || st === 'finished' || st === 'full'
  return done && (authStore.isAdmin || !!myGroupRole.value)
})

const matchDate = computed(() =>
  match.value?.date ? date.formatDate(match.value.date.toDate(), 'DD/MM/YYYY') : '',
)
const matchTime = computed(() =>
  match.value?.date ? date.formatDate(match.value.date.toDate(), 'HH:mm') : '',
)

const STATUS_MAP = {
  scheduled: { label: 'Programado', color: 'blue-grey-6' },
  open:      { label: 'Abierto',    color: 'green-7' },
  full:      { label: 'Completo',   color: 'orange-7' },
  closed:    { label: 'Cerrado',    color: 'red-7' },
  finished:  { label: 'Finalizado', color: 'grey-6' },
}
const statusLabel = computed(() => STATUS_MAP[getEffectiveStatus(match.value)]?.label ?? match.value?.status ?? '')
const statusColor = computed(() => STATUS_MAP[getEffectiveStatus(match.value)]?.color ?? 'grey')

// Link "Agregar a Google Calendar" — solo para partidos que aún no finalizaron.
const calendarUrl = computed(() =>
  match.value && match.value.status !== 'finished' ? buildGoogleCalendarUrl(match.value) : null,
)
</script>
