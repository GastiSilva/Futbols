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
        brand: {
          primary:   '#2e7d32',  // green-8
          secondary: '#558b2f',
          accent:    '#f9a825',
          dark:      '#1d1d1d',
          positive:  '#21ba45',
          negative:  '#c10015',
          info:      '#31ccec',
          warning:   '#f2c037',
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
        background_color: '#ffffff',
        theme_color: '#2e7d32',
        icons: [
          { src: 'icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
          { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-256x256.png', sizes: '256x256', type: 'image/png' },
          { src: 'icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    },
  }
})
