<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-md">
      <q-icon name="emoji_events" color="amber-7" class="q-mr-sm" />
      Estadísticas
    </div>

    <!-- Filtro por grupo (obligatorio: sin grupo no hay ranking que mostrar) -->
    <q-select
      v-model="selectedGroup"
      :options="groupOptions"
      option-label="name"
      option-value="id"
      emit-value
      map-options
      label="Elegí un grupo *"
      hint="El ranking se calcula por grupo"
      outlined
      dense
      class="q-mb-md"
      style="max-width: 320px"
      :rules="[v => !!v || 'Tenés que elegir un grupo']"
      @update:model-value="onGroupChange"
    >
      <template #prepend>
        <q-icon name="group" />
      </template>
    </q-select>

    <!-- Sin grupo seleccionado todavía -->
    <div v-if="!selectedGroup" class="column items-center q-mt-xl text-grey-5 q-gutter-sm">
      <q-icon name="emoji_events" size="64px" />
      <div class="text-h6">Elegí un grupo para ver el ranking</div>
      <div class="text-body2">Cada grupo tiene sus propias estadísticas</div>
    </div>

    <template v-else>
      <q-tabs v-model="tab" align="left" active-color="green-8" indicator-color="green-8">
        <q-tab name="goals" label="Goleadores" icon="sports_soccer" />
        <q-tab name="assists" label="Asistidores" icon="assistant" />
        <q-tab name="mvps" label="MVPs" icon="military_tech" />
        <q-tab name="murallas" label="Murallas" icon="shield" />
        <q-tab name="mundial" label="Mundial" icon="emoji_events" />
      </q-tabs>

      <q-separator />

      <!-- Loading grupo -->
      <div v-if="loadingGroup" class="row justify-center q-mt-lg">
        <q-spinner-dots color="green-9" size="40px" />
      </div>

      <q-tab-panels v-else v-model="tab" animated>
      <!-- ── Goleadores ──────────────────────────────────────────────── -->
      <q-tab-panel name="goals" class="q-pa-none">
        <q-list separator>
          <q-item v-if="activeScorers.length === 0" class="text-grey-6 text-center q-pa-lg">
            <q-item-section>Sin datos</q-item-section>
          </q-item>
          <q-item
            v-for="(player, idx) in activeScorers"
            :key="player.id"
            :class="idx < 3 ? 'bg-amber-1' : ''"
          >
            <q-item-section avatar>
              <q-avatar
                :color="medalColor(idx)"
                text-color="white"
                size="36px"
                font-size="16px"
              >
                {{ idx < 3 ? ['🥇', '🥈', '🥉'][idx] : idx + 1 }}
              </q-avatar>
            </q-item-section>

            <q-item-section avatar>
              <q-avatar size="40px">
                <img :src="player.photoURL" :alt="player.displayName" referrerpolicy="no-referrer" />
              </q-avatar>
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-weight-bold">{{ player.displayName }}</q-item-label>
              <q-item-label caption>{{ player.stats?.matchesPlayed ?? 0 }} partidos</q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="column items-end">
                <span class="text-h6 text-weight-bold text-green-8">
                  {{ player.stats?.goals ?? 0 }}
                </span>
                <span class="text-caption text-grey-6">goles</span>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <!-- ── Asistidores ─────────────────────────────────────────────── -->
      <q-tab-panel name="assists" class="q-pa-none">
        <q-list separator>
          <q-item v-if="activeAssisters.length === 0" class="text-grey-6 text-center q-pa-lg">
            <q-item-section>Sin datos</q-item-section>
          </q-item>
          <q-item
            v-for="(player, idx) in activeAssisters"
            :key="player.id"
            :class="idx < 3 ? 'bg-blue-1' : ''"
          >
            <q-item-section avatar>
              <q-avatar
                :color="medalColor(idx)"
                text-color="white"
                size="36px"
                font-size="16px"
              >
                {{ idx < 3 ? ['🥇', '🥈', '🥉'][idx] : idx + 1 }}
              </q-avatar>
            </q-item-section>

            <q-item-section avatar>
              <q-avatar size="40px">
                <img :src="player.photoURL" :alt="player.displayName" referrerpolicy="no-referrer" />
              </q-avatar>
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-weight-bold">{{ player.displayName }}</q-item-label>
              <q-item-label caption>{{ player.stats?.matchesPlayed ?? 0 }} partidos</q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="column items-end">
                <span class="text-h6 text-weight-bold text-blue-8">
                  {{ player.stats?.assists ?? 0 }}
                </span>
                <span class="text-caption text-grey-6">asistencias</span>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <!-- ── MVPs ────────────────────────────────────────────────────── -->
      <q-tab-panel name="mvps" class="q-pa-none">
        <q-list separator>
          <q-item v-if="activeMvps.length === 0" class="text-grey-6 text-center q-pa-lg">
            <q-item-section>Sin datos</q-item-section>
          </q-item>
          <q-item
            v-for="(player, idx) in activeMvps"
            :key="player.id"
            :class="idx < 3 ? 'bg-orange-1' : ''"
          >
            <q-item-section avatar>
              <q-avatar
                :color="medalColor(idx)"
                text-color="white"
                size="36px"
                font-size="16px"
              >
                {{ idx < 3 ? ['🥇', '🥈', '🥉'][idx] : idx + 1 }}
              </q-avatar>
            </q-item-section>

            <q-item-section avatar>
              <q-avatar size="40px">
                <img :src="player.photoURL" :alt="player.displayName" referrerpolicy="no-referrer" />
              </q-avatar>
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-weight-bold">{{ player.displayName }}</q-item-label>
              <q-item-label caption>{{ player.stats?.matchesPlayed ?? 0 }} partidos</q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="column items-end">
                <span class="text-h6 text-weight-bold text-amber-8">
                  {{ player.stats?.mvps ?? 0 }}
                </span>
                <span class="text-caption text-grey-6">MVPs</span>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <!-- ── Murallas ────────────────────────────────────────────────── -->
      <q-tab-panel name="murallas" class="q-pa-none">
        <q-list separator>
          <q-item v-if="activeMurallas.length === 0" class="text-grey-6 text-center q-pa-lg">
            <q-item-section>Sin datos</q-item-section>
          </q-item>
          <q-item
            v-for="(player, idx) in activeMurallas"
            :key="player.id"
            :class="idx < 3 ? 'bg-blue-1' : ''"
          >
            <q-item-section avatar>
              <q-avatar
                :color="medalColor(idx)"
                text-color="white"
                size="36px"
                font-size="16px"
              >
                {{ idx < 3 ? ['🥇', '🥈', '🥉'][idx] : idx + 1 }}
              </q-avatar>
            </q-item-section>

            <q-item-section avatar>
              <q-avatar size="40px">
                <img :src="player.photoURL" :alt="player.displayName" referrerpolicy="no-referrer" />
              </q-avatar>
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-weight-bold">{{ player.displayName }}</q-item-label>
              <q-item-label caption>{{ player.stats?.matchesPlayed ?? 0 }} partidos</q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="column items-end">
                <span class="text-h6 text-weight-bold text-blue-8">
                  {{ player.stats?.murallas ?? 0 }}
                </span>
                <span class="text-caption text-grey-6">Murallas</span>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <!-- ── Mundial ─────────────────────────────────────────────────── -->
      <q-tab-panel name="mundial" class="q-pa-none">
        <q-list separator>
          <q-item v-if="groupMembers.length === 0" class="text-grey-6 text-center q-pa-lg">
            <q-item-section>Sin datos</q-item-section>
          </q-item>
          <q-item v-for="member in mundialRanking" :key="member.userId">
            <q-item-section avatar>
              <q-avatar size="40px">
                <img :src="member.photoURL" :alt="member.displayName" referrerpolicy="no-referrer" />
              </q-avatar>
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-weight-bold">{{ member.displayName }}</q-item-label>
              <q-item-label caption>{{ mundialStatusLabel(member.mundial) }}</q-item-label>
            </q-item-section>

            <q-item-section v-if="member.mundial?.titles" side>
              <q-badge color="amber-8" text-color="white">
                🏆 {{ member.mundial.titles }}
              </q-badge>
            </q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>
      </q-tab-panels>
    </template>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useLeaderboard } from 'src/composables/useLeaderboard'
