/* eslint-env serviceworker */
/* global firebase */
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
    apiKey:            'AIzaSyAU2RboXYq3ljfBXoho1z9DlLRfaJbFCms',
    authDomain:        'listasfutbol-23089.firebaseapp.com',
    projectId:         'listasfutbol-23089',
    storageBucket:     'listasfutbol-23089.firebasestorage.app',
    messagingSenderId: '517714259072',
    appId:             '1:517714259072:web:b05c8932d0d21128e10a65',
  })
  messagingInstance = firebase.messaging()
} catch (err) {
  console.warn('[FCM] Error initializing Firebase:', err.message)
}

if (messagingInstance) {
  messagingInstance.onBackgroundMessage((payload) => {
    try {
      const { title, body, icon } = payload.notification ?? {}
      self.registration.showNotification(title ?? 'Fútbol App', {
        body:              body ?? 'Se abrió la lista del partido.',
        icon:              icon ?? '/icons/icon-192x192.png',
        badge:             '/icons/icon-128x128.png',
        data:              payload.data ?? {},
        requireInteraction: true,
      })
    } catch (err) {
      console.error('[FCM] Error showing notification:', err)
    }
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const matchId = event.notification.data?.matchId
  const url = matchId ? `/partidos/${matchId}` : '/'
  event.waitUntil(
    clients.openWindow(url).catch((err) => console.error('[FCM] Error opening window:', err))
  )
})
