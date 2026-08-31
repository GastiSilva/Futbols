<template>
  <!-- Muralla ya decidida (votación cerrada) -->
  <div v-if="match.murallaVotingClosed" class="q-mt-sm">
    <q-chip v-if="match.murallaName" color="blue-8" text-color="white" icon="shield">
      Muralla: {{ match.murallaName }}
    </q-chip>
    <div v-else class="text-caption text-grey-6">Empate en la votación — sin Muralla</div>

    <!-- Podio: los tres puestos más votados, no solo el ganador. Reparte el
         reconocimiento de la MISMA votación entre más jugadores; el que salió
         segundo por un voto hoy no se entera de nada. Los empates comparten
         puesto (por eso puede haber dos 🥇 y ningún 🥈). -->
    <q-list v-if="podium.length > 0" dense class="q-mt-sm">
      <q-item v-for="p in podium" :key="p.userId" dense class="q-px-none">
        <q-item-section avatar style="min-width: 34px">
          <span class="text-h6">{{ medalFor(p.place) }}</span>
        </q-item-section>
        <q-item-section>
          <q-item-label class="text-body2">{{ p.displayName }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <span class="text-caption text-grey-6">
            {{ p.votes }} {{ p.votes === 1 ? 'voto' : 'votos' }}
          </span>
        </q-item-section>
      </q-item>
    </q-list>
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

    <!-- Voto secreto: la lista NO muestra cuántos votos lleva cada candidato.
         Ver el parcial condiciona al que todavía no votó (se vota al que ya va
         ganando, o se vota "por lástima" al que va último), y una votación que
         se mira mientras transcurre deja de medir quién jugó mejor. El recuento
         aparece recién al cerrar, y lo hace la CF, no el cliente. -->
    <q-list separator dense>
      <q-item
        v-for="c in murallaCandidates"
        :key="c.userId"
        clickable
        @click="handleVote(c.userId)"
      >
        <q-item-section>{{ c.displayName }}</q-item-section>
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
import { ref, computed, watch } from 'vue'
import { useQuasar } from 'quasar'
import { useMurallaVoting } from 'src/composables/useMurallaVoting'
import { useAuthStore } from 'src/stores/auth.store'
import { buildPodium, PODIUM_MEDALS } from 'src/utils/podium'

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
const { castVote, getMyVote, fetchTally, closeMurallaVoting } = useMurallaVoting()

const myMurallaVote = ref(null)
const votingLoading = ref(false)
// Puestos crudos ({ userId, votes, place }); el nombre se resuelve aparte
// porque playerStats puede llegar DESPUÉS que el podio (son dos cargas
// distintas de la página madre) y si no quedaría clavado en "alguien".
const rawPodium = ref([])

// Nadie se vota a sí mismo (las reglas de Firestore también lo prohíben).
const murallaCandidates = computed(() =>
  props.playerStats.filter((p) => p.userId && p.userId !== authStore.user?.uid),
)

function candidateName(userId) {
  return props.playerStats.find((p) => p.userId === userId)?.displayName ?? 'alguien'
}

const podium = computed(() =>
  rawPodium.value.map((p) => ({ ...p, displayName: candidateName(p.userId) })),
)

function medalFor(place) {
  return PODIUM_MEDALS[place - 1] ?? ''
}

// El podio se arma con los votos ya cerrados. Si la lectura falla (partido
// viejo, permisos, sin votos) simplemente no se muestra: es decorativo, el
// ganador oficial ya viene en el doc del partido.
async function loadPodium() {
  try {
    rawPodium.value = buildPodium(await fetchTally(props.matchId))
  } catch {
    rawPodium.value = []
  }
}

watch(
  () => [props.match?.status, props.match?.murallaVotingClosed],
  ([status, votingClosed]) => {
    myMurallaVote.value = null
    rawPodium.value = []
    if (status !== 'finished') return
    if (votingClosed) {
      loadPodium()
      return
    }
    getMyVote(props.matchId).then((v) => { myMurallaVote.value = v })
  },
  { immediate: true },
)

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
    await loadPodium()
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