import { useGroups } from 'src/composables/useGroups'
import { PHASE_ORDER, PHASE_LABELS } from 'src/composables/useMundial'

const tab = ref('goals')
const selectedGroup = ref(null)
const groupOptions = ref([])
const groupMembers = ref([])

const {
  groupScorers: activeScorers,
  groupAssisters: activeAssisters,
  groupMvps: activeMvps,
  groupMurallas: activeMurallas,
  loadingGroup,
  fetchGroupRanking,
  clearGroupRanking,
} = useLeaderboard()

const { getMyGroups, getGroupMembers } = useGroups()

onMounted(async () => {
  try {
    groupOptions.value = await getMyGroups()
  } catch {
    groupOptions.value = []
  }
})

async function onGroupChange(groupId) {
  if (!groupId) {
    clearGroupRanking()
    groupMembers.value = []
    return
  }
  try {
    const members = await getGroupMembers(groupId)
    groupMembers.value = members
    const memberIds = members.map((m) => m.userId)
    await fetchGroupRanking(memberIds, groupId)
  } catch {
    clearGroupRanking()
    groupMembers.value = []
  }
}

function medalColor(idx) {
  return ['amber-7', 'grey-6', 'brown-4'][idx] ?? 'grey-4'
}

// Activos primero (ordenados por fase más avanzada), después el resto (por
// títulos ganados) — así se ve arriba quién está más lejos en su Mundial.
const mundialRanking = computed(() => {
  const rank = (m) => (m?.active ? PHASE_ORDER.indexOf(m.phase) : -1)
  return [...groupMembers.value].sort((a, b) => {
    const activeDiff = rank(b.mundial) - rank(a.mundial)
    if (activeDiff !== 0) return activeDiff
    return (b.mundial?.titles ?? 0) - (a.mundial?.titles ?? 0)
  })
})

function mundialStatusLabel(mundial) {
  if (!mundial?.active) return 'Sin Mundial activo'
  return `Activo — ${PHASE_LABELS[mundial.phase] ?? mundial.phase}`
}
</script>
