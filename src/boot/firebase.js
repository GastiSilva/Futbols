// src/boot/firebase.js
// ─────────────────────────────────────────────────────────────────────────────
// Boot file de Quasar: conecta el plugin de Firebase con la app Vue.
// Registra el service worker de FCM si el navegador lo soporta.
// ─────────────────────────────────────────────────────────────────────────────
import { defineBoot } from '#q-app/wrappers'
import { firebaseApp, initMessaging } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

export default defineBoot(async ({ app }) => {
  // Hace el firebaseApp disponible globalmente en la app (opcional)
  app.config.globalProperties.$firebase = firebaseApp

  // Inicializa FCM y registra el SW de manera no-bloqueante
  try {
    await initMessaging()
    if ('serviceWorker' in navigator) {
      await navigator.serviceWorker.register('/firebase-messaging-sw.js')
    }
  } catch (err) {
    console.warn('[FCM] Service worker no disponible:', err.message)
  }
})
