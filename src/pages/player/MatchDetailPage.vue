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
      <!-- Aviso permanente para el invitado del link: qué puede hacer acá y
           cómo pasar a una cuenta real cuando quiera (sin perder el lugar). -->
      <q-banner v-if="authStore.isGuest" dense class="bg-blue-1 text-blue-10 rounded-borders q-mb-md">
        <template #avatar><q-icon name="person_outline" color="blue-8" /></template>
        <div class="text-body2">
          Estás como <strong>invitado</strong>: podés anotarte a este partido y ver la lista.
          Las estadísticas, los grupos y el perfil necesitan una cuenta.
        </div>
        <template #action>
          <q-btn flat dense no-caps color="blue-9" label="Crear cuenta" @click="goToRegister" />
        </template>
      </q-banner>

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

          <!-- Cancha reservada -->
          <q-separator class="q-my-md" />
          <div class="row items-center justify-between">
            <div class="row items-center q-gutter-sm">
              <q-icon
                :name="match.venueReserved ? 'event_available' : 'event_busy'"
                :color="match.venueReserved ? 'positive' : 'grey-6'"
                size="22px"
              />
              <span class="text-body2" :class="match.venueReserved ? 'text-positive text-weight-medium' : 'text-grey-6'">
                {{ match.venueReserved ? 'Cancha reservada' : 'Cancha sin reservar' }}
              </span>
            </div>
            <q-toggle
              v-if="canManageVenue"
              :model-value="!!match.venueReserved"
              color="positive"
              :disable="togglingVenue"
              @update:model-value="handleToggleVenueReserved"
            />
          </div>
        </q-card-section>
      </q-card>

      <!-- Clima previsto (si la sede tiene coordenadas y el partido no pasó) -->
      <q-card v-if="weather" flat bordered class="q-mb-md">
        <q-card-section class="row items-center q-gutter-sm">
          <q-icon :name="weather.isRain ? 'umbrella' : 'wb_sunny'" color="blue-8" size="28px" />
          <div class="col text-body2">{{ weather.phrase }}</div>
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
              <template v-if="visibleCupos.isFree">{{ visibleCupos.current }} anotados (sin límite)</template>
              <template v-else>{{ visibleCupos.current }} / {{ visibleCupos.max }}</template>
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
        <q-card-section class="q-pb-none row items-center justify-between">
          <div class="text-overline text-green-9 text-weight-bold">
            <template v-if="match.maxPlayers == null">Anotados ({{ starters.length }})</template>
            <template v-else>Anotados ({{ starters.length }}/{{ match.maxPlayers }})</template>
          </div>
          <q-btn
            flat
            dense
            round
            icon="share"
            color="green-9"
            @click="shareList"
          >
            <q-tooltip>Compartir lista</q-tooltip>
          </q-btn>
        </q-card-section>

        <!-- Armado de equipos (OG/admin, desde que la lista está cerrada) -->
        <template v-if="canManageTeams">
          <q-card-section id="equipos" class="q-pt-none">
            <div class="row items-center q-gutter-sm">
              <q-btn
                v-if="!teamPreview"
                flat
                dense
                no-caps
                color="primary"
                icon="groups"
                :label="teamsAssigned ? 'Re-sugerir equipos' : 'Sugerir equipos'"
                :loading="suggestingTeams"
                @click="handleSuggestTeams"
              />
              <q-btn
                v-if="teamPreview"
                unelevated
                dense
                no-caps
                color="positive"
                icon="check"
                label="Aceptar"
                :loading="acceptingTeams"
                @click="handleAcceptTeams"
              />
              <q-btn
                v-if="teamPreview"
                flat
                dense
                no-caps
                color="primary"
                icon="refresh"
                label="Recalcular"
                :loading="suggestingTeams"
                @click="handleSuggestTeams"
              />
              <q-btn
                v-if="teamPreview"
                flat
                dense
                no-caps
                color="grey-7"
                label="Descartar"
                @click="teamPreview = null"
              />
            </div>

            <!-- Preview editable antes de aceptar -->
            <div v-if="teamPreview" class="q-mt-sm">
              <div class="text-caption text-grey-6 q-mb-xs">
                Propuesta — podés reasignar a mano antes de aceptar:
              </div>
              <div class="row q-col-gutter-md">
                <div class="col-12 col-sm-6">
                  <div class="text-caption text-weight-bold text-grey-7 q-mb-xs">Equipo A</div>
                  <q-chip
                    v-for="p in teamPreview"
                    v-show="p.team === 'A'"
                    :key="p.registrationId"
                    dense
                    removable
                    clickable
                    icon="swap_horiz"
                    class="preview-chip"
                    @remove="togglePreviewTeam(p.registrationId)"
                    @click="goToProfile(p)"
                  >
                    <span class="ellipsis">{{ p.displayName }}</span>
                  </q-chip>
                </div>
                <div class="col-12 col-sm-6">
                  <div class="text-caption text-weight-bold text-grey-7 q-mb-xs">Equipo B</div>
                  <q-chip
                    v-for="p in teamPreview"
                    v-show="p.team === 'B'"
                    :key="p.registrationId"
                    dense
                    removable
                    clickable
                    icon="swap_horiz"
                    class="preview-chip"
                    @remove="togglePreviewTeam(p.registrationId)"
                    @click="goToProfile(p)"
                  >
                    <span class="ellipsis">{{ p.displayName }}</span>
                  </q-chip>
                </div>
              </div>
              <div class="text-caption text-grey-5 q-mt-xs">
                Tocá la ✕ de un jugador para pasarlo al otro equipo.
              </div>
            </div>
          </q-card-section>
          <q-separator />
        </template>

        <!-- Divididos por equipo (si ya se aceptó una asignación) -->
        <template v-if="!teamPreview && teamsAssigned">
          <div class="row q-col-gutter-none">
            <div class="col-6">
              <q-card-section class="q-pb-none">
                <div class="text-caption text-weight-bold text-grey-7">Equipo A</div>
              </q-card-section>
              <q-list dense>
                <q-item v-for="reg in startersTeamA" :key="reg.id" :clickable="!!reg.userId" @click="goToProfile(reg)">
                  <q-item-section>{{ reg.displayName }}</q-item-section>
                </q-item>
              </q-list>
            </div>
            <div class="col-6">
              <q-card-section class="q-pb-none">
                <div class="text-caption text-weight-bold text-grey-7">Equipo B</div>
              </q-card-section>
              <q-list dense>
                <q-item v-for="reg in startersTeamB" :key="reg.id" :clickable="!!reg.userId" @click="goToProfile(reg)">
                  <q-item-section>{{ reg.displayName }}</q-item-section>
                </q-item>
              </q-list>
            </div>
          </div>
          <template v-if="startersNoTeam.length > 0">
            <q-card-section class="q-pb-none">
              <div class="text-caption text-weight-bold text-grey-7">Sin equipo asignado</div>
            </q-card-section>
            <q-list dense>
              <q-item v-for="reg in startersNoTeam" :key="reg.id" :clickable="!!reg.userId" @click="goToProfile(reg)">
                <q-item-section avatar>
                  <q-avatar size="28px" color="green-2" text-color="green-9">
                    {{ reg.position }}
                  </q-avatar>
                </q-item-section>
                <q-item-section>{{ reg.displayName }}</q-item-section>
              </q-item>
            </q-list>
          </template>
        </template>

        <!-- Lista simple (sin equipos asignados todavía) -->
        <q-list v-else-if="!teamPreview" dense>
          <q-item v-for="reg in starters" :key="reg.id" :clickable="!!reg.userId" @click="goToProfile(reg)">
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
            <q-item v-for="reg in waitlist" :key="reg.id" :clickable="!!reg.userId" @click="goToProfile(reg)">
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

          <MatchMvpVoting
            :match="match"
            :match-id="route.params.id"
            :player-stats="playerStats"
            :can-close-voting="canLoadResult"
          />

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

    <!-- El invitado tocó una sección que necesita cuenta: se le explica por
         qué, en vez de rebotarlo sin más (el guard ya lo trajo hasta acá). -->
    <q-dialog v-model="showRegisterPrompt">
      <q-card style="max-width: 380px">
        <q-card-section class="row items-center q-gutter-sm">
          <q-icon name="lock_open" color="green-8" size="28px" />
          <div class="text-subtitle1 text-weight-bold">Esa sección necesita cuenta</div>
        </q-card-section>
        <q-card-section class="q-pt-none text-body2 text-grey-8">
          Los grupos, el ranking y tu perfil guardan datos tuyos, así que hace falta
          una cuenta. Creala en un minuto — <strong>tu lugar en la lista se mantiene</strong>.
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat no-caps color="grey-7" label="Seguir como invitado" />
          <q-btn unelevated no-caps color="primary" class="pill-btn" label="Crear cuenta" @click="goToRegister" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { date, useQuasar } from 'quasar'
