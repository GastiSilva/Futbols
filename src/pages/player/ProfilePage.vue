<template>
  <q-page padding class="bg-grey-1">
    <div class="row justify-center">
      <div class="col-12 col-md-8 col-lg-6">

        <!-- ── Cabecera del perfil ─────────────────────────────────────── -->
        <q-card flat bordered class="q-mb-md">
          <q-card-section class="grass-bg text-white column items-center q-gutter-sm">
            <!-- Avatar + botón para cambiar la foto (útil sobre todo para
                 quienes entran con email y no traen foto de Google) -->
            <div class="relative-position">
              <q-avatar size="88px" class="shadow-4">
                <img
                  :src="user?.photoURL ?? '/icons/icon-128x128.png'"
                  :alt="user?.displayName ?? 'usuario'"
                  referrerpolicy="no-referrer"
                />
              </q-avatar>
              <q-btn
                round
                unelevated
                dense
                color="primary"
                icon="photo_camera"
                size="sm"
                class="absolute"
                style="right: -4px; bottom: -4px"
                :loading="uploadingPhoto"
                @click="photoInput?.pickFiles()"
              >
                <q-tooltip>Cambiar foto</q-tooltip>
              </q-btn>
              <q-file
                ref="photoInput"
                v-model="photoFile"
                accept="image/*"
                style="display: none"
                @update:model-value="handlePhotoSelected"
              />
            </div>
            <div class="column items-center">
              <div class="text-h6 text-weight-bold">{{ user?.nickname || user?.displayName }}</div>
              <div class="text-caption text-green-2">{{ user?.email }}</div>
            </div>
            <div class="row q-gutter-xs items-center justify-center">
              <q-badge :color="roleBadgeColor" text-color="white" :label="roleBadgeLabel" class="q-px-sm" />
              <q-badge
                v-if="user?.preferredFoot"
                color="blue-8"
                text-color="white"
                :label="footLabel(user.preferredFoot)"
                class="q-px-sm"
              />
            </div>
            <q-chip
              v-if="profileFavoriteTeam"
              dense
              square
              color="white"
              text-color="dark"
              class="q-px-sm"
            >
              <q-avatar size="18px">
                <img :src="profileFavoriteTeam.badge" :alt="profileFavoriteTeam.label" />
              </q-avatar>
              <span class="q-ml-xs">Hincha de {{ profileFavoriteTeam.label }}</span>
            </q-chip>
            <div v-if="user?.description" class="text-body2 text-center q-px-md" style="opacity: 0.9">
              {{ user.description }}
            </div>
            <div v-if="descriptionStars.count > 0" class="row items-center q-gutter-xs">
              <q-rating
                :model-value="descriptionStars.avg"
                readonly
                size="1.1em"
                color="amber-8"
                icon="star_border"
                icon-selected="star"
                :max="5"
              />
              <span class="text-caption text-green-2">
                {{ descriptionStars.avg.toFixed(1) }} · {{ descriptionStars.count }}
                {{ descriptionStars.count === 1 ? 'calificación' : 'calificaciones' }}
              </span>
              <q-icon name="help_outline" size="16px" class="text-green-2">
                <q-tooltip>
                  Cuánto le creen tus compañeros de grupo a tu descripción. Es privado — no ves
                  quién te calificó, y se resetea si editás la descripción.
                </q-tooltip>
              </q-icon>
            </div>
            <div v-if="favoritePositions.length" class="row q-gutter-xs justify-center">
              <q-badge
                v-for="code in favoritePositions"
                :key="code"
                color="green-10"
                text-color="white"
                class="q-px-sm"
              >
                {{ positionLabel(code) }}
              </q-badge>
            </div>
          </q-card-section>
        </q-card>

        <!-- ── Estadísticas globales ───────────────────────────────────── -->
        <div class="text-overline text-green-9 text-weight-bold q-mb-sm">
          MIS ESTADÍSTICAS (TOTALES)
        </div>
        <div class="row q-col-gutter-sm q-mb-sm">
          <div v-for="stat in globalStatCards" :key="stat.label" class="col-3">
            <q-card flat bordered class="text-center q-py-sm">
              <q-icon :name="stat.icon" :color="stat.color" size="26px" />
              <div class="text-h6 text-weight-bold">{{ stat.value }}</div>
              <div class="text-caption text-grey-6">{{ stat.label }}</div>
            </q-card>
          </div>
        </div>

        <!-- Récord (ganados / empatados / perdidos) -->
        <q-card flat bordered class="q-mb-md">
          <q-card-section class="row items-center justify-around q-py-sm text-center">
            <div>
              <div class="text-h6 text-weight-bold text-green-8">{{ record.wins }}</div>
              <div class="text-caption text-grey-6">Ganados</div>
            </div>
            <q-separator vertical />
            <div>
              <div class="text-h6 text-weight-bold text-grey-7">{{ record.draws }}</div>
              <div class="text-caption text-grey-6">Empatados</div>
            </div>
            <q-separator vertical />
            <div>
              <div class="text-h6 text-weight-bold text-red-7">{{ record.losses }}</div>
              <div class="text-caption text-grey-6">Perdidos</div>
            </div>
            <q-separator vertical />
            <div>
              <div class="text-h6 text-weight-bold text-blue-8">{{ winRate }}%</div>
              <div class="text-caption text-grey-6">Efectividad</div>
            </div>
          </q-card-section>
        </q-card>

        <!-- ── Estadísticas por grupo ──────────────────────────────────── -->
        <template v-if="groupStatRows.length > 0">
          <div class="text-overline text-green-9 text-weight-bold q-mb-sm">
            POR GRUPO
          </div>
          <q-card flat bordered class="q-mb-md">
            <q-list separator>
              <q-item v-for="row in groupStatRows" :key="row.groupId">
                <q-item-section>
                  <q-item-label class="text-weight-bold">{{ row.groupName }}</q-item-label>
                  <q-item-label caption>
                    {{ row.stats.matchesPlayed ?? 0 }} partidos
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="row q-gutter-sm text-caption">
                    <span>⚽ {{ row.stats.goals ?? 0 }}</span>
                    <span>👟 {{ row.stats.assists ?? 0 }}</span>
                    <span>🏅 {{ row.stats.mvps ?? 0 }}</span>
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </template>

        <!-- ── Mi Mundial ──────────────────────────────────────────────── -->
        <div class="row items-center q-gutter-xs q-mb-sm">
          <img src="/icons/mundial-trophy.webp" alt="" class="mundial-trophy-icon" />
          <div class="text-overline text-green-9 text-weight-bold">
            MI MUNDIAL
          </div>
        </div>
        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <template v-if="!mundial.active && !mundial.lastResult">
              <div class="text-body2 text-grey-7 q-mb-sm">
                Activá tu Mundial personal: jugá 3 partidos de fase de grupos y, si
                clasificás, seguí en llaves de eliminación directa hasta la final.
              </div>
              <q-btn
                label="Activar Mundial"
                color="primary"
                unelevated
                icon="emoji_events"
                class="pill-btn"
                :loading="mundialLoading"
                @click="handleActivateMundial"
              />
            </template>

            <template v-else-if="mundial.active">
              <q-stepper
                :model-value="mundial.phase"
                flat
                header-nav
                :header-class="'mundial-stepper-header'"
                class="q-mb-sm mundial-stepper"
                inactive-color="grey-5"
                done-color="green-8"
                active-color="primary"
              >
                <q-step
                  v-for="p in PHASE_ORDER"
                  :key="p"
                  :name="p"
                  :title="PHASE_LABELS[p]"
                  :icon="p === 'final' ? 'emoji_events' : stepIconFor(p)"
                  :done="PHASE_ORDER.indexOf(p) < PHASE_ORDER.indexOf(mundial.phase)"
                  disable
                />
              </q-stepper>

              <div v-if="mundial.phase === 'groups'" class="row q-gutter-xs items-center">
                <span class="text-caption text-grey-6">Resultados:</span>
                <q-chip
                  v-for="(r, i) in mundial.groupMatchResults"
                  :key="i"
                  dense
                  :color="r === 'W' ? 'green-8' : r === 'E' ? 'grey-6' : 'red-7'"
                  text-color="white"
                >
                  {{ r }}
                </q-chip>
                <span v-if="mundial.groupMatchResults.length === 0" class="text-caption text-grey-6">
                  esperando tu primer partido
                </span>
              </div>

              <div v-if="mundial.phase === 'final'" class="row items-center q-gutter-sm">
                <img src="/icons/mundial-trophy.webp" alt="" class="mundial-trophy-icon" />
                <span class="text-body2 text-weight-bold text-amber-8">
                  ¡Estás en la final! Un partido más para el título.
                </span>
              </div>

              <q-banner
                v-if="mundial.pendingCoinFlip && !mundial.pendingCoinFlip.resolved"
                class="bg-amber-1 text-amber-10 q-mt-sm rounded-borders"
              >
                🪙 Tenés un sorteo pendiente para definir tu Mundial.
                <template #action>
                  <q-btn flat color="amber-10" label="Tirar la moneda" @click="showCoinFlip = true" />
                </template>
              </q-banner>
            </template>

            <template v-else-if="mundial.lastResult">
              <div v-if="mundial.lastResult === 'champion'" class="column items-center q-mb-sm">
                <img src="/icons/mundial-trophy.webp" alt="Campeón" class="mundial-trophy-icon mundial-trophy-icon--lg" />
                <div class="text-body2 text-weight-bold text-amber-8 text-center">
                  Fuiste campeón de tu último Mundial.
                </div>
              </div>
              <div class="text-body2 q-mb-sm" :class="{ 'text-center': mundial.lastResult === 'champion' }">
                <span v-if="mundial.lastResult !== 'champion'" class="text-grey-7">
                  Quedaste eliminado {{ mundial.lastResult === 'eliminated_groups' ? 'en la fase de grupos' : 'en eliminación directa' }}.
                </span>
                <span v-if="mundial.titles > 0" class="text-caption text-grey-6 q-ml-xs">
                  ({{ mundial.titles }} título{{ mundial.titles === 1 ? '' : 's' }} en total)
                </span>
              </div>
              <q-btn
                label="Activar Mundial nuevo"
                color="primary"
                unelevated
                icon="emoji_events"
                class="pill-btn"
                :loading="mundialLoading"
                @click="handleActivateMundial"
              />
            </template>
          </q-card-section>
        </q-card>

        <MundialCoinFlipDialog
          v-model="showCoinFlip"
          :kind="mundial.pendingCoinFlip?.kind"
          @resolved="handleCoinFlipResolved"
        />

        <!-- ── Editar perfil ───────────────────────────────────────────── -->
        <div class="text-overline text-green-9 text-weight-bold q-mb-sm">
          EDITAR PERFIL
        </div>
        <q-card flat bordered>
          <q-card-section>
            <q-form @submit.prevent="handleSave" class="q-gutter-y-md">
              <q-input
                v-model="form.nickname"
                label="Apodo"
                outlined
                maxlength="30"
                counter
                hint="Cómo te dicen en la cancha"
              >
                <template #prepend>
                  <q-icon name="badge" />
                </template>
              </q-input>

              <q-input
                v-model="form.description"
                label="Descripción"
                outlined
                type="textarea"
                autogrow
                maxlength="200"
                counter
                hint="Contá algo sobre tu juego"
              >
                <template #prepend>
                  <q-icon name="notes" />
                </template>
              </q-input>

              <q-select
                v-model="form.preferredFoot"
                :options="FOOT_OPTIONS"
                option-label="label"
                option-value="value"
                emit-value
                map-options
                label="Pie hábil"
                outlined
                clearable
              >
                <template #prepend>
                  <q-icon name="directions_walk" />
                </template>
              </q-select>

              <!-- Equipo del que sos hincha: un solo campo; el menú se abre en
                   cascada (Primera División / Primera Nacional → equipos) -->
              <q-input
                :model-value="selectedFavoriteTeam?.label ?? ''"
                label="Equipo del que sos hincha"
                outlined
                readonly
                clearable
                @clear="form.favoriteTeam = null"
              >
                <template #prepend>
                  <q-avatar v-if="selectedFavoriteTeam" size="24px" square>
                    <img :src="selectedFavoriteTeam.badge" :alt="selectedFavoriteTeam.label" />
                  </q-avatar>
                  <q-icon v-else name="shield" />
                </template>
                <template #append>
                  <q-icon name="arrow_drop_down" />
                </template>

                <q-menu fit>
                  <q-list style="min-width: 260px">
                    <q-expansion-item
                      v-for="league in LEAGUE_OPTIONS"
                      :key="league.value"
                      group="favorite-league"
                      :label="league.label"
                      :default-opened="selectedFavoriteTeam?.league === league.value"
                    >
                      <template #header>
                        <q-item-section avatar>
                          <q-avatar size="24px" square>
                            <img :src="LEAGUE_BADGES[league.value]" alt="" />
                          </q-avatar>
                        </q-item-section>
                        <q-item-section>{{ league.label }}</q-item-section>
                      </template>

                      <q-list>
                        <q-item
                          v-for="team in teamsInLeague(league.value)"
                          :key="team.value"
                          clickable
                          v-close-popup
                          :active="form.favoriteTeam === team.value"
                          active-class="bg-green-1 text-green-9"
                          @click="form.favoriteTeam = team.value"
                        >
                          <q-item-section avatar>
                            <q-avatar size="26px" square>
                              <img :src="team.badge" :alt="team.label" />
                            </q-avatar>
                          </q-item-section>
                          <q-item-section>{{ team.label }}</q-item-section>
                        </q-item>
                      </q-list>
                    </q-expansion-item>
                  </q-list>
                </q-menu>
              </q-input>

              <!-- Posiciones favoritas (cancha interactiva) -->
              <div>
                <div class="row items-center q-mb-xs">
                  <q-icon name="sports_soccer" class="q-mr-sm text-grey-7" />
                  <span class="text-body2 text-grey-8">
                    Posiciones favoritas
                    <span class="text-caption text-grey-6">
                      (hasta {{ MAX_FAVORITE_POSITIONS }})
                    </span>
                  </span>
                </div>
                <PitchPositionPicker v-model="form.preferredPositions" />
              </div>

              <q-btn
                type="submit"
                label="Guardar cambios"
                color="primary"
                unelevated
                size="lg"
                class="full-width pill-btn"
                icon="save"
                :loading="saving"
              />
            </q-form>
          </q-card-section>
        </q-card>

        <!-- ── Notificaciones ──────────────────────────────────────────────
             Cada categoría se guarda sola al tocarla (sin botón "Guardar"),
             que es lo esperable en un panel de ajustes. Antes no había forma
             de bajarle el volumen a un tipo de aviso: la única opción era
             bloquear las notificaciones del navegador, y eso apagaba TODO,
             incluidos los avisos del propio grupo. -->
        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <div class="text-subtitle2 text-weight-bold q-mb-xs">
              <q-icon name="notifications" class="q-mr-xs text-grey-7" />
              Notificaciones
            </div>
            <div class="text-caption text-grey-7 q-mb-sm">
              Elegí qué avisos querés recibir. Se guardan solos.
            </div>

            <q-list separator>
              <q-item v-for="opt in NOTIFICATION_OPTIONS" :key="opt.key" tag="label" v-ripple>
                <q-item-section>
                  <q-item-label>{{ opt.label }}</q-item-label>
                  <q-item-label caption>{{ opt.description }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-toggle
                    :model-value="notificationPrefs[opt.key]"
                    color="primary"
                    :disable="savingPrefs"
                    @update:model-value="(val) => handleTogglePref(opt.key, val)"
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>

      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useQuasar } from 'quasar'
