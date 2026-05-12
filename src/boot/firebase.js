// src/boot/firebase.js
import { boot } from 'quasar/wrappers'
import { firebaseApp, initMessaging } from 'src/services/firebase'
import { getToken } from 'firebase/messaging'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from 'src/services/firebase'

export default boot(async ({ app }) => {
  app.config.globalProperties.$firebase = firebaseApp

  try {
    const messagingInstance = await initMessaging()

    if (messagingInstance && 'serviceWorker' in navigator) {
      // Registrar el SW de FCM
      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js')

      // Cuando el usuario se autentique, pedir permiso y guardar el token FCM
      onAuthStateChanged(auth, async (user) => {
        if (!user || !messagingInstance) return
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
          console.warn('[FCM] No se pudo obtener el token:', err.message)
        }
      })
    }
  } catch (err) {
    console.warn('[FCM] Service worker no disponible:', err.message)
  }
})