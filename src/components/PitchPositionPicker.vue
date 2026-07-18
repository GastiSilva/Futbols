<template>
  <div class="pitch-picker">
    <svg
      class="pitch-svg"
      viewBox="0 0 100 140"
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="Selector de posiciones en la cancha"
    >
      <!-- Césped -->
      <defs>
        <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2e7d32" />
          <stop offset="100%" stop-color="#1b5e20" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="140" fill="url(#grass)" rx="3" />

      <!-- Franjas de césped -->
      <g fill="#ffffff" opacity="0.04">
        <rect x="0" y="0" width="100" height="17.5" />
        <rect x="0" y="35" width="100" height="17.5" />
        <rect x="0" y="70" width="100" height="17.5" />
        <rect x="0" y="105" width="100" height="17.5" />
      </g>

      <!-- Líneas de la cancha -->
      <g fill="none" stroke="#ffffff" stroke-width="0.6" opacity="0.55">
        <rect x="4" y="4" width="92" height="132" />
        <!-- Mitad de cancha -->
        <line x1="4" y1="70" x2="96" y2="70" />
        <circle cx="50" cy="70" r="11" />
        <circle cx="50" cy="70" r="0.9" fill="#ffffff" stroke="none" />
        <!-- Área propia (abajo) -->
        <rect x="24" y="118" width="52" height="18" />
        <rect x="38" y="130" width="24" height="6" />
        <!-- Área rival (arriba) -->
        <rect x="24" y="4" width="52" height="18" />
        <rect x="38" y="4" width="24" height="6" />
      </g>

      <!-- Posiciones -->
      <g
        v-for="pos in positions"
        :key="pos.code"
        :class="['pos-node', { selected: isSelected(pos.code), disabled: isDisabled(pos.code) }]"
        :transform="`translate(${pos.x}, ${pos.y})`"
        @click="toggle(pos.code)"
      >
        <title>{{ pos.label }}</title>
        <circle class="pos-halo" r="6.5" />
        <circle class="pos-dot" r="5" />
        <text class="pos-text" text-anchor="middle" dominant-baseline="central">
          {{ pos.short }}
        </text>
      </g>
    </svg>

    <div v-if="!readonly" class="pitch-hint">
      {{ modelValue.length }}/{{ max }} · tocá dónde te gusta jugar
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { PITCH_POSITIONS, MAX_FAVORITE_POSITIONS } from 'src/utils/positions'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  max: { type: Number, default: MAX_FAVORITE_POSITIONS },
  readonly: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

// En modo lectura solo se muestran las posiciones elegidas.
const positions = computed(() =>
  props.readonly
    ? PITCH_POSITIONS.filter((p) => props.modelValue.includes(p.code))
    : PITCH_POSITIONS,
)

function isSelected(code) {
  return props.modelValue.includes(code)
}

// Se deshabilita elegir más cuando se alcanzó el máximo (salvo las ya elegidas).
function isDisabled(code) {
  return !props.readonly && !isSelected(code) && props.modelValue.length >= props.max
}

function toggle(code) {
  if (props.readonly) return
  const current = props.modelValue
  if (current.includes(code)) {
    emit(
      'update:modelValue',
      current.filter((c) => c !== code),
    )
    return
  }
  if (current.length >= props.max) return
  // Mantiene el orden natural de la cancha
  const next = PITCH_POSITIONS.filter(
    (p) => current.includes(p.code) || p.code === code,
  ).map((p) => p.code)
  emit('update:modelValue', next)
}
</script>

<style scoped>
.pitch-picker {
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
}
.pitch-svg {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 6px;
}
.pos-node {
  cursor: pointer;
}
.pos-node.disabled {
  cursor: not-allowed;
}
.pos-halo {
  fill: #000000;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.pos-dot {
  fill: rgba(255, 255, 255, 0.18);
  stroke: rgba(255, 255, 255, 0.65);
  stroke-width: 0.5;
  transition:
    fill 0.15s ease,
    stroke 0.15s ease;
}
.pos-text {
  fill: #ffffff;
  font-size: 3px;
  font-weight: 700;
  pointer-events: none;
  user-select: none;
}
.pos-node.selected .pos-dot {
  fill: #ffb300;
  stroke: #ffffff;
  stroke-width: 0.7;
}
.pos-node.selected .pos-halo {
  opacity: 0.18;
}
.pos-node.selected .pos-text {
  fill: #1b1b1b;
}
.pos-node.disabled .pos-dot {
  opacity: 0.35;
}
.pitch-hint {
  text-align: center;
  font-size: 0.72rem;
  color: #9e9e9e;
  margin-top: 6px;
}

/* Feedback táctil / hover solo cuando se puede seleccionar */
@media (hover: hover) {
  .pos-node:not(.disabled):not(.selected):hover .pos-dot {
    fill: rgba(255, 255, 255, 0.32);
  }
}
</style>
