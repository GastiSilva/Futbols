// src/boot/firebase.js
import { boot } from 'quasar/wrappers'
import { firebaseApp, initMessaging } from 'src/services/firebase'
import { getToken } from 'firebase/messaging'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from 'src/services/firebase'

export default boot(({ app }) => {
  app.config.globalProperties.$firebase = firebaseApp
  // NO es async — la app renderiza inmediatamente
  // FCM se inicializa en segundo plano
  initFCMInBackground()
})

async function initFCMInBackground() {
  try {
    if (!('serviceWorker' in navigator)) return
    const messagingInstance = await initMessaging()
    if (!messagingInstance) return

    // Esperar a que el SW esté listo (se registra automáticamente vía Quasar PWA)
    const swReg = await navigator.serviceWorker.ready

    onAuthStateChanged(auth, async (user) => {
      if (!user) return
      try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return

        const token = await getToken(messagingInstance, {
          vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: swReg,
        })
        if (token) {
          await updateDoc(doc(db, 'users', user.uid), { fcmToken: token })
        }
      } catch (err) {
        console.warn('[FCM] Error al obtener/guardar token:', err.message)
      }
    })
  } catch (err) {
    console.warn('[FCM] SW no disponible:', err.message)
  }
}