import { doc, getDoc } from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuth } from 'src/composables/useAuth'
import { useGroups } from 'src/composables/useGroups'
import { useProfile } from 'src/composables/useProfile'
import { useMundial, PHASE_ORDER, PHASE_LABELS } from 'src/composables/useMundial'
import { useAuthStore, ROLE_LABELS, ROLE_COLORS } from 'src/stores/auth.store'
import PitchPositionPicker from 'src/components/PitchPositionPicker.vue'
import MundialCoinFlipDialog from 'src/components/MundialCoinFlipDialog.vue'
import { positionLabel, normalizePositions, MAX_FAVORITE_POSITIONS } from 'src/utils/positions'
import { TEAM_OPTIONS as ALL_TEAM_OPTIONS, LEAGUE_BADGES, findTeam } from 'src/utils/teams'
import { NOTIFICATION_OPTIONS, withNotificationDefaults } from 'src/utils/notifications'

const $q = useQuasar()
const { user, updateUserProfile, updateNotificationPref, uploadProfilePhoto } = useAuth()

// Preferencias de notificación (toggles que se guardan solos, ver más abajo)
const notificationPrefs = ref(withNotificationDefaults(null))
const savingPrefs = ref(false)

// ── Foto de perfil ──────────────────────────────────────────────────────────
const photoInput = ref(null)
const photoFile = ref(null)
const uploadingPhoto = ref(false)

