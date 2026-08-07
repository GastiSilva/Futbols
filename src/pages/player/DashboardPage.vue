<template>
  <q-page class="bg-grey-1" padding>

    <!-- ── Saludo ──────────────────────────────────────────────────────────── -->
    <div class="row items-center q-mb-lg no-wrap">
      <div class="col overflow-hidden">
        <div class="text-h6 text-weight-bold ellipsis">¡Hola, {{ firstName }}!</div>
        <div class="text-caption text-grey-6 text-capitalize">{{ today }}</div>
      </div>
      <q-btn
        v-if="isAdmin || authStore.memberGroupIds.length > 0"
        unelevated
        dense
        color="green-9"
        icon="add"
        label="Crear partido"
        class="pill-btn"
        :to="{ name: 'create-match-player' }"
      />
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
          @hide="onMatchCollapse(match.id)"
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
                  <template v-if="visibleCupos(match).isFree">{{ visibleCupos(match).current }} anotados</template>
                  <template v-else>{{ visibleCupos(match).current }} / {{ visibleCupos(match).max }}</template>
                </div>
                <q-linear-progress
                  :value="visibleCupos(match).ratio"
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
              <q-badge v-if="match.venueReserved" color="positive" outline>
                <q-icon name="event_available" size="14px" class="q-mr-xs" />Cancha reservada
              </q-badge>
            </div>
          </template>

          <!-- ── Contenido expandido del partido ──────────────────────────── -->
          <q-separator />

          <q-card-section class="q-pa-lg">

            <!-- Detalles: fecha, hora, formato, ubicación -->
            <div class="row q-col-gutter-sm q-mb-lg text-center">
              <div class="col-4">
                <q-icon name="calendar_today" color="green-9" size="26px" />
                <div class="text-caption text-grey-6 q-mt-xs">Fecha</div>
                <div class="text-body2 text-weight-medium">{{ formatMatchDate(match.date) }}</div>
              </div>
              <div class="col-4">
                <q-icon name="schedule" color="green-9" size="26px" />
                <div class="text-caption text-grey-6 q-mt-xs">Hora</div>
                <div class="text-body2 text-weight-medium">{{ formatMatchTime(match.date) }}</div>
              </div>
              <div class="col-4">
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
                <div class="row items-center q-gutter-md q-mt-xs">
                  <a
                    v-if="match.venueMapsUrl"
                    :href="match.venueMapsUrl"
                    target="_blank"
                    rel="noopener"
                    class="text-caption text-green-8"
                  >
                    <q-icon name="map" size="xs" class="q-mr-xs" />Ver en Google Maps
                  </a>
                  <a
                    v-if="match.status !== 'finished' && buildGoogleCalendarUrl(match)"
                    :href="buildGoogleCalendarUrl(match)"
                    target="_blank"
                    rel="noopener"
                    class="text-caption text-green-8"
                  >
                    <q-icon name="event" size="xs" class="q-mr-xs" />Agregar a Calendar
                  </a>
                </div>
              </div>
            </div>

            <!-- Barra de cupos -->
            <div class="q-mb-lg">
              <div class="row justify-between items-center q-mb-xs">
                <span class="text-caption text-grey-6 text-uppercase">Cupos</span>
                <span class="text-caption text-weight-bold">
                  {{ visibleCupos(match).current }} / {{ visibleCupos(match).max }}
                </span>
              </div>
              <q-linear-progress
                :value="visibleCupos(match).ratio"
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

            <!-- ③ Botón ANOTARME (como suplente si el cupo está lleno) -->
            <div v-else-if="canRegister(match)">
              <q-banner
                v-if="match.status === 'full'"
                dense
                class="bg-orange-1 text-orange-9 rounded-borders q-mb-sm"
              >
                <template #avatar>
                  <q-icon name="hourglass_top" color="orange-8" />
                </template>
                Cupo completo — podés anotarte como suplente y entrás automáticamente si alguien se baja.
              </q-banner>
              <q-banner
                v-else-if="isInEarlyWindow(match)"
                dense
                class="bg-blue-1 text-blue-9 rounded-borders q-mb-sm"
              >
                <template #avatar>
                  <q-icon name="bolt" color="blue-8" />
                </template>
                Acceso anticipado — te estás anotando antes de que abra la lista.
              </q-banner>
              <q-btn
                unelevated
                :color="match.status === 'full' ? 'orange-8' : 'primary'"
                class="full-width pill-btn"
                size="lg"
                style="font-size: 1.05rem; letter-spacing: 1px"
                :loading="loading"
                @click="handleJoin(match.id)"
              >
                <q-icon :name="match.status === 'full' ? 'hourglass_top' : 'sports_soccer'" left />
                {{ match.status === 'full' ? 'ANOTARME COMO SUPLENTE' : 'ANOTARME' }}
              </q-btn>
            </div>

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
                class="full-width pill-btn"
                icon="scoreboard"
                label="Cargar resultado"
                :to="{ name: 'post-match', params: { id: match.id } }"
              />
            </div>

            <!-- ── Acciones de gestión: editar datos / calcular equipos ──────── -->
            <!-- OG/owner/admin del grupo, quien creó el partido, o admin global -->
            <div
              v-if="canManageMatch(match) || canManageTeamsFor(match)"
              class="row q-gutter-sm q-mt-md"
            >
              <q-btn
                v-if="canManageMatch(match)"
                flat
                dense
                no-caps
                color="grey-8"
                icon="edit"
                label="Editar partido"
                class="col"
                :to="{ name: 'edit-match-player', params: { id: match.id } }"
              />
              <q-btn
                v-if="canManageTeamsFor(match)"
                flat
                dense
                no-caps
                color="blue-8"
                icon="groups"
                label="Calcular equipos"
                class="col"
                :to="{ name: 'match-detail', params: { id: match.id }, hash: '#equipos' }"
              />
              <q-btn
                v-if="canManageMatch(match)"
                flat
                dense
                no-caps
                color="negative"
                icon="delete_outline"
                label="Borrar partido"
                class="col"
                @click="handleDeleteMatch(match)"
              />
            </div>

            <q-separator class="q-my-lg" />

        <!-- ── Lista de inscriptos (visible desde el horario de acceso de cada uno) ── -->
        <template v-if="!canSeeRegistrations(match)">
          <q-card flat bordered class="q-pa-md row items-center q-gutter-sm text-grey-6">
            <q-icon name="visibility_off" size="22px" />
            <span class="text-body2">La lista se va a ver a las {{ registrationsVisibleAtLabel(match) }}.</span>
          </q-card>
        </template>

        <template v-else>
        <div class="row items-center justify-between q-mb-sm">
          <div class="text-overline text-grey-6 dash-overline">
            ANOTADOS ({{ titularesDe(match.id).length }})
            <span v-if="suplentesDe(match.id).length > 0"> · SUPLENTES ({{ suplentesDe(match.id).length }})</span>
          </div>
          <q-btn
            v-if="registrationsDe(match.id).length > 0"
            flat
            dense
            round
            icon="share"
            color="green-9"
            @click="shareList(match)"
          >
            <q-tooltip>Compartir lista</q-tooltip>
          </q-btn>
        </div>

        <q-card flat bordered>
          <q-list separator>

            <!-- Titulares -->
            <q-item
              v-for="reg in titularesDe(match.id)"
              :key="reg.id"
              class="q-py-sm"
              :class="{ 'bg-green-1': reg.userId === user?.uid }"
              :clickable="!!reg.userId"
              @click="goToProfile(reg)"
            >
              <q-item-section avatar>
                <q-avatar size="36px">
                  <img
                    v-if="reg.photoURL"
                    :src="reg.photoURL"
                    :alt="reg.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <q-icon v-else :name="reg.isGuest ? 'person_outline' : 'person'" />
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
                <q-item-label v-if="regSubtitle(reg)" caption>{{ regSubtitle(reg) }}</q-item-label>
              </q-item-section>

              <q-item-section side>
                <div class="row items-center no-wrap q-gutter-xs">
                  <q-badge
                    v-if="reg.team === 'A' || reg.team === 'B'"
                    :color="reg.team === 'A' ? 'blue-8' : 'red-8'"
                    text-color="white"
                    :label="reg.team"
                  />
                  <q-badge color="primary" text-color="dark" :label="`#${reg.position}`" />
                  <q-btn
                    v-if="canRemoveReg(reg)"
                    flat round dense size="sm"
                    icon="close"
                    color="grey-6"
                    :loading="loading"
                    @click.stop="handleRemoveReg(reg)"
                  />
                </div>
              </q-item-section>
            </q-item>

            <!-- Separador suplentes -->
            <template v-if="suplentesDe(match.id).length > 0">
              <q-separator />
              <q-item-label
                header
                class="text-orange-8 text-caption text-uppercase bg-orange-1 q-py-xs q-px-md"
              >
                <q-icon name="hourglass_empty" size="xs" class="q-mr-xs" />Lista de espera
              </q-item-label>

              <q-item
                v-for="reg in suplentesDe(match.id)"
                :key="reg.id"
                class="q-py-sm"
                :class="{ 'bg-orange-1': reg.userId === user?.uid }"
                :clickable="!!reg.userId"
                @click="goToProfile(reg)"
              >
                <q-item-section avatar>
                  <q-avatar size="36px">
                    <img
                      v-if="reg.photoURL"
                      :src="reg.photoURL"
                      :alt="reg.displayName"
                      referrerpolicy="no-referrer"
                    />
                    <q-icon v-else :name="reg.isGuest ? 'person_outline' : 'person'" />
                  </q-avatar>
                </q-item-section>

                <q-item-section>
                  <q-item-label>{{ reg.displayName }}</q-item-label>
                  <q-item-label v-if="regSubtitle(reg)" caption>{{ regSubtitle(reg) }}</q-item-label>
                </q-item-section>

                <q-item-section side>
                  <div class="row items-center no-wrap q-gutter-xs">
                    <q-badge
                      color="orange-8"
                      text-color="white"
                      :label="`Esp. #${reg.position - match.maxPlayers}`"
                    />
                    <q-btn
                      v-if="canRemoveReg(reg)"
                      flat round dense size="sm"
                      icon="close"
                      color="grey-6"
                      :loading="loading"
                      @click.stop="handleRemoveReg(reg)"
                    />
                  </div>
                </q-item-section>
              </q-item>
            </template>

            <!-- Lista vacía -->
            <q-item v-if="registrationsDe(match.id).length === 0" class="q-py-md">
              <q-item-section class="text-center text-grey-5">
                <q-icon name="people_outline" size="28px" class="q-mb-xs" />
                Nadie anotado todavía — ¡sé el primero!
              </q-item-section>
            </q-item>

          </q-list>
        </q-card>
        </template>

            <!-- ── Anotar a otra persona (invitado o miembro del grupo) ──────── -->
            <q-btn
              v-if="canAddOthers(match)"
              outline
              color="green-9"
              icon="person_add"
              label="Anotar a otra persona"
              class="full-width q-mt-md pill-btn"
              @click="openAddDialog"
            />

          </q-card-section>
        </q-expansion-item>
      </div>

      <q-btn
        flat
        color="green-9"
        label="Ver estadísticas del grupo"
        icon-right="arrow_forward"
        class="full-width q-mt-md q-mb-lg"
        :to="{ name: 'leaderboard' }"
      />

      <!-- ── Dialog: anotar a otra persona ──────────────────────────────────── -->
      <q-dialog v-model="showAddDialog">
        <q-card style="min-width: 320px; max-width: 480px; width: 100%">
          <q-card-section class="text-h6">Anotar a otra persona</q-card-section>

          <q-card-section class="q-pt-none">
            <q-banner
              v-if="earlyWindowActive"
              dense
              class="bg-blue-1 text-blue-9 rounded-borders q-mb-md"
            >
              <template #avatar>
                <q-icon name="bolt" color="blue-8" />
              </template>
              Acceso anticipado: solo podés anotar a miembros que también tengan
              acceso anticipado. Los invitados y el resto entran cuando abre la lista.
            </q-banner>

            <q-btn-toggle
              v-if="addModeOptions.length > 1"
              v-model="addMode"
              spread
              no-caps
              unelevated
              toggle-color="green-9"
              color="grey-3"
              text-color="grey-8"
              :options="addModeOptions"
              class="q-mb-md"
            />

            <template v-if="addMode === 'guest'">
              <q-input
                v-model="guestName"
                label="Nombre del invitado"
                hint="Alguien que no usa la app"
                outlined
                autofocus
                maxlength="40"
                @keyup.enter="handleAddPerson"
              />
            </template>

            <template v-else>
              <q-select
                v-model="selectedMember"
                :options="availableMembers"
                option-label="displayName"
                option-value="userId"
                emit-value
                map-options
                label="Elegí un miembro del grupo"
                outlined
                :loading="loadingMembers"
              />
              <div
                v-if="!loadingMembers && availableMembers.length === 0"
                class="text-caption text-grey-6 q-mt-sm"
              >
                {{ earlyWindowActive
                  ? 'No hay miembros con acceso anticipado sin anotar.'
                  : 'Todos los miembros del grupo ya están anotados.' }}
              </div>
            </template>
          </q-card-section>

          <q-card-actions align="right" class="q-pb-md q-px-md">
            <q-btn flat label="Cancelar" v-close-popup :disable="loading" />
            <q-btn
              unelevated
              color="primary"
              class="pill-btn"
              label="Anotar"
              :loading="loading"
              @click="handleAddPerson"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>

    </template>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'
