<template>
  <!-- Muralla ya decidida (votación cerrada) -->
  <div v-if="match.murallaVotingClosed" class="q-mt-sm">
    <q-chip v-if="match.murallaName" color="blue-8" text-color="white" icon="shield">
      Muralla: {{ match.murallaName }}
    </q-chip>
    <div v-else class="text-caption text-grey-6">Empate en la votación — sin Muralla</div>
  </div>

  <!-- Votación de Muralla abierta -->
  <div v-else class="q-mt-md text-left">
    <q-separator class="q-mb-md" />
    <div class="text-overline text-blue-9 text-weight-bold q-mb-sm text-center">
      <q-icon name="shield" class="q-mr-xs" />Votá a la Muralla
    </div>

    <div v-if="myMurallaVote" class="text-center text-body2 text-grey-7 q-mb-sm">
      Ya votaste a <b>{{ candidateName(myMurallaVote) }}</b> — podés cambiar tu voto.
    </div>

    <q-list separator dense>
      <q-item
        v-for="c in murallaCandidates"
        :key="c.userId"
        clickable
        @click="handleVote(c.userId)"
      >
        <q-item-section>{{ c.displayName }}</q-item-section>
        <q-item-section side>
          <span class="text-caption text-grey-6">{{ murallaTally.get(c.userId) ?? 0 }} votos</span>
        </q-item-section>
        <q-item-section side v-if="myMurallaVote === c.userId">
          <q-icon name="check_circle" color="blue-8" />
        </q-item-section>
      </q-item>
    </q-list>
    <div v-if="murallaCandidates.length === 0" class="text-caption text-grey-5 text-center q-py-sm">
      No hay candidatos para votar.
    </div>

    <q-btn
      v-if="canCloseVoting"
      flat
      dense
      color="blue-9"
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
// Votación de Muralla (mejor defensor) de un partido terminado. Clon 1:1 de
// MatchMvpVoting.vue en mecánica — es la misma idea (votar sin autovoto,
// cerrar server-side) aplicada a otra categoría — pero en una colección y
// campos separados porque son votaciones INDEPENDIENTES entre sí.
// ─────────────────────────────────────────────────────────────────────────────
import { ref, computed, watch, onUnmounted } from 'vue'
import { useQuasar } from 'quasar'
import { useMurallaVoting } from 'src/composables/useMurallaVoting'
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
const { castVote, getMyVote, subscribeToVotes, closeMurallaVoting } = useMurallaVoting()

const myMurallaVote = ref(null)
const murallaTally = ref(new Map())
const votingLoading = ref(false)
let stopVotesListener = null

// Nadie se vota a sí mismo (las reglas de Firestore también lo prohíben).
const murallaCandidates = computed(() =>
  props.playerStats.filter((p) => p.userId && p.userId !== authStore.user?.uid),
)

function candidateName(userId) {
  return props.playerStats.find((p) => p.userId === userId)?.displayName ?? 'alguien'
}

watch(
  () => [props.match?.status, props.match?.murallaVotingClosed],
  ([status, votingClosed]) => {
    stopVotesListener?.()
    stopVotesListener = null
    if (status !== 'finished' || votingClosed) return

    stopVotesListener = subscribeToVotes(props.matchId, ({ tally }) => {
      murallaTally.value = tally
    })
    getMyVote(props.matchId).then((v) => { myMurallaVote.value = v })
  },
  { immediate: true },
)
onUnmounted(() => stopVotesListener?.())

// Voto optimista: se pinta al instante y se revierte si el servidor lo rechaza.
async function handleVote(votedForUserId) {
  const prev = myMurallaVote.value
  myMurallaVote.value = votedForUserId
  try {
    await castVote(props.matchId, votedForUserId)
  } catch (err) {
    myMurallaVote.value = prev
    $q.notify({ type: 'negative', message: err.message })
  }
}

async function handleCloseVoting() {
  votingLoading.value = true
  try {
    const result = await closeMurallaVoting(props.matchId)
    $q.notify({
      type: 'positive',
      icon: 'shield',
      message: result.winnerName ? `Muralla: ${result.winnerName}` : 'Votación cerrada — empate, sin Muralla',
    })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    votingLoading.value = false
  }
}
</script>
