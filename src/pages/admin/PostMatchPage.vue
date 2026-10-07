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
              <div class="text-caption text-grey-6 q-mb-md">
                Los equipos ya se definieron antes de jugar (o podés ajustarlos acá si hizo falta un cambio de último momento).
                Los goles de los invitados cuentan para el partido, pero no suman a ningún perfil.
              </div>

              <div
                v-for="player in playerRows"
                :key="player.key"
                class="row items-center q-col-gutter-sm q-mb-sm"
              >
                <!-- Avatar + nombre -->
                <div class="col-12 col-sm-4 row items-center no-wrap">
                  <q-avatar size="32px" class="q-mr-sm" :color="player.isGuest ? 'grey-4' : undefined">
                    <q-icon v-if="player.isGuest" name="person" color="grey-7" />
                    <img v-else :src="player.photoURL" :alt="player.displayName" />
                  </q-avatar>
                  <span class="text-body2 ellipsis">{{ player.displayName }}</span>
                  <q-badge v-if="player.isGuest" color="grey-5" label="Invitado" class="q-ml-sm" />
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
import { errorMessage } from 'src/utils/errors'

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

    // Carga la lista de inscriptos titulares. Los invitados sin cuenta (userId
    // null) entran también: sus goles se guardan en el partido (guestStats), no
    // en un perfil — así el desglose de goleadores suma lo que dice el marcador.
    const snap = await getDocs(collection(db, 'matches', matchId, 'registrations'))
    playerRows.value = snap.docs
      .filter((d) => !d.data().isOnWaitlist && (d.data().userId || d.data().isGuest))
      .map((d) => ({
        key: d.id,
        regId: d.id,
        isGuest: !d.data().userId,
        userId: d.data().userId ?? null,
        displayName: d.data().displayName,
        photoURL: d.data().photoURL,
        team: d.data().team ?? null,
        goals: 0,
        assists: 0,
      }))

    // Si ya había stats cargadas, pre-rellena para poder corregir sin duplicar
    const statsSnap = await getDocs(collection(db, 'matches', matchId, 'playerStats'))
    const byId = new Map(statsSnap.docs.map((d) => [d.id, d.data()]))
    const guestById = new Map((match.value.guestStats ?? []).map((g) => [g.regId, g]))
    playerRows.value = playerRows.value.map((p) => {
      const prev = p.isGuest ? guestById.get(p.regId) : byId.get(p.userId)
      return prev
        ? { ...p, goals: prev.goals ?? 0, assists: prev.assists ?? 0, team: prev.team ?? p.team }
        : p
    })
  } finally {
    loadingMatch.value = false
  }
})

async function handleSave() {
  saving.value = true
  try {
    const guestStats = playerRows.value
      .filter((p) => p.isGuest && ((p.goals || 0) > 0 || (p.assists || 0) > 0))
      .map((p) => ({
        regId: p.regId,
        name: p.displayName,
        team: p.team ?? null,
        goals: p.goals || 0,
        assists: p.assists || 0,
      }))

    await saveMatchResult(
      matchId,
      { scoreA: scoreA.value, scoreB: scoreB.value, guestStats },
      { alreadyFinished: match.value.status === 'finished' },
    )

    // El MVP ya no se fija acá — se decide por votación desde MatchDetailPage
    // una vez finalizado el partido (useMvpVoting + closeMvpVoting).
    await savePlayerStats(matchId, playerRows.value, match.value.groupId ?? null, {
      scoreA: scoreA.value,
      scoreB: scoreB.value,
    })

    $q.notify({ type: 'positive', message: 'Resultado guardado correctamente.' })
    router.push({ name: 'match-detail', params: { id: matchId } })
  } catch (err) {
    $q.notify({ type: 'negative', message: errorMessage(err) })
  } finally {
    saving.value = false
  }
}

function formatDate(ts) {
  return ts ? date.formatDate(ts.toDate(), 'DD/MM/YYYY HH:mm') : ''
}
</script>
