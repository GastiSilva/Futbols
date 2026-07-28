/* eslint-env serviceworker */
/*
 * This file (which will be your service worker)
 * is picked up by the build system ONLY if
 * quasar.config.js > pwa > workboxMode is set to "injectManifest"
 */

import { clientsClaim } from 'workbox-core'
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'

clientsClaim()

// Use with precache injection
precacheAndRoute(self.__WB_MANIFEST)

cleanupOutdatedCaches()

// NO se llama self.skipWaiting() acá arriba a propósito: si se llama sin
// condición, CADA vez que se detecta un SW nuevo se activa solo y fuerza un
// reload automático (ver App.vue) sin que el usuario haga nada — eso es lo
// que causaba que la app pareciera "pedir actualizar todo el tiempo" al
// recargar. En cambio se espera este mensaje, que el botón "Actualizar
// ahora" (App.vue) manda recién cuando el usuario confirma.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// Non-SSR fallback to index.html
if (process.env.MODE !== 'ssr' || process.env.PROD) {
  registerRoute(
    new NavigationRoute(
      createHandlerBoundToURL(process.env.PWA_FALLBACK_HTML),
      { denylist: [/sw\.js$/, /workbox-(.)*\.js$/, /firebase-messaging-sw\.js$/] }
    )
  )
}

// ── Push notifications — sin CDN, maxima compatibilidad movil ────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return

  let title = '⚽ YASTA'
  let body  = 'Tenes un nuevo mensaje'
  let data  = {}

  try {
    const payload = event.data.json()
    title = payload.notification?.title ?? payload.data?.title ?? title
    body  = payload.notification?.body  ?? payload.data?.body  ?? body
    data  = payload.data ?? {}
  } catch {
    // payload no es JSON valido, usamos defaults
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/icons/brazuca.png',       // pelota de futbol
      badge: '/icons/icon-128x128.png',
      data,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const matchId = event.notification.data?.matchId
  const url = matchId ? `/partidos/${matchId}` : '/'
  event.waitUntil(
    clients.openWindow(url).catch((err) => console.error('[SW] Error opening window:', err))
  )
})