import { useRegistration } from 'src/composables/useRegistration'
import { useMatch, getEffectiveStatus } from 'src/composables/useMatch'
import { useGroups } from 'src/composables/useGroups'
import { useAuthStore } from 'src/stores/auth.store'
import { buildGoogleCalendarUrl } from 'src/utils/calendar'

const $q = useQuasar()
const router = useRouter()
const { user, isAdmin } = useAuth()

// Ver el perfil de un anotado desde la lista. Los invitados (isGuest, sin
// cuenta) no tienen perfil, así que para esos no navega.
function goToProfile(reg) {
  if (!reg.userId) return
  router.push({ name: 'profile-view', params: { uid: reg.userId } })
}
const {
  joinMatch,
  addGuestToMatch,
  addMemberToMatch,
  leaveMatch,
  removeRegistration,
  canRegister,
  msUntilOpen,
  canSeeRegistrations,
  isInEarlyWindow,
  subscribeToRegistrations,
  stopListening,
  loading,
} = useRegistration()
const { matches, subscribeToUpcoming: subscribeToMatchesUpcoming, deleteMatch } = useMatch()
const { getGroupMembers } = useGroups()
const authStore = useAuthStore()

// ── Matches próximos ─────────────────────────────────────────────────────────
const upcomingMatches = computed(() =>
  matches.value?.map((m) => ({
    id: m.id,
    title: m.title,
    location: m.location,
    venueMapsUrl: m.venueMapsUrl ?? null,
    date: m.date,
    openAt: m.openAt,
    format: m.format,
    maxPlayers: m.maxPlayers,
    currentPlayers: m.currentPlayers ?? 0,
    status: getEffectiveStatus(m),
    groupId: m.groupId ?? null,
    createdBy: m.createdBy ?? null,
  })) ?? [],
)

