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
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  collectionGroup,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore'
import { auth, googleProvider, db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'
import { normalizePositions } from 'src/utils/positions'

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
            nickname: null,
            description: '',
            preferredFoot: null,
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
          nickname: userData.nickname ?? null,
          description: userData.description ?? '',
          preferredFoot: userData.preferredFoot ?? null,
          stats: { ...defaultStats(), ...(userData.stats ?? {}) },
          statsByGroup: userData.statsByGroup ?? {},
        })

        // Carga los grupos con acceso anticipado (OG u owner/admin del grupo)
        await loadOgGroups(firebaseUser.uid)
      } else {
        authStore.clearUser()
      }
    })
  }

  // ── Grupos del usuario: membresía completa + cuáles dan ACCESO ANTICIPADO ──
  // Una sola query collectionGroup sobre members filtrando por userId. De ahí
  // se derivan dos listas: todos los grupos (membresía, para filtrar qué
  // partidos ve/puede jugar) y los que dan acceso anticipado (OG u owner/admin,
  // filtrado en cliente para no requerir un índice compuesto).
  async function loadOgGroups(uid) {
    try {
      const snaps = await getDocs(
        query(collectionGroup(db, 'members'), where('userId', '==', uid)),
      )
      const allIds = []
      const ogIds = []
      snaps.docs.forEach((d) => {
        const m = d.data()
        const groupId = d.ref.parent.parent.id
        allIds.push(groupId)
        if (m.og === true || ['owner', 'admin'].includes(m.role)) {
          ogIds.push(groupId)
        }
      })
      authStore.setMemberGroups(allIds)
      authStore.setOgGroups(ogIds)
    } catch (err) {
      // No bloquea el login si falla; simplemente no hay acceso anticipado
      authStore.setMemberGroups([])
      authStore.setOgGroups([])
      console.error('No se pudieron cargar los grupos del usuario:', err)
    }
  }

  // ── Actualizar el perfil editable del usuario (apodo, descripción, pie) ────
  async function updateUserProfile({ nickname, description, preferredFoot, preferredPositions }) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('Usuario no autenticado')

    const fields = {
      nickname: (nickname ?? '').trim() || null,
      description: (description ?? '').trim(),
      preferredFoot: preferredFoot ?? null,
      preferredPositions: normalizePositions(preferredPositions),
    }

    await updateDoc(doc(db, 'users', uid), {
      ...fields,
      updatedAt: serverTimestamp(),
    })
    authStore.patchUser(fields)
    return fields
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
        preferredPositions: [],
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
    return { goals: 0, assists: 0, matchesPlayed: 0, mvps: 0, wins: 0, draws: 0, losses: 0 }
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
    updateUserProfile,
  }
}
