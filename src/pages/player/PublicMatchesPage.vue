<template>
  <q-page padding class="bg-grey-1">
    <div class="row justify-center">
      <div class="col-12 col-md-8 col-lg-6">

        <div class="row items-start justify-between q-mb-md no-wrap q-gutter-x-sm">
          <div class="col">
            <div class="text-h6 text-weight-bold">
              <q-icon name="sports_soccer" class="text-primary q-mr-xs" />Partidos abiertos
            </div>
            <div class="text-caption text-grey-7">
              A otros grupos les faltan jugadores. Postulate y esperá que el
              organizador te sume.
            </div>
          </div>
          <!-- Publicar vive ACÁ y no en el detalle del partido: esta es la
               pantalla que trata de partidos abiertos, así que es donde uno
               espera poder abrir el suyo. -->
          <q-btn
            v-if="!authStore.isGuest"
            unelevated
            no-caps
            dense
            color="primary"
            icon="add_circle"
            label="Publicar partido"
            class="pill-btn"
            @click="openPublishDialog"
          />
        </div>

        <!-- Mis postulaciones: independiente de la lista de abajo a propósito.
             "Partidos abiertos" solo muestra lo publicado ahora mismo, y una
             vez que te aceptan (o rechazan) el partido suele despublicarse o
             llenarse — sin esta sección esa card simplemente desaparecía y
             quedaba la sensación de que nunca pasó nada. También vive en el
             Dashboard ("Partidos"), por eso es un componente aparte. -->
        <MyApplicationsCard />

        <!-- Mis partidos publicados: gestionarlos (ver quién se postuló,
             aceptar/rechazar) vive en MatchDetailPage — acá solo el atajo,
             porque publicar SE DECIDE acá y sin este link había que ir a Mis
             Grupos → el partido para ver el resultado de esa decisión. -->
        <q-card v-if="myPublishedMatches.length > 0" flat bordered class="q-mb-md">
          <q-card-section class="q-pb-none">
            <div class="text-subtitle2 text-weight-bold">
              <q-icon name="travel_explore" class="q-mr-xs text-orange-8" />
              Mis partidos publicados
            </div>
          </q-card-section>
          <q-list separator class="q-mt-sm">
            <q-item
              v-for="m in myPublishedMatches"
              :key="m.id"
              clickable
              :to="{ name: 'match-detail', params: { id: m.id } }"
            >
              <q-item-section>
                <q-item-label class="text-weight-medium">{{ m.title }}</q-item-label>
                <q-item-label caption>
                  {{ m.currentPlayers ?? 0 }}/{{ m.maxPlayers ?? '∞' }} anotados
                  <span v-if="m.spotsWanted"> · buscan {{ m.spotsWanted }}</span>
                </q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-icon name="arrow_forward_ios" size="16px" color="grey-6" />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>

        <!-- Filtro por provincia. Arranca en la última elegida (localStorage):
             quien juega siempre en la misma zona no tiene que re-elegirla.
             `use-input` + filtro local: son 24 provincias fijas, no hace
             falta ir a buscarlas a ningún lado — pero desplegarlas todas de
             una en un dropdown obliga a escanear la lista entera; escribiendo
             "cor" y filtrando a "Córdoba" es más rápido. -->
        <q-select
          v-model="provinciaFilter"
          :options="provinciaOptionsFiltered"
          label="Provincia"
          outlined
          dense
          clearable
          use-input
          emit-value
          map-options
          input-debounce="0"
          class="q-mb-md"
          @filter="filterProvincias"
          @update:model-value="rememberProvincia"
        >
          <template #prepend>
            <q-icon name="place" />
          </template>
        </q-select>

        <!-- Cargando -->
        <div v-if="loading && publicMatches.length === 0" class="text-center q-pa-xl">
          <q-spinner color="primary" size="40px" />
        </div>

        <!-- Vacío: es el estado MÁS probable al principio, así que se explica
             en vez de mostrar una pantalla en blanco. Si hay partidos pero el
             filtro los tapa, se ofrece quitarlo — sin esto parece que no hay
             nada cuando en realidad hay, pero en otra provincia. -->
        <q-card v-else-if="filteredMatches.length === 0" flat bordered class="q-pa-lg text-center">
          <q-icon name="sports_soccer" size="48px" class="text-grey-5 q-mb-sm" />
          <template v-if="provinciaFilter && publicMatches.length > 0">
            <div class="text-subtitle2 text-weight-bold q-mb-xs">
              No hay partidos en {{ provinciaFilter }}
            </div>
            <div class="text-body2 text-grey-7 q-mb-md">
              Hay {{ publicMatches.length }}
              {{ publicMatches.length === 1 ? 'partido abierto' : 'partidos abiertos' }}
              en otras provincias.
            </div>
            <q-btn
              flat
              no-caps
              color="primary"
              label="Ver todos"
              @click="clearProvincia"
            />
          </template>
          <template v-else>
            <div class="text-subtitle2 text-weight-bold q-mb-xs">
              No hay partidos abiertos ahora
            </div>
            <div class="text-body2 text-grey-7">
              Cuando a algún grupo le falten jugadores y publique su partido, va a
              aparecer acá.
            </div>
          </template>
        </q-card>

        <template v-else>
          <PublicMatchCard
            v-for="match in filteredMatches"
            :key="match.id"
            :match="match"
            :my-application="applicationFor(match.id)"
            :loading="applying === match.id"
            @apply="openApplyDialog"
            @withdraw="handleWithdraw"
            @chat="openChat"
          />
        </template>

        <!-- ── Diálogo: publicar un partido propio ─────────────────────────── -->
        <q-dialog v-model="publishDialog">
          <q-card style="min-width: 320px; max-width: 460px">
            <q-card-section class="q-pb-none">
              <div class="text-h6">Publicar un partido</div>
              <div class="text-caption text-grey-7 q-mt-xs">
                Va a aparecer acá para jugadores de otros grupos, que podrán
                ofrecerse. Vos decidís a quién aceptás.
              </div>
            </q-card-section>

            <q-card-section>
              <!-- Sin partidos publicables: se explica por qué en vez de
                   mostrar un select vacío. -->
              <q-banner v-if="publishableMatches.length === 0" dense rounded class="bg-grey-2">
                <template #avatar>
                  <q-icon name="info" color="grey-7" />
                </template>
                No tenés partidos para publicar. Solo podés publicar los que
                organizás vos y que todavía no se jugaron.
              </q-banner>

              <template v-else>
                <q-select
                  v-model="matchToPublish"
                  :options="publishableMatches"
                  option-label="title"
                  option-value="id"
                  label="¿Cuál partido?"
                  outlined
                  dense
                  emit-value
                  map-options
                  class="q-mb-md"
                >
                  <template #option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section>
                        <q-item-label>{{ scope.opt.title }}</q-item-label>
                        <q-item-label caption>{{ scope.opt.dateLabel }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </template>
                </q-select>

                <div class="row items-center q-gutter-sm">
                  <span class="text-body2 text-grey-8">¿Cuántos jugadores faltan?</span>
                  <q-input
                    v-model.number="spotsWanted"
                    type="number"
                    dense
                    outlined
                    min="1"
                    max="22"
                    style="width: 90px"
                  />
                </div>
              </template>
            </q-card-section>

            <q-card-actions align="right" class="q-px-md q-pb-md">
              <q-btn flat label="Cancelar" color="grey-7" v-close-popup />
              <q-btn
                v-if="publishableMatches.length > 0"
                unelevated
                no-caps
                color="primary"
                icon="travel_explore"
                label="Publicar"
                class="pill-btn"
                :disable="!matchToPublish"
                :loading="publishing"
                @click="handlePublish"
              />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <!-- ── Diálogo de postulación ─────────────────────────────────────── -->
        <q-dialog v-model="applyDialog">
          <q-card style="min-width: 320px; max-width: 420px">
            <q-card-section class="q-pb-none">
              <div class="text-h6">Postularte al partido</div>
              <div class="text-caption text-grey-7 q-mt-xs">
                {{ selectedMatch?.title }}
              </div>
            </q-card-section>

            <q-card-section>
              <div class="text-body2 q-mb-sm">
                Contale al organizador algo tuyo — en qué puesto jugás, con quién
                venís. Va a ver tu perfil antes de decidir.
              </div>
              <q-input
                v-model="message"
                type="textarea"
                outlined
                dense
                autogrow
                label="Tu mensaje (opcional)"
                :maxlength="MAX_APPLICATION_MESSAGE"
                counter
                :input-style="{ minHeight: '70px' }"
              />
            </q-card-section>

            <q-card-actions align="right" class="q-px-md q-pb-md">
              <q-btn flat label="Cancelar" color="grey-7" v-close-popup />
              <q-btn
                unelevated
                no-caps
                color="primary"
                icon="sports_soccer"
                label="Enviar postulación"
                class="pill-btn"
                :loading="!!applying"
                @click="handleApply"
              />
            </q-card-actions>
          </q-card>
        </q-dialog>

        <!-- Chat con el organizador del partido al que me postulé -->
        <ApplicationChat
          v-if="chatMatch"
          v-model="chatOpen"
          :match-id="chatMatch.id"
          :applicant-id="authStore.user?.uid ?? ''"
          other-name="Organizador"
          :match-title="chatMatch.title"
        />

      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useQuasar, date as qdate } from 'quasar'
