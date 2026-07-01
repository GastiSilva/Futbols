// src/composables/useAuth.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable de autenticación con Google.
// Gestiona el flujo de login/logout y sincroniza el perfil en Firestore.
// ─────────────────────────────────────────────────────────────────────────────
import { ref, computed } from 'vue'
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  getIdTokenResult,
} from 'firebase/auth'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { auth, googleProvider, db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

export function useAuth() {
  const authStore = useAuthStore()
  const loading = ref(false)
  const error = ref(null)

  // ── Estado derivado ────────────────────────────────────────────────────────
  const user = computed(() => authStore.user)
  const isAdmin = computed(() => authStore.isAdmin)
  const isAuthenticated = computed(() => authStore.isAuthenticated)

  // ── Login con Google ───────────────────────────────────────────────────────
  async function loginWithGoogle() {
    loading.value = true
    error.value = null
    try {
      const result = await signInWithPopup(auth, googleProvider)
      await syncUserProfile(result.user)
    } catch (err) {
      // Ignorar cancelaciones del popup
      if (err.code !== 'auth/popup-closed-by-user') {
        error.value = err.message
        throw err
      }
    } finally {
      loading.value = false
    }
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  async function logout() {
    loading.value = true
    try {
      await signOut(auth)
      authStore.clearUser()
    } finally {
      loading.value = false
    }
  }

  // ── Escucha cambios de sesión (llamar una vez en App.vue o boot) ───────────
  function initAuthListener() {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Verifica si el usuario tiene custom claim 'admin'
        const tokenResult = await getIdTokenResult(firebaseUser, true)
        const userRef = doc(db, 'users', firebaseUser.uid)
        let userDoc = await getDoc(userRef)

        // Si el documento no existe (trigger falló o primer login), lo creamos AHORA
        if (!userDoc.exists()) {
          await setDoc(userRef, {
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName,
            email: firebaseUser.email,
            photoURL: firebaseUser.photoURL,
            fcmToken: null,
            role: 'player',
            stats: defaultStats(),
            statsByGroup: {},
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
          userDoc = await getDoc(userRef)
        }

        const userData = userDoc.data()
        authStore.setUser({
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName,
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL,
          isAdmin: tokenResult.claims.admin === true,
          role: userData.role ?? 'player',
          stats: userData.stats ?? defaultStats(),
          statsByGroup: userData.statsByGroup ?? {},
        })
      } else {
        authStore.clearUser()
      }
    })
  }

  // ── Sincroniza / crea el perfil en Firestore ───────────────────────────────
  async function syncUserProfile(firebaseUser) {
    const userRef = doc(db, 'users', firebaseUser.uid)
    const snap = await getDoc(userRef)

    if (!snap.exists()) {
      // Primera vez: crea el documento con stats vacías y rol 'player'
      await setDoc(userRef, {
        uid: firebaseUser.uid,
        displayName: firebaseUser.displayName,
        email: firebaseUser.email,
        photoURL: firebaseUser.photoURL,
        fcmToken: null,
        role: 'player',
        stats: defaultStats(),
        statsByGroup: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } else {
      // Actualiza foto y nombre por si cambiaron en Google
      await setDoc(
        userRef,
        {
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
    }
  }

  function defaultStats() {
    return { goals: 0, assists: 0, matchesPlayed: 0 }
  }

  return {
    user,
    isAdmin,
    isAuthenticated,
    loading,
    error,
    loginWithGoogle,
    logout,
    initAuthListener,
  }
}
