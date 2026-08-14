<template>
  <q-layout view="lHh Lpr lFf">

    <!-- ── Header ────────────────────────────────────────────────────────── -->
    <q-header elevated class="grass-bg text-white">
      <q-toolbar>
        <q-btn flat dense round icon="menu" aria-label="Menú" @click="drawer = !drawer" />

        <q-toolbar-title class="text-weight-bold q-pl-xs">
          <q-icon name="sports_soccer" size="22px" class="text-primary q-mr-xs" />Partidos de fútbol
        </q-toolbar-title>

        <!-- Avatar del usuario en el header -->
        <!-- <q-avatar size="34px" class="cursor-pointer" @click="drawer = true">
          <img
            :src="user?.photoURL ?? 'icons/icon-128x128.png'"
            :alt="user?.displayName ?? 'usuario'"
            referrerpolicy="no-referrer"
          />
          <q-tooltip>{{ user?.displayName }}</q-tooltip>
        </q-avatar> -->
      </q-toolbar>
    </q-header>

    <!-- ── Drawer ─────────────────────────────────────────────────────────── -->
    <q-drawer v-model="drawer" show-if-above bordered :width="260">
      <!-- El drawer usa flex-column para fijar el botón de logout al fondo -->
      <div class="column full-height">

        <!-- ── Perfil del usuario ─────────────────────────────────────────── -->
        <div class="grass-bg text-white q-pa-md column items-center q-gutter-sm">
          <q-avatar size="64px" class="shadow-4">
            <img
              :src="user?.photoURL ?? 'icons/icon-128x128.png'"
              :alt="user?.displayName ?? 'usuario'"
              referrerpolicy="no-referrer"
            />
          </q-avatar>
          <div class="column items-center">
            <div class="text-subtitle1 text-weight-bold ellipsis" style="max-width: 200px">
              {{ user?.nickname || user?.displayName || 'Jugador' }}
            </div>
            <div class="text-caption text-green-2 ellipsis" style="max-width: 200px">
              {{ user?.email }}
            </div>
          </div>
          <q-badge
            v-if="user"
            :color="roleBadgeColor"
            text-color="white"
            :label="roleBadgeLabel"
            class="q-px-sm"
          />
        </div>

        <!-- ── Navegación (scrollable) ──────────────────────────────────── -->
        <q-scroll-area class="col">
          <q-list class="drawer-nav q-py-md">

            <!-- Jugador -->
            <q-item-label header class="drawer-section-label q-pt-sm">
              Jugador
            </q-item-label>

            <q-item
              v-if="!isGuest"
              clickable
              v-ripple
              class="drawer-item"
              :to="{ name: 'profile' }"
              active-class="drawer-item--active"
            >
              <q-item-section avatar>
                <q-icon name="account_circle" size="22px" />
              </q-item-section>
              <q-item-section>Mi Perfil</q-item-section>
            </q-item>

            <q-item
              clickable
              v-ripple
              class="drawer-item"
              :to="{ name: 'player-dashboard' }"
              exact
              active-class="drawer-item--active"
            >
              <q-item-section avatar>
                <q-icon name="home" size="22px" />
              </q-item-section>
              <q-item-section>Partidos</q-item-section>
            </q-item>

            <!-- Un invitado (link compartido, sin cuenta) solo ve Partidos:
                 el resto necesita perfil/grupos, que no tiene. En vez de
                 mostrarle items que el guard le va a rebotar, se los oculta
                 y se le ofrece crear la cuenta. -->
            <template v-if="!isGuest">
              <q-item
                clickable
                v-ripple
                class="drawer-item"
                :to="{ name: 'leaderboard' }"
                active-class="drawer-item--active"
              >
                <q-item-section avatar>
                  <q-icon name="emoji_events" size="22px" />
                </q-item-section>
                <q-item-section>Estadísticas</q-item-section>
              </q-item>

              <q-item
                clickable
                v-ripple
                class="drawer-item"
                :to="{ name: 'venues' }"
                active-class="drawer-item--active"
              >
                <q-item-section avatar>
                  <q-icon name="stadium" size="22px" />
                </q-item-section>
                <q-item-section>Sedes</q-item-section>
              </q-item>

              <!-- Grupos -->
              <q-item-label header class="drawer-section-label">
                Grupos
              </q-item-label>

              <q-item
                clickable
                v-ripple
                class="drawer-item"
                :to="{ name: 'groups' }"
                active-class="drawer-item--active"
              >
                <q-item-section avatar>
                  <q-icon name="group" size="22px" />
                </q-item-section>
                <q-item-section>Mis Grupos</q-item-section>
              </q-item>

              <q-item
                clickable
                v-ripple
                class="drawer-item"
                :to="{ name: 'join-group' }"
                active-class="drawer-item--active"
              >
                <q-item-section avatar>
                  <q-icon name="person_add" size="22px" />
                </q-item-section>
                <q-item-section>Buscar Grupo</q-item-section>
              </q-item>
            </template>

            <!-- Invitado: la salida hacia una cuenta real -->
            <q-item
              v-else
              clickable
              v-ripple
              class="drawer-item"
              @click="handleGuestRegister"
            >
              <q-item-section avatar>
                <q-icon name="how_to_reg" size="22px" />
              </q-item-section>
              <q-item-section>Crear mi cuenta</q-item-section>
            </q-item>

            <!-- Admin (solo visible si isAdmin) -->
            <template v-if="isAdmin">
              <q-item-label header class="drawer-section-label">
                Admin
              </q-item-label>

              <q-item
                clickable
                v-ripple
                class="drawer-item"
                :to="{ name: 'admin-dashboard' }"
                active-class="drawer-item--active"
              >
                <q-item-section avatar>
                  <q-icon name="admin_panel_settings" size="22px" />
                </q-item-section>
                <q-item-section>Panel Admin</q-item-section>
              </q-item>

              <q-item
                clickable
                v-ripple
                class="drawer-item"
                :to="{ name: 'create-match' }"
                active-class="drawer-item--active"
              >
                <q-item-section avatar>
                  <q-icon name="add_circle" size="22px" />
                </q-item-section>
                <q-item-section>Crear Partido</q-item-section>
              </q-item>
            </template>

          </q-list>
        </q-scroll-area>

        <!-- ── Cerrar sesión (fijo al fondo) ──────────────────────────────── -->
        <div>
          <q-item
            clickable
            v-ripple
            class="drawer-item q-my-xs"
            :disable="loggingOut"
            @click="handleLogout"
          >
            <q-item-section avatar>
              <q-icon name="logout" color="negative" size="22px" />
            </q-item-section>
            <q-item-section class="text-negative text-weight-medium">
              Cerrar sesión
            </q-item-section>
            <q-item-section side v-if="loggingOut">
              <q-spinner-dots color="negative" size="18px" />
            </q-item-section>
          </q-item>

          <!-- Firma discreta del desarrollador -->
          <div class="row items-center justify-center q-py-xs q-gutter-x-xs dev-signature">
            <img src="icons/Logo for MokDev.png" alt="MokDev" width="14" height="14" />
            <span class="text-caption">MokDev</span>
          </div>
        </div>

      </div>
    </q-drawer>

    <!-- ── Contenido principal ─────────────────────────────────────────────── -->
    <q-page-container>
      <router-view />
    </q-page-container>

  </q-layout>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'