// ── Match seleccionado (expandido) ───────────────────────────────────────────
const selectedMatchId = ref(null)

const selectedMatch = computed(() =>
  upcomingMatches.value.find((m) => m.id === selectedMatchId.value),
)

// Al replegar el partido expandido, deja de mostrarse la lista de anotados
// de abajo (si no, quedaba pegada mostrando el último seleccionado).
function onMatchCollapse(matchId) {
  if (selectedMatchId.value === matchId) selectedMatchId.value = null
}

// ── Compartir lista (texto plano para WhatsApp) ──────────────────────────────
function buildListText(m) {
  const lines = []
  lines.push(`⚽ ${m.title}`)
  if (m.location) lines.push(`📍 ${m.location}`)
  const when = [formatMatchDate(m.date), formatMatchTime(m.date)].filter(Boolean).join(' - ')
  if (when) lines.push(`🕒 ${when}`)
  lines.push('')
  titularesDe(m.id).forEach((r) => {
    lines.push(`${r.position}. ${r.displayName}`)
  })
  const suplentes = suplentesDe(m.id)
  if (suplentes.length > 0) {
    lines.push('')
    lines.push('Suplentes:')
    suplentes.forEach((r) => {
      lines.push(`${r.position - m.maxPlayers}. ${r.displayName}`)
    })
  }
  return lines.join('\n')
}

