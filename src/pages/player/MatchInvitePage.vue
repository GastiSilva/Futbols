<template>
  <div class="flex flex-center grass-bg q-pa-md" style="min-height: 100vh">
    <div class="full-width" style="max-width: 440px">

      <!-- Encabezado -->
      <div class="text-center q-mb-md">
        <q-icon name="sports_soccer" size="52px" color="primary" />
        <div class="text-h5 text-white text-weight-bold q-mt-xs">Te invitaron a un partido</div>
      </div>

      <!-- Cargando el partido -->
      <q-card v-if="loadingMatch" class="q-pa-xl flex flex-center">
        <q-spinner-dots color="green-9" size="42px" />
      </q-card>

      <!-- Link roto / partido inexistente -->
      <q-card v-else-if="!match" class="q-pa-lg text-center">
        <q-icon name="link_off" size="48px" color="grey-5" class="q-mb-sm" />
        <div class="text-subtitle1 text-weight-bold">Este partido ya no está disponible</div>
        <div class="text-body2 text-grey-7 q-mt-xs">
          Puede que lo hayan borrado o que el link esté incompleto.
        </div>
        <q-btn
          unelevated
          color="primary"
          label="Ir al inicio"
          class="pill-btn q-mt-md"
          @click="router.replace({ name: 'player-dashboard' })"
        />
      </q-card>

      <template v-else>
        <!-- Ficha del partido -->
        <q-card flat bordered class="q-mb-md">
          <q-card-section class="q-pb-sm">
            <div class="text-h6 text-weight-bold">{{ match.title }}</div>
            <div v-if="match.location" class="row items-center text-grey-7 text-body2 q-mt-xs">
              <q-icon name="place" size="18px" class="q-mr-xs" />{{ match.location }}
            </div>
            <div v-if="whenLabel" class="row items-center text-grey-7 text-body2 q-mt-xs">
              <q-icon name="schedule" size="18px" class="q-mr-xs" />{{ whenLabel }}
            </div>
            <div class="row items-center text-grey-7 text-body2 q-mt-xs">
              <q-icon name="groups" size="18px" class="q-mr-xs" />
              {{ match.currentPlayers ?? 0 }}<template v-if="match.maxPlayers"> / {{ match.maxPlayers }}</template>
              anotados
            </div>
          </q-card-section>
        </q-card>

        <!-- ── Elección de camino ─────────────────────────────────────────── -->
        <q-card class="q-pa-lg">

          <!-- Ya tiene sesión: un solo botón, sin preguntas -->
          <template v-if="isLoggedIn">
            <div class="text-subtitle1 text-weight-bold q-mb-xs">
              Hola {{ authStore.user.nickname || authStore.user.displayName }}
            </div>
            <div class="text-body2 text-grey-7 q-mb-md">
              Ya tenés la sesión iniciada. Te llevamos al partido para que te anotes.
            </div>
            <q-btn
              unelevated
              color="primary"
              size="lg"
              class="full-width pill-btn"
              label="Ver el partido"
              icon="arrow_forward"
              :loading="continuing"
              @click="continueAsUser"
            />
          </template>

          <!-- Sin sesión: invitado o cuenta -->
          <template v-else>
            <div class="text-subtitle1 text-weight-bold q-mb-xs">¿Cómo querés entrar?</div>
            <div class="text-body2 text-grey-7 q-mb-md">
              Podés anotarte ahora mismo sin crear una cuenta.
            </div>

            <!-- Opción 1: invitado -->
            <q-input
              v-model="guestName"
              outlined
              dense
              label="Tu nombre"
              hint="Así te van a ver en la lista"
              maxlength="40"
              :error="!!nameError"
              :error-message="nameError"
              @keyup.enter="handleGuest"
            >
              <template #prepend>
                <q-icon name="person_outline" />
              </template>
            </q-input>

            <q-btn
              unelevated
              color="primary"
              size="lg"
              class="full-width pill-btn q-mt-md"
              label="Entrar como invitado"
              :loading="enteringAsGuest"
              :disable="creatingAccount"
              @click="handleGuest"
            />

            <!-- Qué implica ser invitado: dicho antes de decidir, sin alarmar -->
            <q-banner dense class="bg-grey-2 text-grey-8 rounded-borders q-mt-sm">
              <template #avatar>
                <q-icon name="info" color="grey-6" size="20px" />
              </template>
              <div class="text-caption">
                Como invitado podés <strong>anotarte a este partido</strong> y ver la
                lista. No se guardan tus estadísticas, ni goles, ni MVP — para eso,
                y para entrar a los grupos, hace falta una cuenta. Podés crearla
                más tarde sin perder tu lugar en la lista.
              </div>
            </q-banner>

            <div class="row items-center q-my-md">
              <q-separator class="col" />
              <div class="text-caption text-grey-6 q-mx-sm">o</div>
              <q-separator class="col" />
            </div>

            <!-- Opción 2: circuito completo -->
            <q-btn
              outline
              color="primary"
              size="lg"
              class="full-width pill-btn"
              label="Entrar con mi cuenta"
              icon="login"
              :loading="creatingAccount"
              :disable="enteringAsGuest"
              @click="goToLogin"
            />
            <div class="text-caption text-grey-6 text-center q-mt-sm">
              Te anotamos en el partido y te sumamos al grupo automáticamente.
            </div>
          </template>

          <div v-if="authError" class="text-negative text-caption q-mt-md">
            {{ authError }}
          </div>
        </q-card>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from 'src/composables/useAuth'
