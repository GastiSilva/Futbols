<template>
  <div class="flex flex-center grass-bg q-pa-md" style="min-height: 100vh">
    <div class="text-center full-width" style="max-width: 400px">
      <!-- Logo -->
      <div class="q-mb-lg">
        <q-icon name="sports_soccer" size="72px" color="primary" />
        <div class="text-h4 text-white text-weight-bold q-mt-sm">Futbols</div>
        <div class="text-subtitle2 text-green-3">Organizá tus partidos de fútbol amateur</div>
      </div>

      <!-- Card de login -->
      <q-card class="q-pa-lg" style="width: 100%">
        <q-card-section>
          <div class="text-h6 text-weight-bold q-mb-xs">Iniciar sesión</div>
          <div class="text-body2 text-grey-6 q-mb-lg">
            Usá tu cuenta de Google para continuar
          </div>

          <q-btn
            color="primary"
            unelevated
            size="lg"
            class="full-width pill-btn"
            :loading="loading"
            @click="handleLogin"
          >
            <q-avatar size="24px" class="q-mr-sm bg-white">
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
            </q-avatar>
            Continuar con Google
          </q-btn>

          <div v-if="error" class="text-negative text-caption q-mt-md">
            {{ error }}
          </div>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useAuth } from 'src/composables/useAuth'

const router = useRouter()
const { loginWithGoogle, loading, error } = useAuth()

async function handleLogin() {
  try {
    await loginWithGoogle()
    router.push('/')
  } catch {
    // El error ya está en la ref `error` del composable
  }
}
</script>