import { setPendingInvite } from 'src/composables/useMatchInvite'
import { useAuthStore } from 'src/stores/auth.store'
import { ROLE_LABELS, ROLE_COLORS } from 'src/stores/auth.store'

const router = useRouter()
const $q = useQuasar()
const { user, isAdmin, logout } = useAuth()
const authStore = useAuthStore()

const isGuest = computed(() => authStore.isGuest)

const roleBadgeLabel = computed(() =>
  isGuest.value ? 'Invitado' : (ROLE_LABELS[authStore.role] ?? 'Jugador'),
)
const roleBadgeColor = computed(() =>
  isGuest.value ? 'blue-grey-6' : (ROLE_COLORS[authStore.role] ?? 'green-8'),
)

// El invitado pasa a cuenta real: se conserva la invitación al partido para
// que, tras registrarse, vuelva ahí y se lo sume al grupo.
async function handleGuestRegister() {
  if (authStore.guestMatchId) setPendingInvite(authStore.guestMatchId)
  await handleLogout()
}

const drawer = ref(false)
const loggingOut = ref(false)

async function handleLogout() {
  loggingOut.value = true
  try {
    await logout()
    router.push('/login')
  } catch {
    $q.notify({ type: 'negative', message: 'No se pudo cerrar la sesión. Intentá de nuevo.' })
  } finally {
    loggingOut.value = false
  }
}
</script>

<style scoped>
/* Evita que el avatar del header genere un ring de foco visible poco estético */
.q-avatar:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.6);
  outline-offset: 2px;
}

/* Lista de navegación estilo minimal (menos "cajita", más aire entre items) */
.drawer-section-label {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  margin-top: 20px;
  margin-bottom: 2px;
}

.drawer-item {
  min-height: 50px;
  padding-top: 10px;
  padding-bottom: 10px;
  border-left: 3px solid transparent;
  color: rgba(255, 255, 255, 0.85);
}

.drawer-item :deep(.q-icon) {
  color: rgba(255, 255, 255, 0.6);
}

.drawer-item--active {
  border-left-color: var(--q-primary);
  color: var(--q-primary);
}

.drawer-item--active :deep(.q-icon) {
  color: var(--q-primary);
}

.dev-signature {
  opacity: 0.35;
}

.dev-signature img {
  border-radius: 3px;
  object-fit: cover;
}
</style>
