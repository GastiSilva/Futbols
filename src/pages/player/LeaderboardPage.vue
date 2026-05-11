<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-md">
      <q-icon name="emoji_events" color="amber-7" class="q-mr-sm" />
      Ranking
    </div>

    <!-- Filtro por grupo -->
    <q-select
      v-model="selectedGroup"
      :options="groupOptions"
      option-label="name"
      option-value="id"
      emit-value
      map-options
      label="Filtrar por grupo"
      outlined
      dense
      clearable
      class="q-mb-md"
      style="max-width: 320px"
      @update:model-value="onGroupChange"
    >
      <template #prepend>
        <q-icon name="group" />
      </template>
      <template #selected-item="scope">
        <span>{{ scope.opt.name ?? 'General' }}</span>
      </template>
    </q-select>

    <q-tabs v-model="tab" align="left" active-color="green-8" indicator-color="green-8">
      <q-tab name="goals" label="Goleadores" icon="sports_soccer" />
      <q-tab name="assists" label="Asistidores" icon="assistant" />
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
    </q-tab-panels>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useLeaderboard } from 'src/composables/useLeaderboard'
import { useGroups } from 'src/composables/useGroups'

const tab = ref('goals')
const selectedGroup = ref(null)
const groupOptions = ref([])

const {
  scorers, assisters,
  groupScorers, groupAssisters, loadingGroup,
  subscribeScorers, subscribeAssisters,
  fetchGroupRanking, clearGroupRanking,
  stopListening,
} = useLeaderboard()

const { getMyGroups, getGroupMembers } = useGroups()

const activeScorers = computed(() => selectedGroup.value ? groupScorers.value : scorers.value)
const activeAssisters = computed(() => selectedGroup.value ? groupAssisters.value : assisters.value)

onMounted(async () => {
  subscribeScorers(30)
  subscribeAssisters(30)
  try {
    groupOptions.value = await getMyGroups()
  } catch {
    groupOptions.value = []
  }
})

onUnmounted(() => stopListening())

async function onGroupChange(groupId) {
  if (!groupId) {
    clearGroupRanking()
    return
  }
  try {
    const members = await getGroupMembers(groupId)
    const memberIds = members.map((m) => m.userId)
    await fetchGroupRanking(memberIds)
  } catch {
    clearGroupRanking()
  }
}

function medalColor(idx) {
  return ['amber-7', 'grey-6', 'brown-4'][idx] ?? 'grey-4'
}
</script>
