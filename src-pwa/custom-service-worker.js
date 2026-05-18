/* eslint-env serviceworker */

/*
 * This file (which will be your service worker)
 * is picked up by the build system ONLY if
 * quasar.config.js > pwa > workboxMode is set to "injectManifest"
 */

import { clientsClaim } from 'workbox-core'
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'

self.skipWaiting()
clientsClaim()

// Use with precache injection
precacheAndRoute(self.__WB_MANIFEST)

cleanupOutdatedCaches()

// Non-SSR fallback to index.html
// Production SSR fallback to offline.html (except for dev)
if (process.env.MODE !== 'ssr' || process.env.PROD) {
  registerRoute(
    new NavigationRoute(
      createHandlerBoundToURL(process.env.PWA_FALLBACK_HTML),
      { denylist: [/sw\.js$/, /workbox-(.)*\.js$/, /firebase-messaging-sw\.js$/] }
    )
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Firebase Cloud Messaging (FCM) para notificaciones push en segundo plano
// ────────────────────────────────────────────────────────────────────────────

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

let messagingInstance = null

try {
  firebase.initializeApp({
    apiKey:            '__VITE_FIREBASE_API_KEY__',
    authDomain:        '__VITE_FIREBASE_AUTH_DOMAIN__',
    projectId:         '__VITE_FIREBASE_PROJECT_ID__',
    storageBucket:     '__VITE_FIREBASE_STORAGE_BUCKET__',
    messagingSenderId: '__VITE_FIREBASE_MESSAGING_SENDER_ID__',
    appId:             '__VITE_FIREBASE_APP_ID__',
  })
  messagingInstance = firebase.messaging()
  setupBackgroundHandler(messagingInstance)
} catch (err) {
  console.warn('[FCM] Error initializing Firebase:', err.message)
}

function setupBackgroundHandler(messaging) {
  messaging.onBackgroundMessage((payload) => {
    const { title, body, icon } = payload.notification ?? {}
    self.registration.showNotification(title ?? 'Fútbol App', {
      body: body ?? 'Se abrió la lista del partido.',
      icon: icon ?? '/icons/icon-192x192.png',
      badge: '/icons/icon-128x128.png',
      data: payload.data,
      requireInteraction: true,
    })
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const matchId = event.notification.data?.matchId
  const url = matchId ? `/partidos/${matchId}` : '/'
  event.waitUntil(clients.openWindow(url))
})
