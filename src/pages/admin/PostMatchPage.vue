<template>
  <q-page padding>
    <div class="row justify-center">
      <div class="col-12 col-md-9 col-lg-8">

        <!-- Header -->
        <div class="text-h5 text-weight-bold q-mb-xs">
          <q-icon name="scoreboard" color="green-8" class="q-mr-sm" />
          Resultado del partido
        </div>
        <div v-if="match" class="text-subtitle2 text-grey-7 q-mb-lg">
          {{ match.title }} — {{ formatDate(match.date) }}
        </div>

        <q-skeleton v-if="loadingMatch" type="rect" height="200px" />

        <template v-else-if="match">
          <!-- ── Marcador ──────────────────────────────────────────────── -->
          <q-card flat bordered class="q-mb-lg">
            <q-card-section>
              <div class="text-subtitle1 text-weight-bold q-mb-md">Marcador final</div>
              <div class="row q-col-gutter-md">
                <div class="col-6">
                  <q-input
                    v-model.number="scoreA"
                    type="number"
                    min="0"
                    label="Goles Equipo A"
                    outlined
                    :rules="[v => v >= 0 || 'Valor inválido']"
                  />
                </div>
                <div class="col-6">
                  <q-input
                    v-model.number="scoreB"
                    type="number"
                    min="0"
                    label="Goles Equipo B"
                    outlined
                    :rules="[v => v >= 0 || 'Valor inválido']"
                  />
                </div>
              </div>
            </q-card-section>
          </q-card>

          <!-- ── Estadísticas individuales ─────────────────────────────── -->
          <q-card flat bordered class="q-mb-lg">
            <q-card-section>
              <div class="text-subtitle1 text-weight-bold q-mb-md">
                Estadísticas individuales
              </div>

              <div
                v-for="player in playerRows"
                :key="player.userId"
                class="row items-center q-col-gutter-sm q-mb-sm"
              >
                <!-- Avatar + nombre -->
                <div class="col-12 col-sm-4 row items-center no-wrap">
                  <q-avatar size="32px" class="q-mr-sm">
                    <img :src="player.photoURL" :alt="player.displayName" />
                  </q-avatar>
                  <span class="text-body2 ellipsis">{{ player.displayName }}</span>
                </div>

                <!-- Equipo -->
                <div class="col-4 col-sm-2">
                  <q-select
                    v-model="player.team"
                    :options="['A', 'B']"
                    label="Equipo"
                    outlined
                    dense
                  />
                </div>

                <!-- Goles -->
                <div class="col-4 col-sm-3">
                  <q-input
                    v-model.number="player.goals"
                    type="number"
                    min="0"
                    label="Goles"
                    outlined
                    dense
                  />
                </div>

                <!-- Asistencias -->
                <div class="col-4 col-sm-3">
                  <q-input
                    v-model.number="player.assists"
                    type="number"
                    min="0"
                    label="Asistencias"
                    outlined
                    dense
                  />
                </div>
              </div>
            </q-card-section>
          </q-card>

          <!-- ── Guardar ───────────────────────────────────────────────── -->
          <q-btn
            label="Guardar resultado"
            color="green-8"
            unelevated
            size="lg"
            class="full-width"
            icon="save"
            :loading="saving"
            @click="handleSave"
          />
        </template>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar, date } from 'quasar'
import { useMatch } from 'src/composables/useMatch'
import { usePlayerStats } from 'src/composables/usePlayerStats'
import { collection, getDocs } from 'firebase/firestore'
import { db } from 'src/services/firebase'

const route = useRoute()
const router = useRouter()
const $q = useQuasar()
const matchId = route.params.id

const { fetchMatch, saveMatchResult } = useMatch()
const { savePlayerStats } = usePlayerStats()

const match = ref(null)
const loadingMatch = ref(true)
const saving = ref(false)
const scoreA = ref(0)
const scoreB = ref(0)
const playerRows = ref([])

onMounted(async () => {
  try {
    match.value = await fetchMatch(matchId)

    // Si ya tiene resultado, pre-rellena
    if (match.value.scoreA != null) scoreA.value = match.value.scoreA
    if (match.value.scoreB != null) scoreB.value = match.value.scoreB

    // Carga la lista de inscriptos para cargar las stats individuales
    const snap = await getDocs(collection(db, 'matches', matchId, 'registrations'))
    playerRows.value = snap.docs
      .filter((d) => !d.data().isOnWaitlist)
      .map((d) => ({
        userId: d.data().userId,
        displayName: d.data().displayName,
        photoURL: d.data().photoURL,
        team: d.data().team ?? 'A',
        goals: 0,
        assists: 0,
      }))
  } finally {
    loadingMatch.value = false
  }
})

async function handleSave() {
  saving.value = true
  try {
    await saveMatchResult(matchId, { scoreA: scoreA.value, scoreB: scoreB.value })
    await savePlayerStats(matchId, playerRows.value, match.value.groupId ?? null)

    $q.notify({ type: 'positive', message: 'Resultado guardado correctamente.' })
    router.push({ name: 'admin-dashboard' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    saving.value = false
  }
}

function formatDate(ts) {
  return ts ? date.formatDate(ts.toDate(), 'DD/MM/YYYY HH:mm') : ''
}
</script>