async function shareList(m) {
  const text = buildListText(m)
  if (navigator.share) {
    try {
      await navigator.share({ text })
      return
    } catch {
      // usuario canceló el share nativo — no hacer nada más
      return
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    $q.notify({ type: 'positive', icon: 'content_copy', message: 'Lista copiada al portapapeles' })
  } catch {
    $q.notify({ type: 'negative', message: 'No se pudo copiar la lista' })
  }
}

// Hora en la que ESTE usuario puntual va a poder ver la lista de anotados
// (creador: siempre; OG: 30 min antes; miembro común: la hora oficial).
function registrationsVisibleAtLabel(m) {
  if (!m) return ''
  const ms = msUntilOpen(m)
  if (ms <= 0) return ''
  const d = new Date(Date.now() + ms)
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)
}

// ── Registraciones globales ──────────────────────────────────────────────────
// Un Map<matchId, registraciones[]> para mantener registraciones por match
const registracionesPorMatch = ref(new Map())

// ── Registraciones POR match ────────────────────────────────────────────────
// Son funciones (no computed sobre selectedMatchId) porque la lista de anotados
// se renderiza dentro de cada q-expansion-item: cada partido muestra la suya.
// Antes eran computeds atadas al match seleccionado y la lista se dibujaba
// fuera del v-for, así que aparecía debajo de TODAS las cards — visualmente
// pegada al partido equivocado cuando había otro partido en el medio.
function registrationsDe(matchId) {
  return registracionesPorMatch.value.get(matchId) ?? []
}

