<template>
  <!-- MVP ya decidido (votación cerrada) -->
  <div v-if="match.mvpVotingClosed" class="q-mt-sm">
    <q-chip v-if="match.mvpName" color="amber-8" text-color="white" icon="military_tech">
      MVP: {{ match.mvpName }}
    </q-chip>
    <div v-else class="text-caption text-grey-6">Empate en la votación — sin MVP</div>
  </div>

  <!-- Votación de MVP abierta -->
  <div v-else class="q-mt-md text-left">
    <q-separator class="q-mb-md" />
    <div class="text-overline text-amber-9 text-weight-bold q-mb-sm text-center">
      <q-icon name="military_tech" class="q-mr-xs" />Votá al MVP
    </div>

    <div v-if="myMvpVote" class="text-center text-body2 text-grey-7 q-mb-sm">
      Ya votaste a <b>{{ candidateName(myMvpVote) }}</b> — podés cambiar tu voto.
    </div>

    <q-list separator dense>
      <q-item
        v-for="c in mvpCandidates"
        :key="c.userId"
        clickable
        @click="handleVote(c.userId)"
      >
        <q-item-section>{{ c.displayName }}</q-item-section>
        <q-item-section side>
          <span class="text-caption text-grey-6">{{ mvpTally.get(c.userId) ?? 0 }} votos</span>
        </q-item-section>
        <q-item-section side v-if="myMvpVote === c.userId">
          <q-icon name="check_circle" color="amber-8" />
        </q-item-section>
      </q-item>
    </q-list>
    <div v-if="mvpCandidates.length === 0" class="text-caption text-grey-5 text-center q-py-sm">
      No hay candidatos para votar.
    </div>

    <q-btn
      v-if="canCloseVoting"
      flat
      dense
      color="amber-9"
      label="Cerrar votación"
      icon="how_to_vote"
      class="full-width q-mt-sm"
      :loading="votingLoading"
      @click="handleCloseVoting"
    />
  </div>
</template>

<script setup>
// ─────────────────────────────────────────────────────────────────────────────
// Votación de MVP de un partido terminado.
//
// Extraído de MatchDetailPage, que concentraba clima, calendario, equipos,
// sede, resultado, goleadores y esta votación en un solo archivo (la comunidad
// menos cohesionada de todo el proyecto). El bloque se trae su propio estado:
// la página madre solo le pasa el partido y quién puede cerrar la votación.
// ─────────────────────────────────────────────────────────────────────────────
import { ref, computed, watch, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import { useMvpVoting } from 'src/composables/useMvpVoting'
import { useAuthStore } from 'src/stores/auth.store'

const props = defineProps({
  match: { type: Object, required: true },
  matchId: { type: String, required: true },
  // Estadísticas del partido: de ahí salen los candidatos (los invitados sin
  // cuenta no tienen userId, así que quedan afuera solos).
  playerStats: { type: Array, default: () => [] },
  // Solo quien puede cargar el resultado puede cerrar la votación a mano.
  canCloseVoting: { type: Boolean, default: false },
})

const $q = useQuasar()
const authStore = useAuthStore()
const { castVote, getMyVote, subscribeToVotes, closeMvpVoting } = useMvpVoting()

const myMvpVote = ref(null)
const mvpTally = ref(new Map())
const votingLoading = ref(false)
let stopVotesListener = null

// Nadie se vota a sí mismo (las reglas de Firestore también lo prohíben).
const mvpCandidates = computed(() =>
  props.playerStats.filter((p) => p.userId && p.userId !== authStore.user?.uid),
)

function candidateName(userId) {
  return props.playerStats.find((p) => p.userId === userId)?.displayName ?? 'alguien'
}

watch(
  () => [props.match?.status, props.match?.mvpVotingClosed],
  ([status, votingClosed]) => {
    stopVotesListener?.()
    stopVotesListener = null
    if (status !== 'finished' || votingClosed) return

    stopVotesListener = subscribeToVotes(props.matchId, ({ tally }) => {
      mvpTally.value = tally
    })
    getMyVote(props.matchId).then((v) => { myMvpVote.value = v })
  },
  { immediate: true },
)
onUnmounted(() => stopVotesListener?.())

// Voto optimista: se pinta al instante y se revierte si el servidor lo rechaza.
async function handleVote(votedForUserId) {
  const prev = myMvpVote.value
  myMvpVote.value = votedForUserId
  try {
    await castVote(props.matchId, votedForUserId)
  } catch (err) {
    myMvpVote.value = prev
    $q.notify({ type: 'negative', message: err.message })
  }
}

async function handleCloseVoting() {
  votingLoading.value = true
  try {
    const result = await closeMvpVoting(props.matchId)
    $q.notify({
      type: 'positive',
      icon: 'military_tech',
      message: result.winnerName ? `MVP: ${result.winnerName}` : 'Votación cerrada — empate, sin MVP',
    })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    votingLoading.value = false
  }
}
</script>