import { useMatch, getEffectiveStatus } from 'src/composables/useMatch'
import { useGroups } from 'src/composables/useGroups'
import { usePlayerStats } from 'src/composables/usePlayerStats'
import { useRegistration } from 'src/composables/useRegistration'
import { useWeather } from 'src/composables/useWeather'
import { useVenues } from 'src/composables/useVenues'
import { useTeamBalancer } from 'src/composables/useTeamBalancer'
import { useAuth } from 'src/composables/useAuth'
import { useAuthStore } from 'src/stores/auth.store'
import { useMatchInvite, setPendingInvite } from 'src/composables/useMatchInvite'
import { buildListText, shareListText } from 'src/utils/shareList'
import { buildGoogleCalendarUrl } from 'src/utils/calendar'
import MatchMvpVoting from 'src/components/MatchMvpVoting.vue'
import { doc, getDoc, collection, getDocs } from 'firebase/firestore'
import { db } from 'src/services/firebase'

const $q = useQuasar()
const route = useRoute()
const router = useRouter()

// Invitados (isGuest, sin cuenta) no tienen perfil — no navega para esos
function goToProfile(reg) {
  if (!reg.userId) return
  // El invitado del link no puede ver perfiles (el guard lo rebotaría)
  if (authStore.isGuest) return
  router.push({ name: 'profile-view', params: { uid: reg.userId } })
}
const { currentMatch: match, loading, subscribeToMatch, stopListening, toggleVenueReserved } = useMatch()
const { getMyRole } = useGroups()
const { fetchPlayerStats } = usePlayerStats()
const { fetchForecast } = useWeather()
const { getVenue } = useVenues()
const { suggestTeams } = useTeamBalancer()
const { joinMatchGroup } = useMatchInvite()
const { logout } = useAuth()
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
  assignTeams,
} = useRegistration()