function titularesDe(matchId) {
  return registrationsDe(matchId).filter((r) => !r.isOnWaitlist)
}

function suplentesDe(matchId) {
  return registrationsDe(matchId).filter((r) => r.isOnWaitlist)
}

// El match expandido sigue siendo el "seleccionado" para los diálogos
// (anotar a otra persona, etc.), que operan sobre uno solo a la vez.
const registrationsSeleccionadas = computed(() => registrationsDe(selectedMatchId.value))

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
    full: 'orange-7',
    closed: 'red-7',
    finished: 'grey-6',
  }[status] ?? 'grey-6'
}

function getStatusLabel(status) {
  return {
    scheduled: 'Programado',
    open: 'Abierto',
    full: 'Completo',
    closed: 'Cerrado',
    finished: 'Finalizado',
  }[status] ?? status
}

function getStatusIcon(status) {
  return {
    scheduled: 'pending',
    open: 'radio_button_checked',
    full: 'hourglass_top',
    closed: 'lock',
    finished: 'done_all',
  }[status] ?? 'help'
}

function getHeaderClass(matchId) {
  return selectedMatchId.value === matchId ? 'bg-green-1' : ''
}

// Cupos "engaño visual": antes del horario de acceso de cada uno se muestran
// en 0/0, igual que la lista de anotados — no debe notarse que ya hay gente.
// Formato libre (maxPlayers null): sin denominador, la barra siempre queda vacía.
function visibleCupos(match) {
  const isFree = match.maxPlayers == null
  if (!canSeeRegistrations(match)) return { current: 0, max: 0, ratio: 0, isFree }
  const current = match.currentPlayers ?? 0
  const max = match.maxPlayers ?? 0
  return { current, max, ratio: isFree ? 0 : (max ? current / max : 0), isFree }
}

