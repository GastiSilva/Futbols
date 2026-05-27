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
  console.log('[BOOT] 🚀 Firebase boot iniciado')
  initFCMInBackground()
})

async function initFCMInBackground() {
  console.log('[FCM:INIT] ↳ Iniciando FCM en background...')
  
  try {
    if (!('serviceWorker' in navigator)) {
      console.error('[FCM:INIT] ❌ Service Worker NO disponible en este navegador')
      return
    }
    console.log('[FCM:INIT] ✓ Service Worker API disponible')

    const messagingInstance = await initMessaging()
    if (!messagingInstance) {
      console.error('[FCM:INIT] ❌ FCM no soportado (probablemente no es HTTPS o PWA)')
      return
    }
    console.log('[FCM:INIT] ✓ Messaging instance creada')

    // Esperar a que el SW esté listo (se registra automáticamente vía Quasar PWA)
    console.log('[FCM:INIT] ⏳ Esperando Service Worker...')
    const swReg = await navigator.serviceWorker.ready
    console.log('[FCM:INIT] ✓ Service Worker listo:', swReg.scope)

    // Registrar handler para mensajes en FOREGROUND
    onMessage(messagingInstance, (payload) => {
      console.log('[FCM:MSG] 📨 Mensaje en foreground:', payload)
      const { title, body } = payload.notification ?? {}
      if (swReg.active) {
        swReg.active.postMessage({
          type: 'FCM_MESSAGE',
          payload,
        })
      }
      // Mostrar notificación
      swReg.showNotification(title ?? '⚽ Futbols', {
        body: body ?? 'Tienes un nuevo mensaje',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-128x128.png',
        data: payload.data,
      })
    })
    console.log('[FCM:INIT] ✓ Foreground handler registrado')

    // Escuchar cambios de auth
    onAuthStateChanged(auth, async (user) => {
      console.log('[FCM:AUTH] 👤 Auth state changed:', user?.uid ?? 'NO AUTENTICADO')
      
      if (!user) {
        console.log('[FCM:AUTH] ⚠️ Usuario no autenticado, skipping FCM token setup')
        return
      }

      try {
        console.log('[FCM:TOKEN] ⏳ Pidiendo permiso de notificaciones...')
        const permission = await Notification.requestPermission()
        console.log('[FCM:TOKEN] 📍 Permiso de notificaciones:', permission)
        
        if (permission !== 'granted') {
          console.warn('[FCM:TOKEN] ❌ Usuario rechazó notificaciones')
          return
        }

        
        console.log('[FCM:TOKEN] ⏳ Obteniendo FCM token...')
        const token = await getToken(messagingInstance, {
          vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: swReg,
        })
                // const registration = await navigator.serviceWorker.getRegistration();
        // console.log('[FCM:TOKEN] ⏳ Obteniendo FCM token...')
        // const token = await getToken(messagingInstance, {
        //   vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
        //   serviceWorkerRegistration: registration,
        // })


        if (!token) {
          console.error('[FCM:TOKEN] ❌ getToken() retornó vacío/null')
          return
        }

        console.log('[FCM:TOKEN] ✓ Token FCM obtenido (completo):', token)

        // Guardar token con updatedAt para cumplir con las reglas
        console.log('[FCM:SAVE] ⏳ Guardando token en Firestore...')
        await setDoc(doc(db, 'users', user.uid), {
          fcmToken: token,
          fcmTokens: arrayUnion(token),
          updatedAt: serverTimestamp(),
        }, { merge: true })

        console.log('[FCM:SAVE] ✅ Token guardado exitosamente en Firestore')
        Notify.create({
          type: 'positive',
          message: '🔔 Notificaciones activadas',
          caption: 'Recibirás avisos de partidos',
          timeout: 4000,
          position: 'top',
        })
      } catch (err) {
        console.error('[FCM:ERROR] ❌ Error completo:', {
          message: err.message,
          code: err.code,
          stack: err.stack,
        })
        Notify.create({
          type: 'warning',
          message: '⚠️ No se pudo activar notificaciones',
          caption: err.message,
          timeout: 6000,
          position: 'top',
        })
      }
    })
    
    console.log('[FCM:INIT] ✓ Listener de auth configurado')
  } catch (err) {
    console.error('[FCM:INIT] ❌ Error fatal inicializando FCM:', err.message, err)
  }
}