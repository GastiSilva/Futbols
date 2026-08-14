// src/router/index.js
import { route } from 'quasar/wrappers'
import { createRouter, createMemoryHistory, createWebHistory, createWebHashHistory } from 'vue-router'
import routes from './routes'
import { useAuthStore } from 'src/stores/auth.store'
import { consumePendingInvite } from 'src/composables/useMatchInvite'

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
    // allowGuest se declara en la ruta hoja, no en el layout padre: `some`
    // sobre matched alcanza porque ninguna ruta padre lo define.
    const allowGuest = to.matched.some((r) => r.meta.allowGuest)

    if (requiresAuth && !authStore.isAuthenticated) {
      return { path: '/login' }
    }

    // ── Invitación a partido pendiente ────────────────────────────────────
    // Alguien abrió un link compartido y eligió "Entrar con mi cuenta": la
    // intención quedó guardada y el login lo devuelve acá. Se consume UNA vez
    // y se lo manda al partido, que es donde esperaba terminar. Los invitados
    // anónimos quedan afuera: ellos ya fueron al partido por su propio camino
    // y no deben disparar el circuito de "sumarse al grupo".
    // Se excluye la propia landing de invitación (`match-invite`): quien está
    // parado ahí todavía no decidió nada, y consumirla lo sacaría de la
    // pantalla que justamente vino a ver.
    if (
      authStore.isAuthenticated &&
      !authStore.isGuest &&
      !authStore.needsEmailVerification &&
      to.name !== 'match-invite' &&
      to.name !== 'match-detail'
    ) {
      const pendingMatchId = consumePendingInvite()
      if (pendingMatchId) {
        return { name: 'match-detail', params: { id: pendingMatchId }, query: { invitado: '1' } }
      }
    }

    // ── Invitado anónimo fuera de su corral ───────────────────────────────
    // Solo puede estar en las rutas marcadas allowGuest. Si toca cualquier
    // otra (perfil, grupos, ranking…), se lo devuelve a su partido con un
    // aviso — la UI le ofrece crear la cuenta desde ahí. Nunca se lo expulsa
    // a /login, que sería perder su lugar en la lista sin explicación.
    if (authStore.isAuthenticated && authStore.isGuest && requiresAuth && !allowGuest) {
      return authStore.guestMatchId
        ? { name: 'match-detail', params: { id: authStore.guestMatchId }, query: { registrate: '1' } }
        : { name: 'player-dashboard' }
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

    // Ya logueado, no volver al login. Se excluye la landing de invitación:
    // también es `public`, pero tiene sentido para alguien CON sesión (le
    // muestra la ficha del partido y un botón para seguir), así que rebotarla
    // a "/" rompería el camino (a) del link compartido.
    if (isPublic && authStore.isAuthenticated && !allowGuest) {
      return { path: '/' }
    }
  })

  return router
})
