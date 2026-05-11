// src/router/index.js
import { route } from 'quasar/wrappers'
import { createRouter, createMemoryHistory, createWebHistory, createWebHashHistory } from 'vue-router'
import routes from './routes'
import { useAuthStore } from 'src/stores/auth.store'

export default route(function ({ store }) {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : process.env.VUE_ROUTER_MODE === 'history'
      ? createWebHistory
      : createWebHashHistory

  const router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE),
  })

  // ── Navigation Guard ──────────────────────────────────────────────────────
  router.beforeEach(async (to) => {
    const authStore = useAuthStore()

    // Espera a que Firebase resuelva el estado inicial de auth
    if (!authStore.initialized) {
      await new Promise((resolve) => {
        const unwatch = authStore.$subscribe(() => {
          if (authStore.initialized) {
            unwatch()
            resolve()
          }
        })
      })
    }

    const requiresAuth = to.matched.some((r) => r.meta.requiresAuth)
    const requiresAdmin = to.matched.some((r) => r.meta.requiresAdmin)
    const isPublic = to.matched.some((r) => r.meta.public)

    if (requiresAuth && !authStore.isAuthenticated) {
      return { path: '/login' }
    }

    if (requiresAdmin && !authStore.isAdmin) {
      return { path: '/' }  // redirige al dashboard del jugador
    }

    if (isPublic && authStore.isAuthenticated) {
      return { path: '/' }  // ya logueado, no volver al login
    }
  })

  return router
})
