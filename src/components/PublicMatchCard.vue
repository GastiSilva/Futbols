<template>
  <q-card flat bordered class="q-mb-md">
    <q-card-section class="q-pb-sm">
      <div class="row items-start justify-between q-gutter-x-sm">
        <div class="col">
          <div class="text-subtitle1 text-weight-bold">{{ match.title }}</div>
          <div class="text-caption text-grey-7">{{ formattedDate }}</div>
        </div>
        <q-badge
          v-if="spotsLabel"
          color="orange-8"
          text-color="white"
          :label="spotsLabel"
          class="q-px-sm"
        />
      </div>
    </q-card-section>

    <q-card-section class="q-py-none">
      <div class="row items-center q-gutter-x-xs text-body2 q-mb-xs" v-if="match.location">
        <q-icon name="place" size="18px" class="text-grey-7" />
        <span>{{ match.location }}</span>
      </div>
      <div class="row items-center q-gutter-x-xs text-body2">
        <q-icon name="sports_soccer" size="18px" class="text-grey-7" />
        <span>{{ formatLabel }}</span>
        <span class="text-grey-6">·</span>
        <span>{{ match.currentPlayers ?? 0 }}<span v-if="match.maxPlayers">/{{ match.maxPlayers }}</span> anotados</span>
      </div>
    </q-card-section>

    <!-- Ya se postuló: ve el estado y puede retirarse -->
    <q-card-actions v-if="myApplication" align="right" class="q-px-md q-pb-md q-pt-sm">
      <q-chip
        dense
        square
        :color="statusChip.color"
        text-color="white"
        :icon="statusChip.icon"
        :label="statusChip.label"
      />
      <!-- El chat con el organizador se abre apenas te postulás: es donde
           preguntás lo básico antes de que te respondan. -->
      <q-btn
        flat
        dense
        no-caps
        color="primary"
        icon="chat_bubble_outline"
        label="Chat"
        @click="$emit('chat', match)"
      />
      <q-btn
        v-if="myApplication.status === 'pending'"
        flat
        dense
        no-caps
        color="grey-7"
        label="Retirar"
        :loading="loading"
        @click="$emit('withdraw', match.id)"
      />
    </q-card-actions>

    <!-- El CTA principal: full-width, píldora, con el resplandor neón del
         sistema — es la acción que de verdad importa en esta tarjeta, así
         que ocupa el lugar de un botón importante, no uno más al costado. -->
    <q-card-section v-else class="q-pt-sm">
      <q-btn
        unelevated
        no-caps
        color="primary"
        icon="sports_soccer"
        label="¡Me prendo a jugar!"
        class="full-width pill-btn play-cta"
        size="md"
        :loading="loading"
        @click="$emit('apply', match)"
      />
    </q-card-section>
  </q-card>
</template>

<script setup>
// Tarjeta de un partido PÚBLICO (visto por alguien de afuera del grupo).
// Deliberadamente muestra menos que la tarjeta del dashboard: quien todavía no
// fue aceptado ve el partido (cuándo, dónde, qué formato, cuántos faltan) pero
// no la lista de quiénes van — eso es del grupo hasta que lo acepten, y las
// reglas de Firestore lo respaldan (registrations sigue exigiendo membresía).
import { computed } from 'vue'
import { FORMAT_OPTIONS } from 'src/composables/useMatch'

const props = defineProps({
  match: { type: Object, required: true },
  myApplication: { type: Object, default: null },
  loading: { type: Boolean, default: false },
})

defineEmits(['apply', 'withdraw', 'chat'])

const formattedDate = computed(() => {
  const date = props.match.date?.toDate?.()
  if (!date) return 'Fecha a confirmar'
  return date.toLocaleString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
})

const formatLabel = computed(
  () => FORMAT_OPTIONS.find((f) => f.value === props.match.format)?.label ?? props.match.format,
)

const spotsLabel = computed(() => {
  const wanted = props.match.spotsWanted
  if (!wanted) return null
  return wanted === 1 ? 'Falta 1' : `Faltan ${wanted}`
})

const STATUS_CHIPS = {
  pending: { color: 'orange-8', icon: 'hourglass_empty', label: 'Esperando respuesta' },
  accepted: { color: 'positive', icon: 'check_circle', label: '¡Te aceptaron!' },
  rejected: { color: 'grey-6', icon: 'cancel', label: 'No entraste' },
  withdrawn: { color: 'grey-6', icon: 'undo', label: 'Te retiraste' },
}

const statusChip = computed(
  () => STATUS_CHIPS[props.myApplication?.status] ?? STATUS_CHIPS.pending,
)
</script>

<style scoped>
/* CTA principal de la tarjeta: mismo resplandor neón del sistema (ver
   .q-btn--unelevated.bg-primary en app.scss) pero un poco más marcado, y con
   un pulso sutil en el ícono — es el botón que decide si alguien juega hoy o
   no, se lo trata como tal en vez de un botón de card más. */
.play-cta {
  font-weight: 800;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
}

.play-cta :deep(.q-icon) {
  animation: play-cta-pulse 1.8s ease-in-out infinite;
}

@keyframes play-cta-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

@media (prefers-reduced-motion: reduce) {
  .play-cta :deep(.q-icon) {
    animation: none;
  }
}
</style>
