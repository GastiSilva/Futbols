<template>
  <q-page padding>
    <!-- Loading -->
    <div v-if="loading" class="row justify-center q-mt-xl">
      <q-spinner-dots color="green-9" size="48px" />
    </div>

    <!-- No encontrado -->
    <div v-else-if="!match" class="text-center q-mt-xl text-grey-6">
      <q-icon name="sports_soccer" size="72px" class="q-mb-md" />
      <div class="text-h6">Partido no encontrado</div>
      <q-btn flat color="green-9" label="Volver" icon="arrow_back" class="q-mt-md" @click="$router.back()" />
    </div>

    <!-- Detalle del partido -->
    <template v-else>
      <div class="row items-center q-mb-md no-wrap">
        <q-btn flat round icon="arrow_back" @click="$router.back()" />
        <div class="col q-ml-sm">
          <div class="text-h5 text-weight-bold ellipsis">{{ match.title }}</div>
          <div class="text-caption text-grey-6">
            <q-icon name="place" size="xs" class="q-mr-xs" />{{ match.location }}
          </div>
        </div>
        <q-chip
          dense
          :color="statusColor"
          text-color="white"
          :label="statusLabel"
        />
      </div>

      <!-- Info -->
      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <div class="row q-col-gutter-md text-center">
            <div class="col-4">
              <q-icon name="calendar_today" color="green-9" size="26px" />
              <div class="text-caption text-grey-6 q-mt-xs">Fecha</div>
              <div class="text-body2 text-weight-medium">{{ matchDate }}</div>
            </div>
            <div class="col-4">
              <q-icon name="schedule" color="green-9" size="26px" />
              <div class="text-caption text-grey-6 q-mt-xs">Hora</div>
              <div class="text-body2 text-weight-medium">{{ matchTime }}</div>
            </div>
            <div class="col-4">
              <q-icon name="sports_soccer" color="green-9" size="26px" />
              <div class="text-caption text-grey-6 q-mt-xs">Formato</div>
              <div class="text-body2 text-weight-medium">{{ match.format }}</div>
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Cupos -->
      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <div class="row justify-between items-center q-mb-xs">
            <span class="text-caption text-grey-6">Cupos</span>
            <span class="text-caption text-weight-bold">
              {{ match.currentPlayers }} / {{ match.maxPlayers }}
            </span>
          </div>
          <q-linear-progress
            :value="match.currentPlayers / match.maxPlayers"
            color="green-9"
            track-color="grey-3"
            rounded
            size="8px"
          />
        </q-card-section>
      </q-card>

      <!-- Resultado (si finalizado) -->
      <q-card v-if="match.status === 'finished' && match.scoreA != null" flat bordered class="q-mb-md bg-green-1">
        <q-card-section class="text-center">
          <div class="text-overline text-grey-6">Resultado final</div>
          <div class="text-h3 text-weight-bold text-green-9">
            {{ match.scoreA }} — {{ match.scoreB }}
          </div>
        </q-card-section>
      </q-card>

      <!-- Cargar / editar resultado (miembros del grupo o admin) -->
      <q-btn
        v-if="canLoadResult"
        unelevated
        color="orange-7"
        class="full-width pill-btn q-mt-sm"
        icon="scoreboard"
        :label="match.status === 'finished' ? 'Editar resultado' : 'Cargar resultado'"
        :to="{ name: 'post-match', params: { id: match.id } }"
      />
    </template>
  </q-page>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { date } from 'quasar'
import { useMatch, getEffectiveStatus } from 'src/composables/useMatch'
import { useGroups } from 'src/composables/useGroups'
import { useAuthStore } from 'src/stores/auth.store'

const route = useRoute()
const { currentMatch: match, loading, subscribeToMatch, stopListening } = useMatch()
const { getMyRole } = useGroups()
const authStore = useAuthStore()

onMounted(() => subscribeToMatch(route.params.id))
onUnmounted(() => stopListening())

// ── ¿Puede cargar el resultado? (miembro del grupo del partido, o admin) ─────
const myGroupRole = ref(null)
watch(
  () => match.value?.groupId,
  async (gid) => {
    if (!gid) { myGroupRole.value = null; return }
    try { myGroupRole.value = await getMyRole(gid) } catch { myGroupRole.value = null }
  },
  { immediate: true },
)

const canLoadResult = computed(() => {
  const st = getEffectiveStatus(match.value)
  const done = st === 'closed' || st === 'finished'
  return done && (authStore.isAdmin || !!myGroupRole.value)
})

const matchDate = computed(() =>
  match.value?.date ? date.formatDate(match.value.date.toDate(), 'DD/MM/YYYY') : '',
)
const matchTime = computed(() =>
  match.value?.date ? date.formatDate(match.value.date.toDate(), 'HH:mm') : '',
)

const STATUS_MAP = {
  scheduled: { label: 'Programado', color: 'blue-grey-6' },
  open:      { label: 'Abierto',    color: 'green-7' },
  closed:    { label: 'Completo',   color: 'orange-7' },
  finished:  { label: 'Finalizado', color: 'grey-6' },
}
const statusLabel = computed(() => STATUS_MAP[getEffectiveStatus(match.value)]?.label ?? match.value?.status ?? '')
const statusColor = computed(() => STATUS_MAP[getEffectiveStatus(match.value)]?.color ?? 'grey')
</script>
