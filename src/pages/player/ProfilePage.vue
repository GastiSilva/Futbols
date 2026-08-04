<template>
  <q-page padding class="bg-grey-1">
    <div class="row justify-center">
      <div class="col-12 col-md-8 col-lg-6">

        <!-- ── Cabecera del perfil ─────────────────────────────────────── -->
        <q-card flat bordered class="q-mb-md">
          <q-card-section class="grass-bg text-white column items-center q-gutter-sm">
            <q-avatar size="88px" class="shadow-4">
              <img
                :src="user?.photoURL ?? 'icons/icon-128x128.png'"
                :alt="user?.displayName ?? 'usuario'"
                referrerpolicy="no-referrer"
              />
            </q-avatar>
            <div class="column items-center">
              <div class="text-h6 text-weight-bold">{{ user?.nickname || user?.displayName }}</div>
              <div class="text-caption text-green-2">{{ user?.email }}</div>
            </div>
            <div class="row q-gutter-xs">
              <q-badge :color="roleBadgeColor" text-color="white" :label="roleBadgeLabel" class="q-px-sm" />
              <q-badge
                v-if="user?.preferredFoot"
                color="blue-8"
                text-color="white"
                :label="footLabel(user.preferredFoot)"
                class="q-px-sm"
              />
            </div>
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
import { useAuthStore, ROLE_LABELS, ROLE_COLORS } from 'src/stores/auth.store'
import PitchPositionPicker from 'src/components/PitchPositionPicker.vue'
import { positionLabel, normalizePositions, MAX_FAVORITE_POSITIONS } from 'src/utils/positions'

const $q = useQuasar()
const { user, updateUserProfile } = useAuth()
const { getMyGroups } = useGroups()
const { fetchMyDescriptionStars } = useProfile()
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

// ── Formulario de edición ────────────────────────────────────────────────────
const saving = ref(false)
const form = ref({
  nickname: '',
  description: '',
  preferredFoot: null,
  preferredPositions: [],
})

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
          stats: data.stats ?? {},
          statsByGroup: data.statsByGroup ?? {},
        })
      }
    }
  } catch {
    // sin conexión se muestran los datos del store
  }

  form.value = {
    nickname: user.value?.nickname ?? '',
    description: user.value?.description ?? '',
    preferredFoot: user.value?.preferredFoot ?? null,
    preferredPositions: normalizePositions(user.value?.preferredPositions),
  }
  try {
    myGroups.value = await getMyGroups()
  } catch {
    myGroups.value = []
  }

  descriptionStars.value = await fetchMyDescriptionStars()
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
</script>
