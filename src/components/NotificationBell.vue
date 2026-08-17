<template>
  <div v-if="!authStore.isGuest">
    <q-btn flat dense round icon="notifications" aria-label="Notificaciones">
      <q-menu anchor="bottom right" self="top right" :offset="[0, 8]" @show="loadPrefs">
        <q-card flat style="min-width: 300px; max-width: 340px">
          <q-card-section class="q-pb-none">
            <div class="text-subtitle2 text-weight-bold">Notificaciones</div>
            <div class="text-caption text-grey-7">Elegí qué avisos querés recibir.</div>
          </q-card-section>

          <q-list separator class="q-mt-sm">
            <q-item v-for="opt in NOTIFICATION_OPTIONS" :key="opt.key" tag="label" v-ripple dense>
              <q-item-section>
                <q-item-label class="text-body2">{{ opt.label }}</q-item-label>
                <q-item-label caption>{{ opt.description }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <q-toggle
                  :model-value="prefs[opt.key]"
                  color="primary"
                  dense
                  :disable="saving"
                  @update:model-value="(val) => handleToggle(opt.key, val)"
                />
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </q-menu>
    </q-btn>
  </div>
</template>

<script setup>
// Campanita de notificaciones en el header. Reemplaza al bloque grande que
// vivía desplegado dentro de ProfilePage — mismos 4 toggles, mismo
// composable, pero en un popup chico que no ocupa espacio fijo en ninguna
// pantalla. Un invitado anónimo no tiene notificationPrefs (no tiene doc de
// perfil propio), así que ni se muestra.
import { ref } from 'vue'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'
import { useAuthStore } from 'src/stores/auth.store'
import { NOTIFICATION_OPTIONS, withNotificationDefaults } from 'src/utils/notifications'

const $q = useQuasar()
const { updateNotificationPref } = useAuth()
const authStore = useAuthStore()

const prefs = ref(withNotificationDefaults(null))
const saving = ref(false)

function loadPrefs() {
  prefs.value = withNotificationDefaults(authStore.user?.notificationPrefs)
}

async function handleToggle(category, value) {
  const previous = prefs.value[category]
  prefs.value = { ...prefs.value, [category]: value }
  saving.value = true
  try {
    await updateNotificationPref(category, value)
  } catch (err) {
    prefs.value = { ...prefs.value, [category]: previous }
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    saving.value = false
  }
}
</script>
