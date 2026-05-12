import { ref } from 'vue'
import { useQuasar } from 'quasar'

export function usePWAUpdates() {
  const $q = useQuasar()
  const updateAvailable = ref(false)
  let listenerAttached = false
  let updateCheckTimer = null

  async function checkForUpdates() {
    if (!navigator.serviceWorker || listenerAttached) return

    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) return

      // Si ya hay un SW en espera, muestra la notificación
      if (registration.waiting) {
        updateAvailable.value = true
        showUpdateNotification(registration.waiting)
        return
      }

      // Solo escucha updatefound una sola vez
      listenerAttached = true
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Espera un poco para asegurarse que es un cambio real
              clearTimeout(updateCheckTimer)
              updateCheckTimer = setTimeout(() => {
                updateAvailable.value = true
                showUpdateNotification(newWorker)
              }, 1000)
            }
          })
        }
      })

      // Verifica SOLO una vez al inicializar
      await registration.update()
    } catch (err) {
      console.error('Error checking for PWA updates:', err)
    }
  }

  function showUpdateNotification(newWorker) {
    $q.notify({
      type: 'positive',
      position: 'top',
      message: '📱 Nueva versión disponible',
      caption: 'La app será actualizada al cerrar la notificación',
      timeout: 0,
      actions: [
        {
          label: 'Actualizar',
          color: 'white',
          handler: () => {
            newWorker.postMessage({ type: 'SKIP_WAITING' })
            setTimeout(() => window.location.reload(), 500)
          },
        },
        {
          label: 'Después',
          color: 'grey',
          handler: () => {
            // El usuario lo hará después
          },
        },
      ],
    })
  }

  return {
    updateAvailable,
    checkForUpdates,
  }
}
