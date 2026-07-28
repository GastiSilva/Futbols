// src/boot/firebase.js
import { boot } from 'quasar/wrappers'
import { Notify } from 'quasar'
import { firebaseApp, initMessaging } from 'src/services/firebase'
import { getToken, onMessage } from 'firebase/messaging'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, setDoc, serverTimestamp, arrayUnion } from 'firebase/firestore'
import { auth, db } from 'src/services/firebase'

export default boot(({ app }) => {
  app.config.globalProperties.$firebase = firebaseApp
  initFCMInBackground()
})

async function initFCMInBackground() {
  try {
    if (!('serviceWorker' in navigator)) {
      return
    }

    const messagingInstance = await initMessaging()
    if (!messagingInstance) {
      return
    }

    // Esperar a que el SW esté listo (se registra automáticamente vía Quasar PWA)
    const swReg = await navigator.serviceWorker.ready

    // Registrar handler para mensajes en FOREGROUND
    onMessage(messagingInstance, (payload) => {
      const { title, body } = payload.notification ?? {}
      if (swReg.active) {
        swReg.active.postMessage({
          type: 'FCM_MESSAGE',
          payload,
        })
      }
      // Mostrar notificación
      swReg.showNotification(title ?? '⚽ YASTA', {
        body: body ?? 'Tienes un nuevo mensaje',
        icon: '/icons/brazuca.png',       // pelota de futbol
        badge: '/icons/icon-128x128.png',
        data: payload.data,
      })
    })

    // Escuchar cambios de auth
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        return
      }

      try {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          return
        }

        const token = await getToken(messagingInstance, {
          vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: swReg,
        })

        if (!token) {
          return
        }

        // Guardar token con updatedAt para cumplir con las reglas
        await setDoc(doc(db, 'users', user.uid), {
          fcmToken: token,
          fcmTokens: arrayUnion(token),
          updatedAt: serverTimestamp(),
        }, { merge: true })

        Notify.create({
          type: 'positive',
          message: '🔔 Notificaciones activadas',
          caption: 'Recibirás avisos de partidos',
          timeout: 4000,
          position: 'top',
        })
      } catch (err) {
        console.error('[FCM:ERROR]', err)
        Notify.create({
          type: 'warning',
          message: '⚠️ No se pudo activar notificaciones',
          caption: err.message,
          timeout: 6000,
          position: 'top',
        })
      }
    })
  } catch (err) {
    console.error('[FCM:INIT] Error fatal inicializando FCM:', err)
  }
}