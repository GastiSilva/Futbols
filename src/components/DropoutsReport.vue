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
      <div class="row items-center q-gutter-sm">
        <!-- Solo con 2+ grupos: con uno solo no hay nada que filtrar. -->
        <q-select
          v-if="groupOptions.length > 2"
          v-model="groupId"
          :options="groupOptions"
          dense
          outlined
          options-dense
          emit-value
          map-options
          style="min-width: 170px"
        />
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
      </div>
    </q-card-section>

    <q-separator />

    <div v-if="loading" class="row justify-center q-pa-md">
      <q-spinner-dots color="red-7" size="32px" />
    </div>
    <div v-else-if="summary.length === 0" class="text-grey-6 text-center q-pa-md">
      {{ groupId ? 'Nadie se bajó en este grupo en este período.' : 'Nadie se bajó en este período.' }}
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
              <q-item-label caption>
                {{ formatDate(r.matchDate) }}
                <!-- Sin filtro, de qué grupo es cada baja: dos grupos pueden
                     tener un partido con el mismo nombre el mismo día. -->
                <span v-if="!groupId && groupLabel(r.groupId)"> · {{ groupLabel(r.groupId) }}</span>
              </q-item-label>
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
import { errorMessage } from 'src/utils/errors'

const $q = useQuasar()
const { loading, fetchDropouts, fetchGroupNames } = useDropouts()

const days = ref(30)
const groupId = ref(null)   // null = todos los grupos
const rows = ref([])
const summary = computed(() => summarizeDropouts(rows.value))

// Nombres de grupo ya resueltos (id → nombre). Se acumulan: al pasar de 30 a
// 90 días aparecen grupos nuevos y los ya conocidos no se vuelven a pedir.
const groupNames = ref({})

// Opciones del selector: solo los grupos que TIENEN bajas en lo ya cargado —
// un listado de todos los grupos del sistema sería mayormente inútil acá.
const groupOptions = computed(() => [
  { label: 'Todos los grupos', value: null },
  ...Object.keys(groupNames.value)
    .map((id) => ({ label: groupLabel(id), value: id }))
    .sort((a, b) => a.label.localeCompare(b.label)),
])

function groupLabel(id) {
  if (!id || !(id in groupNames.value)) return ''   // todavía sin resolver
  // Un grupo borrado deja sus bajas huérfanas (queda en null): se nombra para
  // no mostrar un id crudo, y se puede seguir filtrando por él.
  return groupNames.value[id] ?? 'Grupo borrado'
}

watch(
  [days, groupId],
  async ([d, gid]) => {
    try {
      rows.value = await fetchDropouts(d, gid)
      // Los nombres se resuelven solo mirando TODOS los grupos: ahí está la
      // lista completa de los que tienen bajas. Filtrando por uno, las filas
      // son todas de ese grupo y no aportan ids nuevos.
      if (!gid) {
        const unknown = rows.value
          .map((r) => r.groupId)
          .filter((id) => id && !(id in groupNames.value))
        if (unknown.length > 0) {
          groupNames.value = { ...groupNames.value, ...await fetchGroupNames(unknown) }
        }
      }
    } catch (err) {
      rows.value = []
      $q.notify({ type: 'negative', message: errorMessage(err) })
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
