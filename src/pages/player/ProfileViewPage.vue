<template>
  <q-page padding class="bg-grey-1">
    <div class="row justify-center">
      <div class="col-12 col-md-8 col-lg-6">

        <q-banner v-if="loadError" class="bg-negative text-white q-mb-md" rounded>
          {{ loadError }}
        </q-banner>

        <template v-else-if="profile">
          <!-- ── Cabecera del perfil ─────────────────────────────────────── -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section class="grass-bg text-white column items-center q-gutter-sm">
              <q-avatar size="88px" class="shadow-4">
                <img
                  :src="profile.photoURL ?? '/icons/icon-128x128.png'"
                  :alt="profile.displayName ?? 'usuario'"
                  referrerpolicy="no-referrer"
                />
              </q-avatar>
              <div class="column items-center">
                <div class="text-h6 text-weight-bold">{{ profile.nickname || profile.displayName }}</div>
              </div>
              <div class="row q-gutter-xs" v-if="profile.preferredFoot">
                <q-badge
                  color="blue-8"
                  text-color="white"
                  :label="footLabel(profile.preferredFoot)"
                  class="q-px-sm"
                />
              </div>
              <!-- Equipo del que es hincha (escudo + nombre) -->
              <div v-if="favoriteTeam" class="row items-center justify-center q-gutter-xs">
                <img
                  :src="favoriteTeam.badge"
                  :alt="favoriteTeam.label"
                  style="width: 22px; height: 22px; object-fit: contain"
                />
                <span class="text-body2 text-weight-medium">
                  Hincha de {{ favoriteTeam.label }}
                </span>
              </div>
              <div v-if="profile.description" class="text-body2 text-center q-px-md" style="opacity: 0.9">
                {{ profile.description }}
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

          <!-- ── Calificar la descripción (en privado) ────────────────────── -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle2 text-weight-bold q-mb-xs">
                <q-icon name="visibility_off" class="q-mr-xs text-grey-7" />
                ¿La descripción es real?
              </div>
              <div class="text-caption text-grey-7 q-mb-sm">
                Tu calificación es privada — ni {{ profile.nickname || profile.displayName }} ni nadie más ve quién
                puso qué.
              </div>
              <q-rating
                v-model="myRating"
                size="2em"
                color="amber-8"
                icon="star_border"
                icon-selected="star"
                :max="5"
                @update:model-value="handleRate"
              />
              <div class="text-caption text-grey-6 q-mt-xs">
                {{ myRating ? `Calificaste: ${myRating}/5` : 'Todavía no calificaste' }}
              </div>
            </q-card-section>
          </q-card>

          <!-- ── Estadísticas globales ───────────────────────────────────── -->
          <div class="text-overline text-green-9 text-weight-bold q-mb-sm">
            ESTADÍSTICAS (TOTALES)
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
        </template>

        <div v-else class="text-center q-pa-xl">
          <q-spinner color="primary" size="40px" />
        </div>

      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useProfile } from 'src/composables/useProfile'
import { useGroups } from 'src/composables/useGroups'
import { useAuthStore } from 'src/stores/auth.store'
import { positionLabel, normalizePositions } from 'src/utils/positions'
import { findTeam } from 'src/utils/teams'

const route = useRoute()
const router = useRouter()
const $q = useQuasar()
const authStore = useAuthStore()

const { fetchProfile, fetchMyRatingFor, rateDescription } = useProfile()
const { getGroup } = useGroups()

const FOOT_OPTIONS = [
  { label: 'Derecho', value: 'derecho' },
  { label: 'Izquierdo', value: 'izquierdo' },
  { label: 'Ambidiestro', value: 'ambidiestro' },
]

function footLabel(value) {
  return FOOT_OPTIONS.find((f) => f.value === value)?.label ?? value
}

const profile = ref(null)
const loadError = ref(null)
const myRating = ref(0)
const groupNames = ref({})

const favoritePositions = computed(() => normalizePositions(profile.value?.preferredPositions))
const favoriteTeam = computed(() => findTeam(profile.value?.favoriteTeam))

const globalStatCards = computed(() => {
  const s = profile.value?.stats ?? {}
  return [
    { label: 'Goles', value: s.goals ?? 0, icon: 'sports_soccer', color: 'green-8' },
    { label: 'Asist.', value: s.assists ?? 0, icon: 'assistant', color: 'blue-8' },
    { label: 'Partidos', value: s.matchesPlayed ?? 0, icon: 'event_available', color: 'grey-7' },
    { label: 'MVPs', value: s.mvps ?? 0, icon: 'military_tech', color: 'amber-8' },
  ]
})

const record = computed(() => {
  const s = profile.value?.stats ?? {}
  return { wins: s.wins ?? 0, draws: s.draws ?? 0, losses: s.losses ?? 0 }
})
const winRate = computed(() => {
  const { wins, draws, losses } = record.value
  const played = wins + draws + losses
  if (played === 0) return 0
  return Math.round(((wins * 3 + draws) / (played * 3)) * 100)
})

const groupStatRows = computed(() => {
  const byGroup = profile.value?.statsByGroup ?? {}
  return Object.entries(byGroup).map(([groupId, stats]) => ({
    groupId,
    groupName: groupNames.value[groupId] ?? 'Grupo',
    stats: stats ?? {},
  }))
})

async function loadProfile(uid) {
  profile.value = null
  loadError.value = null
  myRating.value = 0

  // El perfil propio se edita en /perfil, no tiene sentido "verse" acá
  if (uid === authStore.user?.uid) {
    router.replace({ name: 'profile' })
    return
  }

  try {
    profile.value = await fetchProfile(uid)
    myRating.value = (await fetchMyRatingFor(uid)) ?? 0

    const groupIds = Object.keys(profile.value.statsByGroup ?? {})
    const entries = await Promise.all(
      groupIds.map(async (gid) => {
        try {
          const g = await getGroup(gid)
          return [gid, g?.name ?? 'Grupo']
        } catch {
          return [gid, 'Grupo']
        }
      }),
    )
    groupNames.value = Object.fromEntries(entries)
  } catch (err) {
    loadError.value = err.message
  }
}

async function handleRate(stars) {
  const prev = myRating.value
  try {
    await rateDescription(route.params.uid, stars)
    $q.notify({ type: 'positive', icon: 'star', message: 'Calificación guardada.', timeout: 1500 })
  } catch (err) {
    myRating.value = prev
    $q.notify({ type: 'negative', message: err.message })
  }
}

onMounted(() => loadProfile(route.params.uid))
watch(() => route.params.uid, (uid) => uid && loadProfile(uid))
</script>
