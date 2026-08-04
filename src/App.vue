<template>
  <router-view />

  <!-- Banner de actualización disponible -->
  <q-banner
    v-if="updateReady"
    class="bg-green-9 text-white shadow-4"
    style="position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;"
    dense
  >
    <template #avatar>
      <q-icon name="system_update" color="white" />
    </template>
    ¡Nueva versión disponible!
    <template #action>
      <q-btn flat color="white" label="Actualizar ahora" @click="applyUpdate" />
    </template>
  </q-banner>

  <!-- Banner de instalación PWA (solo si el navegador ofreció el prompt) -->
  <q-banner
    v-else-if="showInstallBanner"
    class="bg-primary text-white shadow-4"
    style="position: fixed; bottom: 0; left: 0; right: 0; z-index: 9998;"
    dense
  >
    <template #avatar>
      <q-icon name="install_mobile" color="white" />
    </template>
    Instalá la app para acceder más rápido y recibir notificaciones.
    <template #action>
      <q-btn flat color="white" label="Ahora no" @click="dismissInstallBanner" />
      <q-btn flat color="white" label="Instalar" @click="promptInstall" />
    </template>
  </q-banner>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAuth } from 'src/composables/useAuth'
import { useQuasar } from 'quasar'

const $q = useQuasar()
const updateReady = ref(false)
let waitingWorker = null
let updateListenerRegistered = false

// ── Instalación de la PWA (prompt "Agregar a pantalla de inicio") ───────────
const INSTALL_DISMISSED_KEY = 'pwaInstallDismissedAt'
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000 // 14 días
const showInstallBanner = ref(false)
let deferredInstallPrompt = null

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true // iOS Safari
}

function recentlyDismissed() {
  const ts = parseInt(localStorage.getItem(INSTALL_DISMISSED_KEY) || '0', 10)
  return Date.now() - ts < DISMISS_COOLDOWN_MS
}

async function promptInstall() {
  showInstallBanner.value = false
  if (!deferredInstallPrompt) return
  deferredInstallPrompt.prompt()
  await deferredInstallPrompt.userChoice
  deferredInstallPrompt = null
}

function dismissInstallBanner() {
  showInstallBanner.value = false
  localStorage.setItem(INSTALL_DISMISSED_KEY, Date.now().toString())
}

onMounted(() => {
  const { initAuthListener } = useAuth()
  initAuthListener()

  // Chrome/Android dispara este evento cuando la PWA es instalable — lo
  // "guardamos" y evitamos el mini-infobar automático del navegador para
  // mostrar nuestro propio banner, con el mismo estilo que el de actualización.
  if (!isStandalone() && !recentlyDismissed()) {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      deferredInstallPrompt = e
      showInstallBanner.value = true
    })
  }

  window.addEventListener('appinstalled', () => {
    showInstallBanner.value = false
    deferredInstallPrompt = null
  })

  if ('serviceWorker' in navigator) {
    // Cuando el SW toma control (skipWaiting activado), recarga la página automáticamente
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    })

    // Registrar listeners solo UNA VEZ (no en cada mount)
    if (!updateListenerRegistered) {
      updateListenerRegistered = true

      navigator.serviceWorker.ready.then((reg) => {
        // Listener para futuras actualizaciones
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Ignora si fue hace menos de 3 segundos (probablemente un refresh de la página)
              const lastReloadTime = sessionStorage.getItem('lastPageReload')
              const timeSinceReload = Date.now() - parseInt(lastReloadTime || 0)

              if (timeSinceReload > 3000) {
                waitingWorker = newWorker
                updateReady.value = true
              }
            }
          })
        })

        // Verificar si ya hay un SW esperando (actualización pendiente previa)
        if (reg.waiting && navigator.serviceWorker.controller) {
          waitingWorker = reg.waiting
          updateReady.value = true
        }
      })

      // Registra el timestamp del último reload
      sessionStorage.setItem('lastPageReload', Date.now().toString())
    }
  }
})

function applyUpdate() {
  waitingWorker?.postMessage({ type: 'SKIP_WAITING' })
  updateReady.value = false
}
</script>