import { useMatch, getEffectiveStatus } from 'src/composables/useMatch'
import { useApplications, MAX_APPLICATION_MESSAGE } from 'src/composables/useApplications'
import { useAuthStore } from 'src/stores/auth.store'
import PublicMatchCard from 'src/components/PublicMatchCard.vue'
import ApplicationChat from 'src/components/ApplicationChat.vue'
import MyApplicationsCard from 'src/components/MyApplicationsCard.vue'
import { PROVINCIAS } from 'src/utils/provincias'

const $q = useQuasar()
const authStore = useAuthStore()

const {
  matches,
  publicMatches,
  loading,
  subscribeToUpcoming,
  subscribeToPublicMatches,
  setMatchPublic,
  stopListening,
  stopListeningPublic,
} = useMatch()
const {
  myApplications,
  applyToMatch,
  withdrawApplication,
  subscribeToMyApplications,
  stopListening: stopApplications,
} = useApplications()

const applyDialog = ref(false)
const selectedMatch = ref(null)
const message = ref('')
const applying = ref(null)

// ── Filtro por provincia ────────────────────────────────────────────────────
// Se recuerda en localStorage (no en el perfil): es una preferencia de
// navegación de este dispositivo, no un dato del usuario que valga la pena
// sincronizar ni escribir en Firestore cada vez que la cambia.
const PROVINCIA_KEY = 'yasta:publicMatches:provincia'