// ── Llegada por link de invitación ──────────────────────────────────────────
// `?invitado=1` lo pone el guard del router después de un login disparado
// desde la landing de invitación: ahí se completa el circuito entero sumando
// a la persona al grupo que organiza el partido (el link vale como invitación
// al grupo). `?registrate=1` lo pone el guard cuando un invitado anónimo
// intentó entrar a una sección que no le corresponde — solo abre el diálogo
// que lo invita a crear la cuenta, sin tocar datos.
const showRegisterPrompt = ref(false)

onMounted(async () => {
  subscribeToMatch(route.params.id)
  subscribeToRegistrations(route.params.id)

  if (route.query.registrate === '1') {
    showRegisterPrompt.value = true
  }

  if (route.query.invitado === '1' && authStore.isAuthenticated && !authStore.isGuest) {
    try {
      const { joined } = await joinMatchGroup(route.params.id)
      if (joined) {
        $q.notify({
          type: 'positive',
          icon: 'group_add',
          message: 'Te sumamos al grupo del partido.',
          caption: 'Ya podés anotarte y ver el resto de sus listas.',
          timeout: 5000,
        })
      }
    } catch (err) {
      // Que falle sumarlo al grupo no debe romper la pantalla: igual puede
      // ver el partido, y el motivo real aparece en el aviso.
      $q.notify({ type: 'warning', message: `No pudimos sumarte al grupo: ${err.message}` })
    }
  }
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
  // Infinity = no tiene derecho a este partido (no es del grupo): no hay hora
  // que anunciar, la lista no se le abre nunca.
  if (ms <= 0 || !Number.isFinite(ms)) return ''
  return date.formatDate(new Date(Date.now() + ms), 'DD/MM HH:mm')
})
// Cupos "engaño visual": antes del horario de acceso de cada uno se muestran
// en 0/0, igual que la lista de anotados — no debe notarse que ya hay gente.
// Formato libre (maxPlayers null): sin denominador, la barra siempre queda vacía.
const visibleCupos = computed(() => {
  const isFree = match.value?.maxPlayers == null
  if (!match.value || !canSeeRegistrations(match.value)) return { current: 0, max: 0, ratio: 0, isFree }
  const current = match.value.currentPlayers ?? 0
  const max = match.value.maxPlayers ?? 0
  return { current, max, ratio: isFree ? 0 : (max ? current / max : 0), isFree }
})
const starters = computed(() => registrations.value.filter((r) => !r.isOnWaitlist))
const waitlist = computed(() => registrations.value.filter((r) => r.isOnWaitlist))

