<template>
  <q-layout view="lHh Lpr lFf">

    <!-- ── Header ────────────────────────────────────────────────────────── -->
    <q-header elevated class="bg-green-9 text-white">
      <q-toolbar>
        <q-btn flat dense round icon="menu" aria-label="Menú" @click="drawer = !drawer" />

        <q-toolbar-title class="text-weight-bold q-pl-xs">
          <q-icon name="sports_soccer" size="22px" class="q-mr-xs" />Futbols
        </q-toolbar-title>

        <!-- Avatar del usuario en el header -->
        <q-avatar size="34px" class="cursor-pointer" @click="drawer = true">
          <img
            :src="user?.photoURL ?? 'icons/icon-128x128.png'"
            :alt="user?.displayName ?? 'usuario'"
            referrerpolicy="no-referrer"
          />
          <q-tooltip>{{ user?.displayName }}</q-tooltip>
        </q-avatar>
      </q-toolbar>
    </q-header>

    <!-- ── Drawer ─────────────────────────────────────────────────────────── -->
    <q-drawer v-model="drawer" show-if-above bordered :width="260">
      <!-- El drawer usa flex-column para fijar el botón de logout al fondo -->
      <div class="column full-height">

        <!-- ── Perfil del usuario ─────────────────────────────────────────── -->
        <div class="bg-green-9 text-white q-pa-md column items-center q-gutter-sm">
          <q-avatar size="64px" class="shadow-4">
            <img
              :src="user?.photoURL ?? 'icons/icon-128x128.png'"
              :alt="user?.displayName ?? 'usuario'"
              referrerpolicy="no-referrer"
            />
          </q-avatar>
          <div class="column items-center">
            <div class="text-subtitle1 text-weight-bold ellipsis" style="max-width: 200px">
              {{ user?.displayName ?? 'Jugador' }}
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
          <q-list padding>

            <!-- Jugador -->
            <q-item-label header class="text-grey-7 text-uppercase text-caption q-pt-md">
              Jugador
            </q-item-label>

            <q-item
              clickable
              v-ripple
              :to="{ name: 'player-dashboard' }"
              active-class="text-green-9 bg-green-1"
            >
              <q-item-section avatar>
                <q-icon name="home" />
              </q-item-section>
              <q-item-section>Dashboard</q-item-section>
            </q-item>

            <q-item
              clickable
              v-ripple
              :to="{ name: 'leaderboard' }"
              active-class="text-green-9 bg-green-1"
            >
              <q-item-section avatar>
                <q-icon name="emoji_events" />
              </q-item-section>
              <q-item-section>Ranking</q-item-section>
            </q-item>

            <!-- Grupos -->
            <q-separator class="q-my-sm" />
            <q-item-label header class="text-grey-7 text-uppercase text-caption">
              Grupos
            </q-item-label>

            <q-item
              clickable
              v-ripple
              :to="{ name: 'groups' }"
              active-class="text-green-9 bg-green-1"
            >
              <q-item-section avatar>
                <q-icon name="group" />
              </q-item-section>
              <q-item-section>Mis Grupos</q-item-section>
            </q-item>

            <q-item
              clickable
              v-ripple
              :to="{ name: 'join-group' }"
              active-class="text-green-9 bg-green-1"
            >
              <q-item-section avatar>
                <q-icon name="person_add" />
              </q-item-section>
              <q-item-section>Buscar Grupo</q-item-section>
            </q-item>

            <!-- Admin (solo visible si isAdmin) -->
            <template v-if="isAdmin">
              <q-separator class="q-my-sm" />
              <q-item-label header class="text-grey-7 text-uppercase text-caption">
                Admin
              </q-item-label>

              <q-item
                clickable
                v-ripple
                :to="{ name: 'admin-dashboard' }"
                active-class="text-green-9 bg-green-1"
              >
                <q-item-section avatar>
                  <q-icon name="admin_panel_settings" />
                </q-item-section>
                <q-item-section>Panel Admin</q-item-section>
              </q-item>

              <q-item
                clickable
                v-ripple
                :to="{ name: 'create-match' }"
                active-class="text-green-9 bg-green-1"
              >
                <q-item-section avatar>
                  <q-icon name="add_circle" />
                </q-item-section>
                <q-item-section>Crear Partido</q-item-section>
              </q-item>
            </template>

          </q-list>
        </q-scroll-area>

        <!-- ── Cerrar sesión (fijo al fondo) ──────────────────────────────── -->
        <div>
          <q-separator />
          <q-item
            clickable
            v-ripple
            class="q-my-xs"
            :disable="loggingOut"
            @click="handleLogout"
          >
            <q-item-section avatar>
              <q-icon name="logout" color="negative" />
            </q-item-section>
            <q-item-section class="text-negative text-weight-medium">
              Cerrar sesión
            </q-item-section>
            <q-item-section side v-if="loggingOut">
              <q-spinner-dots color="negative" size="18px" />
            </q-item-section>
          </q-item>
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
import { useAuthStore } from 'src/stores/auth.store'
import { ROLE_LABELS, ROLE_COLORS } from 'src/stores/auth.store'

const router = useRouter()
const $q = useQuasar()
const { user, isAdmin, logout } = useAuth()
const authStore = useAuthStore()

const roleBadgeLabel = computed(() => ROLE_LABELS[authStore.role] ?? 'Jugador')
const roleBadgeColor = computed(() => ROLE_COLORS[authStore.role] ?? 'green-8')

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
</style>