async function handlePhotoSelected(file) {
  if (!file) return
  uploadingPhoto.value = true
  try {
    await uploadProfilePhoto(file)
    $q.notify({ type: 'positive', icon: 'photo_camera', message: 'Foto actualizada' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    uploadingPhoto.value = false
    photoFile.value = null
  }
}
const { getMyGroups } = useGroups()
const { fetchMyDescriptionStars } = useProfile()
const { getMyMundial, activateMundial } = useMundial()
const authStore = useAuthStore()

const descriptionStars = ref({ avg: 0, count: 0 })

const FOOT_OPTIONS = [
  { label: 'Derecho', value: 'derecho' },
  { label: 'Izquierdo', value: 'izquierdo' },
  { label: 'Ambidiestro', value: 'ambidiestro' },
]

function footLabel(value) {
  return FOOT_OPTIONS.find((f) => f.value === value)?.label ?? value
}

const roleBadgeLabel = computed(() => ROLE_LABELS[authStore.role] ?? 'Jugador')
const roleBadgeColor = computed(() => ROLE_COLORS[authStore.role] ?? 'green-8')

// Posiciones favoritas ya guardadas (ordenadas por zona de cancha)
const favoritePositions = computed(() => normalizePositions(user.value?.preferredPositions))

// ── Stats globales ───────────────────────────────────────────────────────────
const globalStatCards = computed(() => {
  const s = user.value?.stats ?? {}
  return [
    { label: 'Goles', value: s.goals ?? 0, icon: 'sports_soccer', color: 'green-8' },
    { label: 'Asist.', value: s.assists ?? 0, icon: 'assistant', color: 'blue-8' },
    { label: 'Partidos', value: s.matchesPlayed ?? 0, icon: 'event_available', color: 'grey-7' },
    { label: 'MVPs', value: s.mvps ?? 0, icon: 'military_tech', color: 'amber-8' },
  ]
})

// Récord ganados/empatados/perdidos y efectividad (3 pts victoria, 1 empate)
const record = computed(() => {
  const s = user.value?.stats ?? {}
  return { wins: s.wins ?? 0, draws: s.draws ?? 0, losses: s.losses ?? 0 }
})
const winRate = computed(() => {
  const { wins, draws, losses } = record.value
  const played = wins + draws + losses
  if (played === 0) return 0
  return Math.round(((wins * 3 + draws) / (played * 3)) * 100)
})

// ── Stats por grupo (con nombre del grupo) ───────────────────────────────────
const myGroups = ref([])

const groupStatRows = computed(() => {
  const byGroup = user.value?.statsByGroup ?? {}
  return Object.entries(byGroup).map(([groupId, stats]) => ({
    groupId,
    groupName: myGroups.value.find((g) => g.id === groupId)?.name ?? 'Grupo',
    stats: stats ?? {},
  }))
})

// ── Mi Mundial ────────────────────────────────────────────────────────────
const mundial = ref({
  active: false,
  phase: null,
  groupMatchResults: [],
  pendingCoinFlip: null,
  titles: 0,
  lastResult: null,
})
const mundialLoading = ref(false)
const showCoinFlip = ref(false)

// Ícono por fase del stepper — la final se muestra directo con emoji_events
// (Copa) en el template, acá van las intermedias.
function stepIconFor(phase) {
  return phase === 'groups' ? 'table_chart' : 'sports_soccer'
}

async function refreshMundial() {
  mundial.value = await getMyMundial()
}

async function handleActivateMundial() {
  mundialLoading.value = true
  try {
    await activateMundial()
    await refreshMundial()
    $q.notify({ type: 'positive', icon: 'emoji_events', message: '¡Tu Mundial arrancó!' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    mundialLoading.value = false
  }
}

async function handleCoinFlipResolved() {
  await refreshMundial()
}

// ── Formulario de edición ────────────────────────────────────────────────────
const saving = ref(false)
const form = ref({
  nickname: '',
  description: '',
  preferredFoot: null,
  preferredPositions: [],
  favoriteTeam: null,
})

// ── Equipo del que sos hincha: un campo único, menú en cascada (liga → equipo) ──
const LEAGUE_OPTIONS = [
  { label: 'Primera División', value: 'A' },
  { label: 'Primera Nacional', value: 'B' },
]

function teamsInLeague(league) {
  return ALL_TEAM_OPTIONS.filter((t) => t.league === league)
}

const selectedFavoriteTeam = computed(() => findTeam(form.value.favoriteTeam))
const profileFavoriteTeam = computed(() => findTeam(user.value?.favoriteTeam))

onMounted(async () => {
  // Refresca el perfil desde Firestore: las stats las actualiza la Cloud
  // Function y lo que hay en el store es del momento del login (queda viejo)
  try {
    const uid = user.value?.uid
    if (uid) {
      const snap = await getDoc(doc(db, 'users', uid))
      if (snap.exists()) {
        const data = snap.data()
        authStore.patchUser({
          nickname: data.nickname ?? null,
          description: data.description ?? '',
          preferredFoot: data.preferredFoot ?? null,
          preferredPositions: data.preferredPositions ?? [],
          favoriteTeam: data.favoriteTeam ?? null,
          notificationPrefs: withNotificationDefaults(data.notificationPrefs),
          stats: data.stats ?? {},
          statsByGroup: data.statsByGroup ?? {},
        })
      }
    }
  } catch {
    // sin conexión se muestran los datos del store
  }

  notificationPrefs.value = withNotificationDefaults(user.value?.notificationPrefs)

  form.value = {
    nickname: user.value?.nickname ?? '',
    description: user.value?.description ?? '',
    preferredFoot: user.value?.preferredFoot ?? null,
    preferredPositions: normalizePositions(user.value?.preferredPositions),
    favoriteTeam: user.value?.favoriteTeam ?? null,
  }
  try {
    myGroups.value = await getMyGroups()
  } catch {
    myGroups.value = []
  }

  descriptionStars.value = await fetchMyDescriptionStars()

  try {
    await refreshMundial()
  } catch {
    // sin conexión se muestra el estado inicial (sin Mundial activo)
  }
})

async function handleSave() {
  saving.value = true
  try {
    const descriptionChanged = form.value.description !== (user.value?.description ?? '')
    await updateUserProfile(form.value)
    // La Cloud Function resetea las calificaciones cuando cambia la descripción;
    // se refleja acá al toque en vez de esperar a recargar la página.
    if (descriptionChanged) {
      descriptionStars.value = { avg: 0, count: 0 }
    }
    $q.notify({ type: 'positive', icon: 'check_circle', message: 'Perfil actualizado.' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    saving.value = false
  }
}

// ── Notificaciones ──────────────────────────────────────────────────────────
// Optimista: el toggle se mueve al instante y se revierte si la escritura
// falla, para que no quede la sensación de que el control no responde.
async function handleTogglePref(category, value) {
  const previous = notificationPrefs.value[category]
  notificationPrefs.value = { ...notificationPrefs.value, [category]: value }
  savingPrefs.value = true
  try {
    await updateNotificationPref(category, value)
  } catch (err) {
    notificationPrefs.value = { ...notificationPrefs.value, [category]: previous }
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    savingPrefs.value = false
  }
}
</script>

<style scoped>
/* Stepper del Mundial personal: compacto, sin la sombra de tab que trae
   Quasar por defecto, y la Copa (paso final) destacada en dorado. */
.mundial-stepper {
  background: transparent;
}

.mundial-stepper :deep(.q-stepper__header) {
  box-shadow: none;
  flex-wrap: wrap;
}

.mundial-stepper :deep(.q-stepper__tab) {
  padding: 8px 6px;
}

.mundial-stepper :deep(.q-stepper__title) {
  font-size: 0.7rem;
}

.mundial-stepper :deep(.q-step:last-child .q-icon) {
  color: #f9a825;
}

/* Ícono de la copa: la imagen fuente trae fondo blanco cuadrado, se recorta
   en círculo con leve resplandor dorado para que combine con el tema oscuro
   en vez de verse como un recuadro claro pegado. */
.mundial-trophy-icon {
  width: 24px;
  height: 24px;
  object-fit: cover;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(249, 168, 37, 0.35);
}

.mundial-trophy-icon--lg {
  width: 72px;
  height: 72px;
  box-shadow: 0 0 0 3px rgba(249, 168, 37, 0.45), 0 4px 16px rgba(249, 168, 37, 0.3);
  margin-bottom: 6px;
}
</style>
