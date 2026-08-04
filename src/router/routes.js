// src/router/routes.js

const routes = [
  // ── Autenticación ──────────────────────────────────────────────────────────
  {
    path: '/login',
    component: () => import('src/pages/LoginPage.vue'),
    meta: { public: true },
  },

  // ── Layout principal ───────────────────────────────────────────────────────
  {
    path: '/',
    component: () => import('src/layouts/MainLayout.vue'),
    children: [
      // Jugador
      {
        path: '',
        name: 'player-dashboard',
        component: () => import('src/pages/player/DashboardPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'partidos/:id',
        name: 'match-detail',
        component: () => import('src/pages/player/MatchDetailPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'ranking',
        name: 'leaderboard',
        component: () => import('src/pages/player/LeaderboardPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        // Perfil propio del usuario (cada uno ve solo el suyo)
        path: 'perfil',
        name: 'profile',
        component: () => import('src/pages/player/ProfilePage.vue'),
        meta: { requiresAuth: true },
      },
      {
        // Perfil de otro usuario, de solo lectura (compañero de grupo)
        path: 'perfil/:uid',
        name: 'profile-view',
        component: () => import('src/pages/player/ProfileViewPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        // Sedes / canchas donde se juegan los partidos
        path: 'sedes',
        name: 'venues',
        component: () => import('src/pages/venues/VenuesPage.vue'),
        meta: { requiresAuth: true },
      },

      // Grupos
      {
        path: 'grupos',
        name: 'groups',
        component: () => import('src/pages/groups/GroupsPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'grupos/unirse',
        name: 'join-group',
        component: () => import('src/pages/groups/JoinGroupPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'grupos/:id',
        name: 'group-detail',
        component: () => import('src/pages/groups/GroupDetailPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        // Crear partido dentro de un grupo (cualquier miembro, sin ser admin global)
        path: 'grupos/:id/crear-partido',
        name: 'create-group-match',
        component: () => import('src/pages/admin/CreateMatchPage.vue'),
        meta: { requiresAuth: true },
      },
      {
        // Crear partido desde la sección Partidos, sin grupo preseleccionado
        // (cualquier miembro; el selector de grupo solo ofrece los suyos)
        path: 'crear-partido',
        name: 'create-match-player',
        component: () => import('src/pages/admin/CreateMatchPage.vue'),
        meta: { requiresAuth: true },
      },

      // Admin
      {
        path: 'admin',
        meta: { requiresAuth: true, requiresAdmin: true },
        children: [
          {
            path: '',
            name: 'admin-dashboard',
            component: () => import('src/pages/admin/AdminDashboardPage.vue'),
          },
          {
            path: 'crear-partido',
            name: 'create-match',
            component: () => import('src/pages/admin/CreateMatchPage.vue'),
          },
          {
            path: 'editar-partido/:id',
            name: 'edit-match',
            component: () => import('src/pages/admin/EditMatchPage.vue'),
          },
        ],
      },

      // Resultado de partido (accesible por cualquier jugador registrado)
      {
        path: 'resultado/:id',
        name: 'post-match',
        component: () => import('src/pages/admin/PostMatchPage.vue'),
        meta: { requiresAuth: true },
      },
    ],
  },

  // ── 404 ───────────────────────────────────────────────────────────────────
  {
    path: '/:catchAll(.*)*',
    component: () => import('src/pages/ErrorNotFound.vue'),
  },
]

export default routes