function getProgressColor(match) {
  const { ratio } = visibleCupos(match)
  return ratio >= 1 ? 'red-7' : ratio >= 0.8 ? 'orange-7' : 'green-9'
}

function getCuposColor(match) {
  const { ratio } = visibleCupos(match)
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

// ── Anotar a otra persona (invitado o miembro del grupo) ─────────────────────
const showAddDialog = ref(false)
const addMode = ref('guest')
const guestName = ref('')
const selectedMember = ref(null)
const groupMembers = ref([])
const loadingMembers = ref(false)

// ¿La ventana de inscripción está abierta para anotar gente?
// - Después de openAt: cualquiera puede anotar invitados/miembros.
// - En la ventana anticipada (30 min antes): solo quienes tienen acceso
//   anticipado (OG/owner/admin) o el creador, y únicamente pueden anotar
//   a otros miembros que TAMBIÉN tengan acceso anticipado (sin invitados).
function canAddOthers(match) {
  if (!match) return false
  if (match.status === 'closed' || match.status === 'finished') return false

  const now = Date.now()
  const openAt = match.openAt?.toMillis?.() ?? 0
  if (now >= openAt) return true

  if (isInEarlyWindow(match) && match.groupId) {
    return authStore.isOgInGroup(match.groupId) || match.createdBy === user.value?.uid
  }
  return false
}

// ¿El match seleccionado está en la ventana anticipada? (restricciones extra)
const earlyWindowActive = computed(() =>
  selectedMatch.value ? isInEarlyWindow(selectedMatch.value) : false,
)

const addModeOptions = computed(() => {
  // En la ventana anticipada no se pueden anotar invitados
  const opts = earlyWindowActive.value ? [] : [{ label: 'Invitado', value: 'guest' }]
  if (selectedMatch.value?.groupId) opts.push({ label: 'Del grupo', value: 'member' })
  return opts
})

// Miembros del grupo que todavía no están anotados.
// En la ventana anticipada solo se listan los que tienen acceso anticipado.
const availableMembers = computed(() => {
  const registeredUids = new Set(
    registrationsSeleccionadas.value.map((r) => r.userId).filter(Boolean),
  )
  let members = groupMembers.value.filter((m) => !registeredUids.has(m.userId))
  if (earlyWindowActive.value) {
    members = members.filter(
      (m) => m.og === true || ['owner', 'admin'].includes(m.role),
    )
  }
  return members
})

async function openAddDialog() {
  guestName.value = ''
  selectedMember.value = null
  addMode.value = earlyWindowActive.value ? 'member' : 'guest'
  showAddDialog.value = true

  const gid = selectedMatch.value?.groupId
  if (gid) {
    loadingMembers.value = true
    try {
      groupMembers.value = await getGroupMembers(gid)
    } catch {
      groupMembers.value = []
    } finally {
      loadingMembers.value = false
    }
  } else {
    groupMembers.value = []
  }
}

async function handleAddPerson() {
  const matchId = selectedMatchId.value
  if (!matchId) return

  try {
    let result
    if (addMode.value === 'guest') {
      if (!guestName.value.trim()) {
        $q.notify({ type: 'warning', message: 'Ingresá un nombre.' })
        return
      }
      result = await addGuestToMatch(matchId, guestName.value)
    } else {
      const member = groupMembers.value.find((m) => m.userId === selectedMember.value)
      if (!member) {
        $q.notify({ type: 'warning', message: 'Elegí un miembro del grupo.' })
        return
      }
      result = await addMemberToMatch(matchId, member)
    }

    showAddDialog.value = false
    $q.notify({
      type: 'positive',
      icon: result.isOnWaitlist ? 'hourglass_empty' : 'check_circle',
      message: result.isOnWaitlist
        ? 'Persona agregada a la lista de espera'
        : '¡Persona anotada!',
    })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  }
}

// Subtítulo de una inscripción: "lo anotó X" solo para invitados (gente sin
// cuenta, ajena al grupo). Si anotás a otro MIEMBRO del grupo, no se muestra
// quién lo agregó — es normal anotar a un compañero, no hace falta aclararlo.
function regSubtitle(reg) {
  if (reg.isGuest) {
    return reg.addedByName ? `Invitado · lo anotó ${reg.addedByName}` : 'Invitado'
  }
  return null
}

// ── Gestión del partido desde el menú de Partidos ────────────────────────────
// Editar datos generales (título, sede, horarios, formato): admin global,
// OG/owner/admin del grupo del partido, o quien lo creó — mismo criterio que
// valida firestore.rules en la rama de "editar datos generales".
function canManageMatch(match) {
  if (!user.value) return false
  if (isAdmin.value) return true
  if (match.createdBy === user.value.uid) return true
  return !!match.groupId && authStore.isOgInGroup(match.groupId)
}

// Calcular/sugerir equipos: mismo criterio que canManageTeams en
// MatchDetailPage — solo desde que la lista está cerrada (ya se sabe quién
// juega) y solo OG/owner/admin del grupo, o admin global.
function canManageTeamsFor(match) {
  if (!match) return false
  const listaCerrada = match.status === 'closed' || match.status === 'full' || match.status === 'finished'
  if (!listaCerrada) return false
  return isAdmin.value || (!!match.groupId && authStore.isOgInGroup(match.groupId))
}

// ¿Puedo quitar esta inscripción? (quien lo anotó, o admin)
function canRemoveReg(reg) {
  const uid = user.value?.uid
  if (!uid) return false
  // A vos mismo te sacás con "Cancelar inscripción" (arriba)
  if (!reg.isGuest && reg.userId === uid) return false
  return reg.addedBy === uid || isAdmin.value
}

function handleRemoveReg(reg) {
  const matchId = selectedMatchId.value
  if (!matchId) return

  $q.dialog({
    title: 'Quitar de la lista',
    message: `¿Sacar a ${reg.displayName} del partido?`,
    cancel: { flat: true, label: 'No' },
    ok: { unelevated: true, color: 'negative', label: 'Sí, sacar' },
  }).onOk(async () => {
    try {
      await removeRegistration(matchId, reg.id)
      $q.notify({ type: 'info', message: `${reg.displayName} fue sacado de la lista` })
    } catch (err) {
      $q.notify({ type: 'negative', message: err.message })
    }
  })
}

// Borrar un partido entero (lista duplicada, o que no juntó gente). Es
// irreversible y se lleva puestas las inscripciones, así que el diálogo
// avisa cuánta gente hay anotada antes de confirmar.
function handleDeleteMatch(match) {
  const anotados = match.currentPlayers ?? 0
  const aviso = anotados > 0
    ? ` Hay ${anotados} ${anotados === 1 ? 'persona anotada' : 'personas anotadas'} que van a perder su lugar.`
    : ''

  $q.dialog({
    title: 'Borrar partido',
    message: `¿Seguro que querés borrar "${match.title}"?${aviso} Esta acción no se puede deshacer.`,
    cancel: { flat: true, label: 'No' },
    ok: { unelevated: true, color: 'negative', label: 'Sí, borrar' },
  }).onOk(async () => {
    try {
      await deleteMatch(match.id)
      if (selectedMatchId.value === match.id) selectedMatchId.value = null
      $q.notify({ type: 'info', message: 'Partido borrado' })
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


