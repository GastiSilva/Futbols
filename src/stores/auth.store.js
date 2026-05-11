// src/stores/auth.store.js
// ─────────────────────────────────────────────────────────────────────────────
// Store de Pinia para el estado global de autenticación.
// ─────────────────────────────────────────────────────────────────────────────
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Roles disponibles en la aplicación
export const USER_ROLES = {
  ADMIN: 'admin',
  OG: 'og',
  PLAYER: 'player',
}

export const ROLE_LABELS = {
  admin: 'Admin',
  og: 'OG',
  player: 'Jugador',
}

export const ROLE_COLORS = {
  admin: 'amber-8',
  og: 'blue-8',
  player: 'green-8',
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const initialized = ref(false)  // true cuando onAuthStateChanged ha respondido

  // ── Getters ────────────────────────────────────────────────────────────────
  const isAuthenticated = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.isAdmin === true)
  const isOg = computed(() => user.value?.role === USER_ROLES.OG)
  const role = computed(() => user.value?.role ?? USER_ROLES.PLAYER)

  // ── Actions ────────────────────────────────────────────────────────────────
  function setUser(userData) {
    user.value = userData
    initialized.value = true
  }

  function clearUser() {
    user.value = null
    initialized.value = true
  }

  function updateFcmToken(token) {
    if (user.value) {
      user.value.fcmToken = token
    }
  }

  return {
    user,
    initialized,
    isAuthenticated,
    isAdmin,
    isOg,
    role,
    setUser,
    clearUser,
    updateFcmToken,
  }
})