import { useAuthStore } from 'src/stores/auth.store'
import { useMatchInvite, setPendingInvite } from 'src/composables/useMatchInvite'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { loginAsGuest, error: authError } = useAuth()
const { fetchInviteMatch } = useMatchInvite()

const matchId = route.params.id
const match = ref(null)
const loadingMatch = ref(true)
const guestName = ref('')
const nameError = ref('')
const enteringAsGuest = ref(false)
const creatingAccount = ref(false)
const continuing = ref(false)

// Un invitado anónimo NO cuenta como "ya logueado": justamente está en esta
// pantalla para decidir, o volvió a un link nuevo con su sesión de invitado.
const isLoggedIn = computed(() => authStore.isAuthenticated && !authStore.isGuest)

onMounted(async () => {
  // Un invitado anónimo puede leer el partido; alguien sin ninguna sesión, no
  // (las reglas exigen auth). En ese caso se muestra la ficha vacía y los
  // datos aparecen recién después de elegir cómo entrar.
  if (authStore.isAuthenticated) {
    match.value = await fetchInviteMatch(matchId)
  } else {
    match.value = { id: matchId, title: 'Partido de fútbol', currentPlayers: 0 }
  }
  loadingMatch.value = false
})

const whenLabel = computed(() => {
  const d = match.value?.date?.toDate?.()
  if (!d) return ''
  return d.toLocaleString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
})

// ── Camino (c1): invitado anónimo ──────────────────────────────────────────
async function handleGuest() {
  const name = guestName.value.trim()
  if (!name) {
    nameError.value = 'Necesitamos tu nombre para anotarte en la lista.'
    return
  }
  nameError.value = ''
  enteringAsGuest.value = true
  try {
    // Queda atado a ESTE partido: es el único donde se puede anotar. Se fija
    // ANTES de navegar (y antes de que monte MatchDetailPage) porque el guard
    // del router y canRegister lo leen apenas entra — si llegara después, el
    // invitado vería su propio partido como ajeno por un instante.
    authStore.setGuestMatchId(matchId)
    await loginAsGuest(name)
    router.replace({ name: 'match-detail', params: { id: matchId } })
  } catch {
    // El login falló: no dejar el partido "reservado" para una sesión de
    // invitado que nunca existió. El mensaje ya viene en authError.
    authStore.setGuestMatchId(null)
  } finally {
    enteringAsGuest.value = false
  }
}

// ── Camino (c2): circuito completo (login → anotarse → sumarse al grupo) ────
function goToLogin() {
  creatingAccount.value = true
  // La intención sobrevive al rebote por /login: al volver, el guard del
  // router la consume y lleva directo al partido.
  setPendingInvite(matchId)
  router.push('/login')
}

// ── Camino (a)/(b): ya tenía sesión ────────────────────────────────────────
// Va con `?invitado=1` para que MatchDetailPage lo sume al grupo del partido
// si todavía no es miembro (caso b). Si ya lo es (caso a), joinMatchGroup no
// hace nada y queda el camino normal, igual que si hubiera llegado por la
// notificación push.
function continueAsUser() {
  continuing.value = true
  router.replace({ name: 'match-detail', params: { id: matchId }, query: { invitado: '1' } })
}
</script>
