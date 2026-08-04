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

  // Modo superadmin: un admin global, por defecto, ve/participa SOLO de sus
  // propios grupos como cualquier jugador — no quiere partidos/notificaciones
  // de grupos ajenos mezclados con los suyos. Este flag (activable a mano
  // desde el panel admin) lo saca de ese filtro para debuggear o revisar
  // datos de otros grupos. Es de SESIÓN: arranca en false siempre, se resetea
  // solo con clearUser (logout) y también al recargar/reabrir la app.
  const superAdminMode = ref(false)

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
    superAdminMode.value = false
    initialized.value = true
  }

  function setSuperAdminMode(enabled) {
    superAdminMode.value = !!enabled
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
    superAdminMode,
    isAuthenticated,
    isAdmin,
    role,
    isOgInGroup,
    isMemberOfGroup,
    setUser,
    setOgGroups,
    setMemberGroups,
    setSuperAdminMode,
    clearUser,
    updateFcmToken,
    patchUser,
  }
})
