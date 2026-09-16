<template>
  <q-card flat bordered>
    <q-card-section class="row items-center justify-between q-gutter-sm">
      <div>
        <div class="text-subtitle1 text-weight-bold">
          <q-icon name="event_busy" color="red-7" class="q-mr-xs" />
          Bajas
        </div>
        <div class="text-caption text-grey-6">
          Quiénes se anotan y después no están. "Tarde" = titular que se bajó con menos de
          {{ LATE_DROPOUT_HOURS }}hs o no vino y jugó otro en su lugar.
        </div>
      </div>
      <q-btn-toggle
        v-model="days"
        dense
        unelevated
        no-caps
        toggle-color="red-7"
        :options="[
          { label: '30 días', value: 30 },
          { label: '90 días', value: 90 },
        ]"
      />
    </q-card-section>

    <q-separator />

    <div v-if="loading" class="row justify-center q-pa-md">
      <q-spinner-dots color="red-7" size="32px" />
    </div>
    <div v-else-if="summary.length === 0" class="text-grey-6 text-center q-pa-md">
      Nadie se bajó en este período.
    </div>

    <q-list v-else separator>
      <q-expansion-item v-for="u in summary" :key="u.userId" dense>
        <template #header>
          <q-item-section>
            <q-item-label class="text-weight-bold">{{ u.displayName }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="row q-gutter-xs">
              <q-badge color="grey-6" :label="`${u.total} ${u.total === 1 ? 'baja' : 'bajas'}`" />
              <q-badge v-if="u.late > 0" color="orange-8" :label="`${u.late} tarde`" />
              <q-badge v-if="u.replaced > 0" color="red-7" :label="`${u.replaced} no vino`" />
            </div>
          </q-item-section>
        </template>

        <q-list dense class="q-pl-md">
          <q-item v-for="r in u.rows" :key="r.id">
            <q-item-section>
              <q-item-label>{{ r.matchTitle || 'Partido' }}</q-item-label>
              <q-item-label caption>{{ formatDate(r.matchDate) }}</q-item-label>
            </q-item-section>
            <q-item-section side class="text-right">
              <q-item-label caption>{{ describeRow(r) }}</q-item-label>
              <q-item-label v-if="r.wasStarter === false" caption class="text-grey-5">era suplente</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-expansion-item>
    </q-list>
  </q-card>
</template>

<script setup>
// Panel de bajas para el admin global. Solo muestra: no sanciona a nadie.
// Las filas las escriben las CF (ver useDropouts.js).
import { computed, ref, watch } from 'vue'
import { date, useQuasar } from 'quasar'
import { useDropouts, summarizeDropouts, LATE_DROPOUT_HOURS } from 'src/composables/useDropouts'

const $q = useQuasar()
const { loading, fetchDropouts } = useDropouts()

const days = ref(30)
const rows = ref([])
const summary = computed(() => summarizeDropouts(rows.value))

watch(
  days,
  async (d) => {
    try {
      rows.value = await fetchDropouts(d)
    } catch (err) {
      rows.value = []
      $q.notify({ type: 'negative', message: err.message })
    }
  },
  { immediate: true },
)

function formatDate(ts) {
  return ts?.toDate ? date.formatDate(ts.toDate(), 'DD/MM HH:mm') : ''
}

function describeRow(r) {
  if (r.kind === 'replaced') return r.replacedBy ? `No vino — jugó ${r.replacedBy}` : 'No vino'
  const h = r.hoursBeforeMatch
  if (h == null) return 'Se bajó'
  if (h < 0) return 'Se bajó después del horario'
  if (h < 1) return `Se bajó ${Math.max(1, Math.round(h * 60))} min antes`
  if (h < 48) return `Se bajó ${Math.round(h)}hs antes`
  return `Se bajó ${Math.round(h / 24)} días antes`
}
</script>
