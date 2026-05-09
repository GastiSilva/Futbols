<template>
  <q-layout view="lHh Lpr lFf">
    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <q-header elevated class="bg-green-9 text-white">
      <q-toolbar>
        <q-btn flat dense round icon="menu" @click="drawer = !drawer" />
        <q-toolbar-title class="text-weight-bold">
          <q-icon name="sports_soccer" class="q-mr-sm" />Futbols
        </q-toolbar-title>
        <q-avatar size="32px" class="cursor-pointer" @click="goToProfile">
          <img :src="user?.photoURL ?? 'icons/icon-128x128.png'" :alt="user?.displayName" />
        </q-avatar>
      </q-toolbar>
    </q-header>

    <!-- ── Drawer / Sidebar ─────────────────────────────────────────────── -->
    <q-drawer v-model="drawer" show-if-above bordered>
      <q-list padding>
        <q-item-label header class="text-grey-7 text-uppercase text-caption">
          Jugador
        </q-item-label>

        <q-item clickable v-ripple :to="{ name: 'player-dashboard' }" exact>
          <q-item-section avatar><q-icon name="home" /></q-item-section>
          <q-item-section>Dashboard</q-item-section>
        </q-item>

        <q-item clickable v-ripple :to="{ name: 'leaderboard' }" exact>
          <q-item-section avatar><q-icon name="emoji_events" /></q-item-section>
          <q-item-section>Ranking</q-item-section>
        </q-item>

        <!-- Solo visible para admins -->
        <template v-if="isAdmin">
          <q-separator class="q-my-md" />
          <q-item-label header class="text-grey-7 text-uppercase text-caption">
            Admin
          </q-item-label>

          <q-item clickable v-ripple :to="{ name: 'admin-dashboard' }" exact>
            <q-item-section avatar><q-icon name="admin_panel_settings" /></q-item-section>
            <q-item-section>Panel Admin</q-item-section>
          </q-item>

          <q-item clickable v-ripple :to="{ name: 'create-match' }" exact>
            <q-item-section avatar><q-icon name="add_circle" /></q-item-section>
            <q-item-section>Crear Partido</q-item-section>
          </q-item>
        </template>

        <q-separator class="q-my-md" />

        <q-item clickable v-ripple @click="handleLogout">
          <q-item-section avatar><q-icon name="logout" color="negative" /></q-item-section>
          <q-item-section class="text-negative">Cerrar sesión</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <!-- ── Contenido principal ──────────────────────────────────────────── -->
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from 'src/composables/useAuth'

const router = useRouter()
const drawer = ref(false)
const { user, isAdmin, logout } = useAuth()

async function handleLogout() {
  await logout()
  router.push('/login')
}

function goToProfile() {
  // Placeholder para futura página de perfil
}
</script>
