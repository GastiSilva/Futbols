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
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useAuth } from 'src/composables/useAuth'
import { useQuasar } from 'quasar'

const $q = useQuasar()
const updateReady = ref(false)
let waitingWorker = null

onMounted(() => {
  const { initAuthListener } = useAuth()
  initAuthListener()

  if ('serviceWorker' in navigator) {
    // Cuando el SW toma control (skipWaiting activado), recarga la página automáticamente
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    })

    // Detectar cuando hay un SW nuevo esperando (para mostrar el banner)
    navigator.serviceWorker.ready.then((reg) => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        newWorker?.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = newWorker
            updateReady.value = true
          }
        })
      })

      // Verificar si ya hay un SW esperando
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingWorker = reg.waiting
        updateReady.value = true
      }
    })
  }
})

function applyUpdate() {
  waitingWorker?.postMessage({ type: 'SKIP_WAITING' })
  updateReady.value = false
}
</script>