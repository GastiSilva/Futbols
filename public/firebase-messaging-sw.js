// public/firebase-messaging-sw.js
// ─────────────────────────────────────────────────────────────────────────────
// Service Worker para recibir notificaciones push FCM en segundo plano.
// Este archivo DEBE estar en la raíz del dominio (/public).
// ─────────────────────────────────────────────────────────────────────────────
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

// Usa los mismos valores de tu firebaseConfig
firebase.initializeApp({
  apiKey: self.VITE_FIREBASE_API_KEY || '__REPLACED_AT_BUILD__',
  authDomain: '__REPLACED_AT_BUILD__',
  projectId: '__REPLACED_AT_BUILD__',
  storageBucket: '__REPLACED_AT_BUILD__',
  messagingSenderId: '__REPLACED_AT_BUILD__',
  appId: '__REPLACED_AT_BUILD__',
})

const messaging = firebase.messaging()

// Maneja mensajes en segundo plano (app minimizada o cerrada)
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification ?? {}
  self.registration.showNotification(title ?? 'Fútbol App', {
    body: body ?? 'Se abrió la lista del partido.',
    icon: icon ?? '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    data: payload.data,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const matchId = event.notification.data?.matchId
  const url = matchId ? `/partidos/${matchId}` : '/'
  event.waitUntil(clients.openWindow(url))
})