// ── Armado de equipos (antes de jugar) ───────────────────────────────────────
// Solo quien tiene acceso anticipado en el grupo (OG/owner/admin) o admin
// global puede sugerir/ajustar equipos, y solo desde que la lista está
// cerrada (closed/full/finished) — ya se sabe quién juega. El algoritmo
// SUGIERE; quien lo tocó decide si acepta la propuesta o la descarta.
const canManageTeams = computed(() => {
  if (!match.value) return false
  const st = getEffectiveStatus(match.value)
  const listaCerrada = st === 'closed' || st === 'full' || st === 'finished'
  if (!listaCerrada) return false
  return authStore.isAdmin || authStore.isOgInGroup(match.value.groupId)
})

const teamsAssigned = computed(() => starters.value.some((r) => r.team === 'A' || r.team === 'B'))
const startersTeamA = computed(() => starters.value.filter((r) => r.team === 'A'))
const startersTeamB = computed(() => starters.value.filter((r) => r.team === 'B'))
const startersNoTeam = computed(() => starters.value.filter((r) => r.team !== 'A' && r.team !== 'B'))

// Propuesta pendiente de aceptar/descartar — null cuando no hay preview activo.
const teamPreview = ref(null)
const suggestingTeams = ref(false)
const acceptingTeams = ref(false)

// Lee stats/preferredPositions/chemistry de cada titular (con cuenta) y arma
// la propuesta con useTeamBalancer — misma lógica que antes vivía en
// PostMatchPage, pero acá se aplica ANTES de jugar, no después.
async function handleSuggestTeams() {
  const withAccount = starters.value.filter((r) => r.userId)
  if (withAccount.length < 2) {
    $q.notify({ type: 'warning', message: 'Hacen falta al menos 2 titulares con cuenta para sugerir equipos.' })
    return
  }

  suggestingTeams.value = true
  try {
    const players = await Promise.all(
      withAccount.map(async (reg) => {
        const [userSnap, chemSnap] = await Promise.all([
          getDoc(doc(db, 'users', reg.userId)),
          getDocs(collection(db, 'users', reg.userId, 'chemistry')),
        ])
        const userData = userSnap.exists() ? userSnap.data() : {}
        return {
          userId: reg.userId,
          registrationId: reg.id,
          displayName: reg.displayName,
          stats: userData.stats ?? {},
          preferredPositions: userData.preferredPositions ?? [],
          chemistry: new Map(chemSnap.docs.map((d) => [d.id, d.data()])),
        }
      }),
    )

    const { teamA, teamB } = suggestTeams(players)
    teamPreview.value = [
      ...teamA.map((p) => ({ ...p, team: 'A' })),
      ...teamB.map((p) => ({ ...p, team: 'B' })),
    ]
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    suggestingTeams.value = false
  }
}

function togglePreviewTeam(registrationId) {
  teamPreview.value = teamPreview.value.map((p) =>
    p.registrationId === registrationId ? { ...p, team: p.team === 'A' ? 'B' : 'A' } : p,
  )
}

