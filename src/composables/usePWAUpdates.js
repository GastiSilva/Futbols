import { ref } from 'vue'
import { useQuasar } from 'quasar'

export function usePWAUpdates() {
  const $q = useQuasar()
  const updateAvailable = ref(false)

  async function checkForUpdates() {
    if (!navigator.serviceWorker) return

    try {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) return

      // Fuerza la búsqueda de actualizaciones
      await registration.update()

      // Si hay un nuevo service worker en espera, notifica al usuario
      if (registration.waiting) {
        updateAvailable.value = true
        showUpdateNotification(registration.waiting)
      }

      // Escucha cambios en el registro
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              updateAvailable.value = true
              showUpdateNotification(newWorker)
            }
          })
        }
      })
    } catch (err) {
      console.error('Error checking for PWA updates:', err)
    }
  }

  function showUpdateNotification(newWorker) {
    $q.notify({
      type: 'positive',
      position: 'top',
      message: '📱 Nueva versión disponible',
      caption: 'La app se actualizará automáticamente',
      timeout: 0,
      actions: [
        {
          label: 'Actualizar ahora',
          color: 'white',
          handler: () => {
            newWorker.postMessage({ type: 'SKIP_WAITING' })
            // Recarga después de que el nuevo SW toma control
            window.location.reload()
          },
        },
      ],
    })

    // Recarga automáticamente después de 30 segundos si el usuario no hace nada
    setTimeout(() => {
      newWorker.postMessage({ type: 'SKIP_WAITING' })
      window.location.reload()
    }, 30000)
  }

  return {
    updateAvailable,
    checkForUpdates,
  }
}
