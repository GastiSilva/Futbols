<template>
  <q-page padding class="bg-grey-1">
    <div class="row justify-center">
      <div class="col-12 col-md-8 col-lg-6">

        <div class="row items-center q-mb-md q-gutter-sm">
          <q-btn flat round dense icon="arrow_back" @click="router.back()" />
          <div class="text-h6 text-weight-bold">
            <q-icon name="history" class="q-mr-xs" />Partidos terminados
          </div>
        </div>

        <!-- Filtro por fecha: mismo patrón que "Fecha y hora del partido" en
             Crear partido (input readonly + calendario en popup), para que
             el picker se sienta igual en toda la app. -->
        <div class="row q-gutter-sm q-mb-md">
          <q-input
            :model-value="formatDateDisplay(fromDate)"
            label="Desde"
            outlined
            dense
            readonly
            clearable
            class="col"
            @clear="fromDate = null"
          >
            <template #append>
              <q-icon name="event" class="cursor-pointer">
                <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                  <q-date v-model="fromDate" mask="YYYY/MM/DD" today-btn>
                    <div class="row items-center justify-end">
                      <q-btn v-close-popup label="Cerrar" color="primary" flat />
                    </div>
                  </q-date>
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>
          <q-input
            :model-value="formatDateDisplay(toDate)"
            label="Hasta"
            outlined
            dense
            readonly
            clearable
            class="col"
            @clear="toDate = null"
          >
            <template #append>
              <q-icon name="event" class="cursor-pointer">
                <q-popup-proxy cover transition-show="scale" transition-hide="scale">
                  <q-date v-model="toDate" mask="YYYY/MM/DD" today-btn>
                    <div class="row items-center justify-end">
                      <q-btn v-close-popup label="Cerrar" color="primary" flat />
                    </div>
                  </q-date>
                </q-popup-proxy>
              </q-icon>
            </template>
          </q-input>
        </div>

        <div v-if="loading && finishedMatches.length === 0" class="text-center q-pa-xl">
          <q-spinner color="primary" size="40px" />
        </div>

        <q-card v-else-if="filteredMatches.length === 0" flat bordered class="q-pa-lg text-center">
          <q-icon name="history" size="48px" class="text-grey-5 q-mb-sm" />
          <div class="text-body2 text-grey-7">
            {{ finishedMatches.length === 0
              ? 'Todavía no jugaste ningún partido.'
              : 'No hay partidos terminados en ese rango de fechas.' }}
          </div>
        </q-card>

        <q-card
          v-for="match in filteredMatches"
          :key="match.id"
          flat
          bordered
          clickable
          class="q-mb-sm finished-card"
          :to="{ name: 'match-detail', params: { id: match.id } }"
        >
          <q-card-section class="row items-center no-wrap">
            <div class="col">
              <div class="text-subtitle1 text-weight-bold">{{ match.title }}</div>
              <div class="text-caption text-grey-6">{{ formatMatchDate(match.date) }}</div>
            </div>
            <div
              v-if="match.scoreA != null && match.scoreB != null"
              class="text-h5 text-weight-bold text-primary score-display"
            >
              {{ match.scoreA }} - {{ match.scoreB }}
            </div>
            <q-chip
              v-else
              dense
              square
              color="orange-8"
              text-color="white"
              icon="schedule"
              label="Sin cargar"
            />
          </q-card-section>
        </q-card>

      </div>
    </div>
  </q-page>
</template>

<style scoped>
.finished-card {
  transition: border-color 0.15s ease;
}
.finished-card:hover {
  border-color: var(--q-primary);
}
.score-display {
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
}
</style>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { date as qdate } from 'quasar'
import { useMatch } from 'src/composables/useMatch'

const router = useRouter()
const { finishedMatches, loading, subscribeToFinished, stopListeningFinished } = useMatch()

const fromDate = ref(null)
const toDate = ref(null)

function formatMatchDate(dateTimestamp) {
  if (!dateTimestamp) return ''
  return qdate.formatDate(dateTimestamp.toDate(), 'dddd D/M/YYYY')
}

// fromDate/toDate quedan en formato YYYY/MM/DD (el que usa q-date) — se
// parsean a mano en vez de con `new Date()` porque ese formato no es
// universalmente reconocido por el constructor nativo.
function parseFilterDate(value) {
  if (!value) return null
  const [y, m, d] = value.split('/').map(Number)
  return new Date(y, m - 1, d)
}

function formatDateDisplay(value) {
  const d = parseFilterDate(value)
  return d ? qdate.formatDate(d, 'DD/MM/YYYY') : ''
}

const filteredMatches = computed(() => {
  const from = parseFilterDate(fromDate.value)
  const to = parseFilterDate(toDate.value)
  return finishedMatches.value.filter((m) => {
    const ms = m.date?.toMillis?.() ?? 0
    if (from && ms < from.getTime()) return false
    if (to && ms > to.getTime() + 24 * 60 * 60 * 1000 - 1) return false
    return true
  })
})

onMounted(() => subscribeToFinished())
onUnmounted(() => stopListeningFinished())
</script>