async function handleAcceptTeams() {
  if (!teamPreview.value) return
  acceptingTeams.value = true
  try {
    await assignTeams(
      route.params.id,
      teamPreview.value.map((p) => ({ registrationId: p.registrationId, team: p.team })),
    )
    teamPreview.value = null
    $q.notify({ type: 'positive', icon: 'groups', message: 'Equipos asignados.' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    acceptingTeams.value = false
  }
}

// ── Compartir lista (texto plano para WhatsApp) ──────────────────────────────
// La construcción del texto vive en src/utils/shareList.js, compartida con
// DashboardPage.
function shareList() {
  const text = buildListText({
    match: match.value,
    when: [matchDate.value, matchTime.value].filter(Boolean).join(' - '),
    starters: starters.value,
    waitlist: waitlist.value,
    teamsAssigned: teamsAssigned.value,
    teamA: startersTeamA.value,
    teamB: startersTeamB.value,
    noTeam: startersNoTeam.value,
    includeInviteLink: !authStore.isGuest,
  })
  return shareListText(text, $q.notify)
}

// El invitado pasa a tener cuenta. Se deja la invitación pendiente para que,
// al terminar de registrarse, el guard lo traiga de vuelta a ESTE partido y le
// sume el grupo — el circuito completo, sin que tenga que buscar nada.
async function goToRegister() {
  showRegisterPrompt.value = false
  setPendingInvite(route.params.id)
  // Cerrar la sesión anónima primero: si no, el guard ve una sesión activa y
  // rebota /login de vuelta al dashboard.
  try {
    await logout()
  } catch {
    // aunque falle el signOut, /login puede resolverlo
  }
  router.push('/login')
}

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

// ── Clima previsto para el partido (si la sede tiene coordenadas) ───────────
const weather = ref(null)
watch(
  () => [match.value?.id, match.value?.venueLat, match.value?.venueLng, match.value?.status],
  async () => {
    weather.value = null
    const m = match.value
    if (!m || m.status === 'finished' || !m.date) return

    // Las coordenadas se denormalizan en el partido al crearlo/editarlo. Los
    // partidos creados antes de que las sedes tuvieran lat/lng quedaron con
    // venueLat null, y como el clima dependía SOLO de ese campo, no se
    // mostraba nunca (ni siquiera después de geocodificar la sede). Si el
    // partido no las trae, se leen de la sede en el momento.
    let lat = m.venueLat
    let lng = m.venueLng
    if ((lat == null || lng == null) && m.venueId) {
      try {
        const venue = await getVenue(m.venueId)
        lat = venue?.lat ?? null
        lng = venue?.lng ?? null
      } catch {
        // sede borrada o sin permiso: simplemente no hay clima que mostrar
      }
    }
    if (lat == null || lng == null) return

    weather.value = await fetchForecast(lat, lng, m.date.toDate())
  },
  { immediate: true },
)

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

// La votación de MVP vive en <MatchMvpVoting> (src/components), con su propio
// estado y su listener de votos.

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

// A las 36hs de finalizado, resultLocked bloquea la edición para cualquiera
// que no sea admin global (lo fija processAutoCloseMatches en Cloud Functions).
const canLoadResult = computed(() => {
  const st = getEffectiveStatus(match.value)
  const done = st === 'closed' || st === 'finished' || st === 'full'
  if (authStore.isAdmin) return done
  return done && !match.value?.resultLocked && !!myGroupRole.value
})

// ── Cancha reservada: mismo permiso que cargar resultado, pero sin exigir
// que el partido haya terminado (se reserva ANTES de jugar).
const canManageVenue = computed(() => authStore.isAdmin || !!myGroupRole.value)
const togglingVenue = ref(false)

async function handleToggleVenueReserved(reserved) {
  togglingVenue.value = true
  try {
    await toggleVenueReserved(route.params.id, reserved)
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    togglingVenue.value = false
  }
}

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

<style scoped>
/* Nombres largos (José María Marcelo Guzmán...) desbordaban el chip en
   pantallas chicas — se truncan con ellipsis en vez de romper el layout. */
.preview-chip {
  max-width: 100%;
}

.preview-chip :deep(.q-chip__content) {
  min-width: 0;
}

.preview-chip .ellipsis {
  display: inline-block;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
</style>
