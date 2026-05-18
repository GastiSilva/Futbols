// quasar.config.js
import { configure } from 'quasar/wrappers'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

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
      target: { browser: ['es2019', 'edge88', 'firefox78', 'chrome87', 'safari13.1'] },
      vueRouterMode: 'history',

      // Expone variables de entorno al cliente
      env: {
        VITE_FIREBASE_API_KEY:            process.env.VITE_FIREBASE_API_KEY,
        VITE_FIREBASE_AUTH_DOMAIN:        process.env.VITE_FIREBASE_AUTH_DOMAIN,
        VITE_FIREBASE_PROJECT_ID:         process.env.VITE_FIREBASE_PROJECT_ID,
        VITE_FIREBASE_STORAGE_BUCKET:     process.env.VITE_FIREBASE_STORAGE_BUCKET,
        VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        VITE_FIREBASE_APP_ID:             process.env.VITE_FIREBASE_APP_ID,
        VITE_FIREBASE_MEASUREMENT_ID:     process.env.VITE_FIREBASE_MEASUREMENT_ID,
        VITE_FIREBASE_VAPID_KEY:          process.env.VITE_FIREBASE_VAPID_KEY,
      },

      // Inyecta la config de Firebase real en el SW de FCM después del build
      extendViteConf(viteConf) {
        viteConf.plugins = viteConf.plugins ?? []
        viteConf.plugins.push({
          name: 'inject-firebase-sw-config',
          apply: 'build',
          closeBundle() {
            const swPath = resolve('dist/pwa/sw.js')
            try {
              let content = readFileSync(swPath, 'utf-8')
              content = content
                .replace(`'__VITE_FIREBASE_API_KEY__'`,            `'${process.env.VITE_FIREBASE_API_KEY}'`)
                .replace(`'__VITE_FIREBASE_AUTH_DOMAIN__'`,        `'${process.env.VITE_FIREBASE_AUTH_DOMAIN}'`)
                .replace(`'__VITE_FIREBASE_PROJECT_ID__'`,         `'${process.env.VITE_FIREBASE_PROJECT_ID}'`)
                .replace(`'__VITE_FIREBASE_STORAGE_BUCKET__'`,     `'${process.env.VITE_FIREBASE_STORAGE_BUCKET}'`)
                .replace(`'__VITE_FIREBASE_MESSAGING_SENDER_ID__'`,`'${process.env.VITE_FIREBASE_MESSAGING_SENDER_ID}'`)
                .replace(`'__VITE_FIREBASE_APP_ID__'`,             `'${process.env.VITE_FIREBASE_APP_ID}'`)
              writeFileSync(swPath, content)
              console.log('[inject-firebase-sw-config] sw.js configurado correctamente')
            } catch (e) {
              console.warn('[inject-firebase-sw-config] Error:', e.message)
            }
          },
        })
      },
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
      workboxMode: 'GenerateSW',
      injectPwaMetaTags: true,
      swFilename: 'sw.js',
      manifestFilename: 'manifest.json',
      useCredentialsForManifestTag: false,

      extendGenerateSWOptions(cfg) {
        cfg.skipWaiting = true
        cfg.clientsClaim = true
      },

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