const provinciaFilter = ref(localStorage.getItem(PROVINCIA_KEY) || null)

// Se ofrecen las 24 provincias siempre (son pocas y fijas): limitarlas a
// las que ya tienen partidos publicados dejaba el select vacío apenas un
// partido no traía `provincia` (sede sin geocoding, o carga manual).
const provinciaOptions = computed(() => PROVINCIAS)
const provinciaOptionsFiltered = ref(PROVINCIAS)

function foldText(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Filtro del q-select con use-input: sin tildes de por medio, así "cor"
// encuentra "Córdoba" sin que haga falta tipear la tilde.
function filterProvincias(val, update) {
  update(() => {
    if (!val) {
      provinciaOptionsFiltered.value = provinciaOptions.value
      return
    }
    const needle = foldText(val)
    provinciaOptionsFiltered.value = provinciaOptions.value.filter((p) =>
      foldText(p).includes(needle),
    )
  })
}

const filteredMatches = computed(() => {
  if (!provinciaFilter.value) return publicMatches.value
  return publicMatches.value.filter((m) => m.provincia === provinciaFilter.value)
})

function rememberProvincia(value) {
  if (value) localStorage.setItem(PROVINCIA_KEY, value)
  else localStorage.removeItem(PROVINCIA_KEY)
}

function clearProvincia() {
  provinciaFilter.value = null
  rememberProvincia(null)
}

// ── Publicar un partido propio ──────────────────────────────────────────────
const publishDialog = ref(false)
const matchToPublish = ref(null)
const spotsWanted = ref(2)
const publishing = ref(false)

// Los que puedo publicar: los que organizo yo (o gestiono en el grupo), que
// todavía no se jugaron y que no están ya publicados.
const publishableMatches = computed(() => {
  const uid = authStore.user?.uid
  if (!uid) return []
  const now = Date.now()

  return matches.value
    .filter((m) => {
      if (m.isPublic) return false
      if ((m.date?.toMillis?.() ?? 0) < now) return false
      const st = getEffectiveStatus(m)
      if (st === 'finished' || st === 'closed') return false
      // Mismo criterio que las reglas para escribir isPublic
      if (authStore.isAdmin) return true
      if (m.createdBy === uid) return true
      return !!m.groupId && authStore.isOgInGroup(m.groupId)
    })
    .map((m) => ({
      ...m,
      dateLabel: m.date
        ? qdate.formatDate(m.date.toDate(), 'ddd DD/MM [a las] HH:mm')
        : 'Fecha a confirmar',
    }))
})

// Mis propios partidos publicados: "Partidos abiertos" nunca los mete en
// `filteredMatches` (son de tu grupo, te anotás derecho, no te postulás) —
// sin esto, la única forma de ver quién se postuló al tuyo era ir a Mis
// Grupos → el partido, aunque publicarlo se decide justo en esta pantalla.
const myPublishedMatches = computed(() => {
  const uid = authStore.user?.uid
  if (!uid) return []
  return matches.value.filter((m) => {
    if (!m.isPublic) return false
    if (authStore.isAdmin) return true
    if (m.createdBy === uid) return true
    return !!m.groupId && authStore.isOgInGroup(m.groupId)
  })
})

function openPublishDialog() {
  matchToPublish.value = null
  spotsWanted.value = 2
  publishDialog.value = true
}

async function handlePublish() {
  if (!matchToPublish.value) return
  const value = Number(spotsWanted.value)

  publishing.value = true
  try {
    await setMatchPublic(
      matchToPublish.value,
      true,
      Number.isFinite(value) && value > 0 ? value : null,
    )
    publishDialog.value = false
    $q.notify({
      type: 'positive',
      icon: 'travel_explore',
      message: 'Publicado. Ya puede postularse gente de otros grupos.',
    })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    publishing.value = false
  }
}

// Mi postulación a un partido dado (si existe). Se ignoran las retiradas: si
// me retiré, puedo volver a postularme.
function applicationFor(matchId) {
  return (
    myApplications.value.find(
      (a) => a.matchId === matchId && a.status !== 'withdrawn',
    ) ?? null
  )
}

// Chat con el organizador. El docId de la postulación es MI uid, así que el
// hilo es siempre `matches/{id}/applications/{miUid}/messages`.
const chatOpen = ref(false)
const chatMatch = ref(null)

function openChat(match) {
  chatMatch.value = match
  chatOpen.value = true
}

function openApplyDialog(match) {
  selectedMatch.value = match
  message.value = ''
  applyDialog.value = true
}

async function handleApply() {
  const match = selectedMatch.value
  if (!match) return

  applying.value = match.id
  try {
    await applyToMatch(match.id, message.value)
    applyDialog.value = false
    $q.notify({
      type: 'positive',
      icon: 'check_circle',
      message: 'Te postulaste. Te avisamos cuando el organizador responda.',
    })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    applying.value = null
  }
}

async function handleWithdraw(matchId) {
  applying.value = matchId
  try {
    await withdrawApplication(matchId)
    $q.notify({ type: 'info', message: 'Retiraste tu postulación.' })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    applying.value = null
  }
}

onMounted(() => {
  subscribeToPublicMatches()
  subscribeToMyApplications()
  // Mis propios partidos: es de donde sale la lista del diálogo "Publicar".
  if (!authStore.isGuest) subscribeToUpcoming()
})

onUnmounted(() => {
  stopListeningPublic()
  stopListening()
  stopApplications()
})
</script>
