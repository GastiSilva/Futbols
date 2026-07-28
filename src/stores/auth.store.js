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

  // IDs de los grupos donde el usuario tiene ACCESO ANTICIPADO a las listas
  // (30 min antes de openAt): es OG (members/{uid}.og === true) O es
  // owner/admin del grupo. El rol OG dejó de ser global: es por grupo.
  const ogGroupIds = ref([])

  // IDs de TODOS los grupos de los que el usuario es miembro (cualquier rol).
  // Se usa para filtrar qué partidos ve/puede anotarse (solo los de sus grupos,
  // o los partidos sin grupo, que son globales/de admin).
  const memberGroupIds = ref([])

  // ── Getters ────────────────────────────────────────────────────────────────
  const isAuthenticated = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.isAdmin === true)
  const role = computed(() => user.value?.role ?? USER_ROLES.PLAYER)

  // ¿El usuario tiene acceso anticipado en un grupo puntual? (OG u owner/admin)
  function isOgInGroup(groupId) {
    return !!groupId && ogGroupIds.value.includes(groupId)
  }

  // ¿El usuario pertenece a este grupo (cualquier rol)?
  function isMemberOfGroup(groupId) {
    return !!groupId && memberGroupIds.value.includes(groupId)
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  function setUser(userData) {
    user.value = userData
    initialized.value = true
  }

  function setOgGroups(ids) {
    ogGroupIds.value = Array.isArray(ids) ? ids : []
  }

  function setMemberGroups(ids) {
    memberGroupIds.value = Array.isArray(ids) ? ids : []
  }

  function clearUser() {
    user.value = null
    ogGroupIds.value = []
    memberGroupIds.value = []
    initialized.value = true
  }

  function updateFcmToken(token) {
    if (user.value) {
      user.value.fcmToken = token
    }
  }

  // Actualiza campos sueltos del perfil en memoria (tras guardarlos en Firestore)
  function patchUser(partial) {
    if (user.value && partial && typeof partial === 'object') {
      user.value = { ...user.value, ...partial }
    }
  }

  return {
    user,
    initialized,
    ogGroupIds,
    memberGroupIds,
    isAuthenticated,
    isAdmin,
    role,
    isOgInGroup,
    isMemberOfGroup,
    setUser,
    setOgGroups,
    setMemberGroups,
    clearUser,
    updateFcmToken,
    patchUser,
  }
})
