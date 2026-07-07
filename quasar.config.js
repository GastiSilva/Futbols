// quasar.config.js
import { configure } from 'quasar/wrappers'

export default configure(function (/* ctx */) {
  return {
    eslint: { fix: true },

    // ── Boot files ──────────────────────────────────────────────────────────
    boot: ['pinia', 'firebase'],

    // ── CSS global ──────────────────────────────────────────────────────────
    css: ['app.scss'],

    // ── Extras de Quasar ────────────────────────────────────────────────────
    extras: [
      'material-icons',
      'roboto-font',
    ],

    // ── Build ───────────────────────────────────────────────────────────────
    build: {
      vueRouterMode: 'history',
    },

    // ── Dev server ──────────────────────────────────────────────────────────
    devServer: { open: true },

    // ── Quasar plugins & componentes ────────────────────────────────────────
    framework: {
      config: {
        // Tema oscuro tipo "pitch at night": fondo casi negro + acento verde césped neón.
        dark: true,
        brand: {
          primary:   '#4ADE80',  // verde césped neón — acento principal (CTAs, activo, íconos)
          secondary: '#16A34A',  // verde más profundo — apoyo secundario
          accent:    '#FBBF24',  // dorado — medallas / destacados
          dark:      '#141B17',  // superficie de componentes (cards, drawer, dialogs)
          'dark-page': '#0A0F0D', // fondo de página
          positive:  '#4ADE80',
          negative:  '#FF5470',
          info:      '#38BDF8',
          warning:   '#FBBF24',
        },
        notify: { position: 'top', timeout: 3000 },
        loading: {},
      },
      plugins: ['Notify', 'Loading', 'Dialog'],
    },

    // ── PWA ─────────────────────────────────────────────────────────────────
    pwa: {
      workboxMode: 'InjectManifest',
      injectPwaMetaTags: true,
      swFilename: 'sw.js',
      manifestFilename: 'manifest.json',
      useCredentialsForManifestTag: false,

      // skipWaiting y clientsClaim se llaman directamente en custom-service-worker.js

      manifest: {
        name: 'Futbols',
        short_name: 'Futbols',
        description: 'Organizá tus partidos de fútbol con amigos',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0A0F0D',
        theme_color: '#0A0F0D',
        icons: [
          { src: 'icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
          { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icons/icon-256x256.png', sizes: '256x256', type: 'image/png' },
          { src: 'icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    },
  }
})
