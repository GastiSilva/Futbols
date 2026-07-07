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

  // IDs de los grupos donde el usuario es OG (acceso anticipado a las listas).
  // El rol OG dejó de ser global: ahora se asigna por grupo (members/{uid}.og).
  const ogGroupIds = ref([])

  // ── Getters ────────────────────────────────────────────────────────────────
  const isAuthenticated = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.isAdmin === true)
  const role = computed(() => user.value?.role ?? USER_ROLES.PLAYER)

  // ¿El usuario es OG en un grupo puntual?
  function isOgInGroup(groupId) {
    return !!groupId && ogGroupIds.value.includes(groupId)
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  function setUser(userData) {
    user.value = userData
    initialized.value = true
  }

  function setOgGroups(ids) {
    ogGroupIds.value = Array.isArray(ids) ? ids : []
  }

  function clearUser() {
    user.value = null
    ogGroupIds.value = []
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
    ogGroupIds,
    isAuthenticated,
    isAdmin,
    role,
    isOgInGroup,
    setUser,
    setOgGroups,
    clearUser,
    updateFcmToken,
  }
})
