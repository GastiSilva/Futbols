<template>
  <div class="flex flex-center grass-bg q-pa-md" style="min-height: 100vh">
    <div class="text-center full-width" style="max-width: 400px">
      <!-- Logo -->
      <div class="q-mb-lg">
        <q-icon name="sports_soccer" size="72px" color="primary" />
        <div class="text-h4 text-white text-weight-bold q-mt-sm">YASTA</div>
        <div class="text-subtitle2 text-green-3">Organizá tus partidos de fútbol amateur</div>
      </div>

      <!-- Card de login -->
      <q-card class="q-pa-lg text-left" style="width: 100%">
        <q-card-section>
          <div class="text-h6 text-weight-bold q-mb-xs">
            {{ mode === 'register' ? 'Crear cuenta' : 'Iniciar sesión' }}
          </div>
          <div class="text-body2 text-grey-6 q-mb-lg">
            Usá tu cuenta de Google o email para continuar
          </div>

          <!-- Google -->
          <q-btn
            color="primary"
            unelevated
            size="lg"
            class="full-width pill-btn"
            :loading="loading && lastAction === 'google'"
            :disable="loading && lastAction !== 'google'"
            @click="handleGoogleLogin"
          >
            <q-avatar size="24px" class="q-mr-sm bg-white">
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" />
            </q-avatar>
            Continuar con Google
          </q-btn>

          <div class="row items-center q-my-md">
            <q-separator class="col" />
            <div class="text-caption text-grey-6 q-mx-sm">o</div>
            <q-separator class="col" />
          </div>

          <!-- Email / contraseña -->
          <q-form class="column q-gutter-sm" @submit.prevent="handleEmailSubmit">
            <!-- El nombre es obligatorio al crear la cuenta: es con lo que la
                 persona aparece en las listas de anotados. Google ya lo trae;
                 el alta por email no, así que se pide acá. -->
            <q-input
              v-if="mode === 'register'"
              v-model="displayName"
              outlined
              dense
              label="Nombre y apellido"
              autocomplete="name"
              maxlength="60"
              :rules="[
                (val) => !!val?.trim() || 'Ingresá tu nombre',
                (val) => val.trim().length >= 2 || 'El nombre es muy corto',
              ]"
            />
            <q-input
              v-model="email"
              type="email"
              outlined
              dense
              label="Email"
              autocomplete="email"
              :rules="[(val) => !!val || 'Ingresá tu email']"
            />
            <q-input
              v-model="password"
              type="password"
              outlined
              dense
              label="Contraseña"
              :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
              :rules="[(val) => !!val || 'Ingresá tu contraseña']"
            />

            <q-btn
              type="submit"
              color="secondary"
              unelevated
              size="lg"
              class="full-width pill-btn"
              :loading="loading && lastAction === 'email'"
              :disable="loading && lastAction !== 'email'"
            >
              {{ mode === 'register' ? 'Crear cuenta' : 'Ingresar' }}
            </q-btn>
          </q-form>

          <div class="row items-center justify-between q-mt-md">
            <q-btn
              flat
              dense
              no-caps
              size="sm"
              color="grey-7"
              :label="mode === 'register' ? '¿Ya tenés cuenta? Iniciá sesión' : '¿No tenés cuenta? Registrate'"
              @click="toggleMode"
            />
            <q-btn
              v-if="mode === 'login'"
              flat
              dense
              no-caps
              size="sm"
              color="grey-7"
              label="Olvidé mi contraseña"
              @click="handleResetPassword"
            />
          </div>

          <div v-if="error" class="text-negative text-caption q-mt-md">
            {{ error }}
          </div>
          <div v-if="info" class="text-positive text-caption q-mt-md">
            {{ info }}
          </div>
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { useAuth } from 'src/composables/useAuth'

const router = useRouter()
const $q = useQuasar()
const { loginWithGoogle, loginWithEmail, registerWithEmail, resetPassword, loading, error } = useAuth()

const mode = ref('login') // 'login' | 'register'
const email = ref('')
const password = ref('')
const displayName = ref('')
const lastAction = ref(null) // 'google' | 'email' — para saber qué botón mostraba el spinner
const info = ref(null)

function toggleMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  info.value = null
}

// Destino guardado por el guard cuando alguien entró a un link protegido sin
// sesión (típicamente una invitación a un grupo). Se consume una sola vez.
function takePostLoginRedirect() {
  const dest = sessionStorage.getItem('postLoginRedirect')
  sessionStorage.removeItem('postLoginRedirect')
  return dest || '/'
}

async function handleGoogleLogin() {
  lastAction.value = 'google'
  info.value = null
  try {
    await loginWithGoogle()
    router.push(takePostLoginRedirect())
  } catch {
    // El error ya está en la ref `error` del composable
  }
}

async function handleEmailSubmit() {
  if (!email.value || !password.value) return
  if (mode.value === 'register' && !displayName.value.trim()) return
  lastAction.value = 'email'
  info.value = null
  try {
    const dest = takePostLoginRedirect()
    if (mode.value === 'register') {
      await registerWithEmail(email.value, password.value, displayName.value)
      // Cuenta recién creada: el guard del router la intercepta y manda a
      // /verificar-email igual (needsEmailVerification), pero le dejamos
      // dicho a dónde ir después de confirmar el mail. Si venía de una
      // invitación, esa gana: unirse al grupo importa más que completar el
      // perfil, y el perfil lo puede editar cuando quiera.
      sessionStorage.setItem('postVerifyRedirect', dest !== '/' ? dest : '/perfil')
    } else {
      await loginWithEmail(email.value, password.value)
    }
    router.push(dest)
  } catch {
    // El error ya está en la ref `error` del composable
  }
}

async function handleResetPassword() {
  if (!email.value) {
    $q.notify({ type: 'warning', message: 'Ingresá tu email primero para poder enviarte el link.' })
    return
  }
  try {
    await resetPassword(email.value)
    info.value = 'Te enviamos un email para restablecer tu contraseña. Si no lo ves, revisá spam.'
  } catch {
    // El error ya está en la ref `error` del composable
  }
}
</script>
