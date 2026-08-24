<!-- src/components/MyApplicationsCard.vue
     ─────────────────────────────────────────────────────────────────────────
     "Mis postulaciones": estado de tus postulaciones a partidos públicos,
     independiente de si esos partidos siguen listados en "Partidos abiertos".

     Por qué existe como componente aparte: apenas el organizador te acepta (o
     rechaza), el partido suele despublicarse o llenarse — desaparece de
     "Partidos abiertos" y con él se perdía la única card donde veías tu
     propio estado. Este componente se monta también en el Dashboard
     ("Partidos"), que es donde alguien de afuera del grupo esperaría poder
     seguir el resultado de su postulación sin tener que volver a esa otra
     pantalla.
-->
<template>
  <q-card v-if="rows.length > 0" flat bordered class="q-mb-md">
    <q-card-section class="q-pb-none">
      <div class="text-subtitle2 text-weight-bold">
        <q-icon name="pending_actions" class="q-mr-xs text-primary" />
        Mis postulaciones
      </div>
    </q-card-section>
    <q-list separator class="q-mt-sm">
      <q-item v-for="row in rows" :key="row.id + row.matchId">
        <q-item-section>
          <q-item-label class="text-weight-medium">
            {{ row.match?.title ?? 'Partido' }}
          </q-item-label>
          <q-item-label caption v-if="row.match?.date">
            {{ qdate.formatDate(row.match.date.toDate(), 'dddd D/M · HH:mm') }}
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-chip
            dense
            square
            :color="statusMeta(row.status).color"
            text-color="white"
            :icon="statusMeta(row.status).icon"
            :label="statusMeta(row.status).label"
          />
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>

<script setup>
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { date as qdate, useQuasar } from 'quasar'
import { useMatch } from 'src/composables/useMatch'
import { useApplications } from 'src/composables/useApplications'
import { useAuthStore } from 'src/stores/auth.store'

const $q = useQuasar()
const authStore = useAuthStore()

const { matches, subscribeToUpcoming, stopListening } = useMatch()
const {
  myApplications,
  subscribeToMyApplications,
  stopListening: stopApplications,
  error: applicationsError,
} = useApplications()

// Las `applications` nunca se borran (quedan como registro histórico, ver
// firestore.rules), pero el PARTIDO sí puede borrarlo el organizador. Sin
// filtrar por `match`, una postulación aceptada a un partido ya borrado
// quedaba mostrándose para siempre como "Partido" sin nombre — el dato no
// estaba desactualizado, el partido al que apuntaba ya no existía.
const rows = computed(() =>
  myApplications.value
    .filter((a) => a.status !== 'withdrawn')
    .map((a) => ({
      ...a,
      match: matches.value.find((m) => m.id === a.matchId) ?? null,
    }))
    .filter((row) => row.match !== null)
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
    .reverse(),
)

function statusMeta(status) {
  if (status === 'accepted') return { color: 'positive', icon: 'check_circle', label: '¡Te sumaron!' }
  if (status === 'rejected') return { color: 'grey-6', icon: 'cancel', label: 'No fuiste elegido' }
  return { color: 'orange-8', icon: 'hourglass_top', label: 'Esperando respuesta' }
}

// Un onSnapshot que muere por permission-denied no relanza excepción — deja
// el estado congelado en el último dato válido sin avisar a nadie. Se avisa
// explícito para no repetir el bug de "esperando respuesta" pegado para
// siempre sin ninguna pista de qué pasó.
watch(applicationsError, (msg) => {
  if (msg) $q.notify({ type: 'negative', message: `No se pudo actualizar tus postulaciones: ${msg}` })
})

onMounted(() => {
  if (authStore.isGuest) return
  subscribeToMyApplications()
  subscribeToUpcoming()
})

onUnmounted(() => {
  stopApplications()
  stopListening()
})
</script>
