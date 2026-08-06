<template>
  <div class="flex flex-center grass-bg q-pa-md" style="min-height: 100vh">
    <div class="text-center full-width" style="max-width: 400px">
      <!-- Logo -->
      <div class="q-mb-lg">
        <q-icon name="mark_email_unread" size="72px" color="primary" />
        <div class="text-h4 text-white text-weight-bold q-mt-sm">YASTA</div>
        <div class="text-subtitle2 text-green-3">Confirmá tu email para empezar a jugar</div>
      </div>

      <q-card class="q-pa-lg text-left" style="width: 100%">
        <q-card-section>
          <div class="text-h6 text-weight-bold q-mb-xs">Revisá tu bandeja de entrada</div>
          <div class="text-body2 text-grey-6 q-mb-md">
            Te enviamos un link de confirmación a
            <strong class="text-white">{{ user?.email }}</strong>. Abrilo y después volvé acá.
          </div>

          <q-banner dense rounded class="bg-amber-1 text-amber-9 text-caption q-mb-md">
            <template #avatar>
              <q-icon name="info" color="amber-8" />
            </template>
            Si no lo ves en unos minutos, revisá la carpeta de <strong>Spam</strong> o "Promociones".
          </q-banner>

          <q-btn
            color="primary"
            unelevated
            size="lg"
            class="full-width pill-btn q-mb-sm"
            :loading="checking"
            label="Ya confirmé, continuar"
            @click="handleCheck"
          />
          <q-btn
            flat
            no-caps
            dense
            color="grey-7"
            class="full-width"
            :loading="resending"
            :disable="resendCooldown > 0"
            :label="resendCooldown > 0 ? `Reenviar (${resendCooldown}s)` : 'Reenviar email'"
            @click="handleResend"
          />

          <div class="row items-center justify-center q-mt-md">
            <q-btn
              flat
              dense
              no-caps
              size="sm"
              color="grey-7"
              label="Cerrar sesión"
              @click="handleLogout"
            />
          </div>

          <div v-if="error" class="text-negative text-caption q-mt-md">{{ error }}</div>
          <div v-if="info" class="text-positive text-caption q-mt-md">{{ info }}</div>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from 'src/composables/useAuth'

const router = useRouter()
const { user, refreshEmailVerified, resendVerificationEmail, logout } = useAuth()

const checking = ref(false)
const resending = ref(false)
const error = ref(null)
const info = ref(null)
const resendCooldown = ref(0)
let cooldownTimer = null

async function handleCheck() {
  checking.value = true
  error.value = null
  try {
    const verified = await refreshEmailVerified()
    if (verified) {
      const redirect = sessionStorage.getItem('postVerifyRedirect')
      sessionStorage.removeItem('postVerifyRedirect')
      router.push(redirect || '/')
    } else {
      error.value = 'Todavía no confirmaste el email. Revisá tu bandeja de entrada (y spam).'
    }
  } catch {
    error.value = 'No pudimos verificar el estado. Intentá de nuevo.'
  } finally {
    checking.value = false
  }
}

async function handleResend() {
  resending.value = true
  error.value = null
  info.value = null
  try {
    await resendVerificationEmail()
    info.value = 'Te reenviamos el email de confirmación.'
    resendCooldown.value = 30
    cooldownTimer = setInterval(() => {
      resendCooldown.value -= 1
      if (resendCooldown.value <= 0) clearInterval(cooldownTimer)
    }, 1000)
  } catch {
    error.value = 'No pudimos reenviar el email. Probá de nuevo en unos minutos.'
  } finally {
    resending.value = false
  }
}

async function handleLogout() {
  await logout()
  router.push('/login')
}

onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})
</script>
