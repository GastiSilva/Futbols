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
    scrollBehavior: (to) => {
      if (to.hash) return { el: to.hash, behavior: 'smooth', top: 80 }
      return { left: 0, top: 0 }
    },
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
      // Guarda a dónde quería ir para retomarlo después de loguearse. Sin esto,
      // un link de invitación (/grupos/unirse?code=ABC123) abierto sin sesión
      // perdía el código: el guard mandaba a /login y la persona terminaba en
      // el dashboard vacío, sin haberse unido a nada. Era el motivo por el que
      // toda invitación a alguien nuevo había que explicarla a mano.
      // Solo se guardan destinos que valga la pena retomar (hoy: invitaciones
      // a grupos). Guardar cualquier ruta hacía que un intento abandonado
      // desviara un login posterior sin relación.
      if (to.name === 'join-group') {
        sessionStorage.setItem('postLoginRedirect', to.fullPath)
      }
      return { path: '/login' }
    }

    // Cuenta de email/contraseña sin verificar: solo puede estar en
    // /verificar-email hasta confirmar el mail (Google nunca cae acá,
    // ver needsEmailVerification en auth.store.js).
    if (authStore.isAuthenticated && authStore.needsEmailVerification && to.path !== '/verificar-email') {
      return { path: '/verificar-email' }
    }
    if (to.path === '/verificar-email' && authStore.isAuthenticated && !authStore.needsEmailVerification) {
      return { path: '/' }  // ya verificado, no tiene sentido quedarse acá
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
