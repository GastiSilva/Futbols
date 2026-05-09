<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-lg">
      <q-icon name="emoji_events" color="amber-7" class="q-mr-sm" />
      Ranking General
    </div>

    <q-tabs v-model="tab" align="left" active-color="green-8" indicator-color="green-8">
      <q-tab name="goals" label="Goleadores" icon="sports_soccer" />
      <q-tab name="assists" label="Asistidores" icon="assistant" />
    </q-tabs>

    <q-separator />

    <q-tab-panels v-model="tab" animated>
      <!-- ── Goleadores ──────────────────────────────────────────────── -->
      <q-tab-panel name="goals" class="q-pa-none">
        <q-list separator>
          <q-item
            v-for="(player, idx) in scorers"
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
                <img :src="player.photoURL" :alt="player.displayName" />
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
          <q-item
            v-for="(player, idx) in assisters"
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
                <img :src="player.photoURL" :alt="player.displayName" />
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
import { ref, onMounted, onUnmounted } from 'vue'
import { useLeaderboard } from 'src/composables/useLeaderboard'

const tab = ref('goals')
const { scorers, assisters, subscribeScorers, subscribeAssisters, stopListening } = useLeaderboard()

onMounted(() => {
  subscribeScorers(30)
  subscribeAssisters(30)
})
onUnmounted(() => stopListening())

function medalColor(idx) {
  return ['amber-7', 'grey-6', 'brown-4'][idx] ?? 'grey-4'
}
</script>
