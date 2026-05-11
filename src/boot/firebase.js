// src/boot/firebase.js
import { boot } from 'quasar/wrappers'
import { firebaseApp, initMessaging } from 'src/services/firebase'

export default boot(async ({ app }) => {
  // Hace el firebaseApp disponible globalmente en la app
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