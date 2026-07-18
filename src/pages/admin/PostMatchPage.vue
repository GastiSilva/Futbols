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

          <!-- ── MVP del partido ───────────────────────────────────────── -->
          <q-card flat bordered class="q-mb-lg">
            <q-card-section>
              <div class="text-subtitle1 text-weight-bold q-mb-md">
                <q-icon name="military_tech" color="amber-8" class="q-mr-xs" />
                MVP del partido
              </div>
              <q-select
                v-model="mvpUserId"
                :options="playerRows"
                option-label="displayName"
                option-value="userId"
                emit-value
                map-options
                label="Elegí al mejor jugador (opcional)"
                outlined
                clearable
              >
                <template #prepend>
                  <q-icon name="emoji_events" color="amber-8" />
                </template>
              </q-select>
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

                <!-- Equipo (opcional: los equipos se definen fuera de la app) -->
                <div class="col-4 col-sm-2">
                  <q-select
                    v-model="player.team"
                    :options="['A', 'B']"
                    label="Equipo"
                    outlined
                    dense
                    clearable
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
            color="primary"
            unelevated
            size="lg"
            class="full-width pill-btn"
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
const mvpUserId = ref(null)
const playerRows = ref([])

onMounted(async () => {
  try {
    match.value = await fetchMatch(matchId)

    // Si ya tiene resultado, pre-rellena
    if (match.value.scoreA != null) scoreA.value = match.value.scoreA
    if (match.value.scoreB != null) scoreB.value = match.value.scoreB
    if (match.value.mvpUserId != null) mvpUserId.value = match.value.mvpUserId

    // Carga la lista de inscriptos (titulares con cuenta) para las stats.
    // Los invitados sin cuenta (userId null) no acumulan stats → se excluyen.
    const snap = await getDocs(collection(db, 'matches', matchId, 'registrations'))
    playerRows.value = snap.docs
      .filter((d) => !d.data().isOnWaitlist && d.data().userId)
      .map((d) => ({
        userId: d.data().userId,
        displayName: d.data().displayName,
        photoURL: d.data().photoURL,
        team: d.data().team ?? null,
        goals: 0,
        assists: 0,
      }))

    // Si ya había stats cargadas, pre-rellena para poder corregir sin duplicar
    const statsSnap = await getDocs(collection(db, 'matches', matchId, 'playerStats'))
    if (!statsSnap.empty) {
      const byId = new Map(statsSnap.docs.map((d) => [d.id, d.data()]))
      playerRows.value = playerRows.value.map((p) => {
        const prev = byId.get(p.userId)
        return prev
          ? { ...p, goals: prev.goals ?? 0, assists: prev.assists ?? 0, team: prev.team ?? p.team }
          : p
      })
    }
  } finally {
    loadingMatch.value = false
  }
})

async function handleSave() {
  saving.value = true
  try {
    const mvpPlayer = playerRows.value.find((p) => p.userId === mvpUserId.value) ?? null

    await saveMatchResult(matchId, {
      scoreA: scoreA.value,
      scoreB: scoreB.value,
      mvpUserId: mvpPlayer?.userId ?? null,
      mvpName: mvpPlayer?.displayName ?? null,
    })

    // Marca el flag mvp en cada fila — la CF acumula stats.mvps por diferencia
    const rowsWithMvp = playerRows.value.map((p) => ({
      ...p,
      mvp: p.userId === (mvpPlayer?.userId ?? null),
    }))
    await savePlayerStats(matchId, rowsWithMvp, match.value.groupId ?? null, {
      scoreA: scoreA.value,
      scoreB: scoreB.value,
    })

    $q.notify({ type: 'positive', message: 'Resultado guardado correctamente.' })
    router.push({ name: 'match-detail', params: { id: matchId } })
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
