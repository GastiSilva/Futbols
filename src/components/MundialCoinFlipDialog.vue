<!-- src/components/MundialCoinFlipDialog.vue -->
<!--
  Sorteo en vivo del Mundial personal: se abre cuando el jugador tiene un
  pendingCoinFlip sin resolver. El resultado YA fue decidido y congelado
  server-side (mundial-rules.js) — esta animación no decide nada, solo lo
  revela con suspenso. Al montar, llama revealCoinFlip() (Cloud Function) y
  recién cuando responde arranca la secuencia: gira ~2.5s, después muestra
  la cara ganadora.
-->
<template>
  <q-dialog v-model="open" persistent @hide="onHide">
    <q-card style="min-width: 300px; max-width: 380px; width: 100%" class="text-center">
      <q-card-section class="grass-bg text-white">
        <div class="text-h6 text-weight-bold">🪙 Sorteo del Mundial</div>
        <div class="text-caption text-green-2 q-mt-xs">
          {{ kindLabel }}
        </div>
      </q-card-section>

      <q-card-section class="q-py-lg column items-center q-gutter-md">
        <div class="coin-stage">
          <div class="coin" :class="{ spinning: phase !== 'result', landed: phase === 'result' }">
            <div class="coin-face coin-front">⚽</div>
            <div class="coin-face coin-back">🏆</div>
          </div>
        </div>

        <div v-if="phase === 'spinning' || phase === 'waiting'" class="text-body2 text-grey-7">
          Girando la moneda...
        </div>

        <div v-else-if="phase === 'result'" class="column items-center q-gutter-xs">
          <div
            class="text-h6 text-weight-bold"
            :class="result?.outcome === 'advance' ? 'text-green-8' : 'text-red-7'"
          >
            {{ result?.outcome === 'advance' ? '¡Pasaste de fase!' : 'Quedaste eliminado' }}
          </div>
          <div class="text-caption text-grey-6">
            {{ resultDescription }}
          </div>
        </div>

        <div v-else-if="phase === 'error'" class="text-body2 text-red-7">
          {{ errorMessage }}
        </div>
      </q-card-section>

      <q-card-actions v-if="phase === 'result' || phase === 'error'" align="right">
        <q-btn flat color="primary" label="Cerrar" @click="close" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useMundial } from 'src/composables/useMundial'
import { PHASE_LABELS } from 'src/composables/useMundial'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  kind: { type: String, default: null }, // 'groups_4pts' | 'knockout_draw'
})

const emit = defineEmits(['update:modelValue', 'resolved'])

const { revealCoinFlip } = useMundial()

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

// 'waiting' (esperando respuesta del server) → 'spinning' (animación mínima)
// → 'result' | 'error'
const phase = ref('waiting')
const result = ref(null)
const errorMessage = ref('')

const SPIN_MIN_DURATION_MS = 2500

const kindLabel = computed(() =>
  props.kind === 'knockout_draw'
    ? 'Empataste el partido de eliminación directa'
    : 'Terminaste la fase de grupos con 4 puntos',
)

const resultDescription = computed(() => {
  if (!result.value) return ''
  if (result.value.outcome === 'eliminate') {
    return 'Tu Mundial personal terminó acá. Podés arrancar uno nuevo cuando quieras.'
  }
  const label = PHASE_LABELS[result.value.nextPhase] ?? PHASE_LABELS[result.value.type] ?? ''
  return result.value.type === 'champion'
    ? '¡Sos el campeón de tu Mundial!'
    : label
      ? `Ahora estás en ${label}.`
      : ''
})

async function startFlip() {
  phase.value = 'waiting'
  result.value = null
  errorMessage.value = ''

  const started = Date.now()
  try {
    const data = await revealCoinFlip()
    phase.value = 'spinning'
    const elapsed = Date.now() - started
    const remaining = Math.max(SPIN_MIN_DURATION_MS - elapsed, 800)
    setTimeout(() => {
      result.value = data
      phase.value = 'result'
    }, remaining)
  } catch (err) {
    phase.value = 'error'
    errorMessage.value = err.message || 'No se pudo resolver el sorteo.'
  }
}

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) startFlip()
  },
  { immediate: true },
)

function close() {
  open.value = false
}

function onHide() {
  if (phase.value === 'result') emit('resolved', result.value)
}
</script>

<style scoped>
.coin-stage {
  perspective: 600px;
  width: 96px;
  height: 96px;
}

.coin {
  width: 96px;
  height: 96px;
  position: relative;
  transform-style: preserve-3d;
  transform: rotateY(0deg);
}

.coin.spinning {
  animation: coin-spin 0.6s linear infinite;
}

.coin.landed {
  animation: coin-land 0.5s ease-out forwards;
}

.coin-face {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  backface-visibility: hidden;
  box-shadow: inset 0 0 0 4px rgba(255, 255, 255, 0.6), 0 2px 8px rgba(0, 0, 0, 0.25);
  background: linear-gradient(145deg, #ffd54f, #f9a825);
}

.coin-back {
  transform: rotateY(180deg);
}

@keyframes coin-spin {
  from { transform: rotateY(0deg); }
  to { transform: rotateY(360deg); }
}

@keyframes coin-land {
  from { transform: rotateY(0deg); }
  to { transform: rotateY(1080deg); }
}
</style>
