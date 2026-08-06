// src/composables/useAuth.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable de autenticación con Google.
// Gestiona el flujo de login/logout y sincroniza el perfil en Firestore.
// ─────────────────────────────────────────────────────────────────────────────
import { ref, computed } from 'vue'
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
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
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { auth, googleProvider, db, storage } from 'src/services/firebase'
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
      // Espera a que el store quede hidratado ANTES de resolver: si el
      // caller navega apenas termina esta promesa (LoginPage hace
      // router.push('/') a continuación), el guard del router necesita
      // ver authStore.isAuthenticated === true de una. Antes de este fix,
      // eso dependía de que onAuthStateChanged (listener aparte, async)
      // llegara a tiempo — si perdía la carrera, el guard rebotaba a
      // /login y recién en el segundo intento (con el listener ya
      // resuelto) entraba. Por eso "había que tocar dos veces".
      await hydrateUserFromFirebase(result.user)
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

  // ── Registro con email y contraseña ────────────────────────────────────────
  async function registerWithEmail(email, password) {
    loading.value = true
    error.value = null
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password)
      await sendEmailVerification(result.user)
      await syncUserProfile(result.user)
      await hydrateUserFromFirebase(result.user)
    } catch (err) {
      error.value = mapAuthError(err.code)
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Reenvía el email de verificación (desde la pantalla de espera) ─────────
  async function resendVerificationEmail() {
    if (!auth.currentUser) throw new Error('Usuario no autenticado')
    await sendEmailVerification(auth.currentUser)
  }

  // ── Refresca emailVerified tras volver del link del mail ───────────────────
  async function refreshEmailVerified() {
    if (!auth.currentUser) return false
    await auth.currentUser.reload()
    await hydrateUserFromFirebase(auth.currentUser)
    return auth.currentUser.emailVerified
  }

  // ── Login con email y contraseña ───────────────────────────────────────────
  async function loginWithEmail(email, password) {
    loading.value = true
    error.value = null
    try {
      const result = await signInWithEmailAndPassword(auth, email, password)
      await syncUserProfile(result.user)
      await hydrateUserFromFirebase(result.user)
    } catch (err) {
      error.value = mapAuthError(err.code)
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Recuperar contraseña ────────────────────────────────────────────────────
  async function resetPassword(email) {
    loading.value = true
    error.value = null
    try {
      await sendPasswordResetEmail(auth, email)
    } catch (err) {
      error.value = mapAuthError(err.code)
      throw err
    } finally {
      loading.value = false
    }
  }

  function mapAuthError(code) {
    const messages = {
      'auth/email-already-in-use': 'Ese email ya tiene una cuenta. Iniciá sesión en vez de registrarte.',
      'auth/invalid-email': 'El email no es válido.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/invalid-credential': 'Email o contraseña incorrectos.',
      'auth/wrong-password': 'Email o contraseña incorrectos.',
      'auth/user-not-found': 'No existe una cuenta con ese email.',
      'auth/too-many-requests': 'Demasiados intentos. Probá de nuevo en unos minutos.',
    }
    return messages[code] || 'Ocurrió un error. Intentá de nuevo.'
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

  // ── Hidrata el store desde un firebaseUser ya autenticado ──────────────────
  // Única fuente de verdad para poblar authStore: la usan tanto el listener
  // pasivo (initAuthListener) como los flujos de login activos, para que
  // loginWithGoogle/loginWithEmail puedan esperar a que el store quede
  // realmente actualizado antes de resolver (evita la carrera con el router).
  async function hydrateUserFromFirebase(firebaseUser) {
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
      displayName: userData.displayName ?? firebaseUser.displayName,
      email: firebaseUser.email,
      // La foto de Firestore manda: quien se registró con email se subió la
      // suya y firebaseUser.photoURL viene null, así que tomarla de Auth la
      // borraría en cada login.
      photoURL: userData.photoURL ?? firebaseUser.photoURL,
      emailVerified: firebaseUser.emailVerified,
      providerId: firebaseUser.providerData?.[0]?.providerId ?? null,
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
  }

  // ── Escucha cambios de sesión (llamar una vez en App.vue o boot) ───────────
  function initAuthListener() {
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        await hydrateUserFromFirebase(firebaseUser)
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
  async function updateUserProfile({ nickname, description, preferredFoot, preferredPositions, favoriteTeam }) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('Usuario no autenticado')

    const fields = {
      nickname: (nickname ?? '').trim() || null,
      description: (description ?? '').trim(),
      preferredFoot: preferredFoot ?? null,
      preferredPositions: normalizePositions(preferredPositions),
      favoriteTeam: favoriteTeam ?? null,
    }

    await updateDoc(doc(db, 'users', uid), {
      ...fields,
      updatedAt: serverTimestamp(),
    })
    authStore.patchUser(fields)
    return fields
  }

  // ── Subir foto de perfil propia ────────────────────────────────────────────
  // Google ya trae photoURL de la cuenta; quien se registró con email no tiene
  // ninguna, así que puede subir la suya. Se guarda en Storage y la URL queda
  // en users/{uid}.photoURL, que es de donde la lee toda la app (listas,
  // perfiles, etc.). El ?v= evita que el navegador sirva la foto vieja
  // cacheada al reemplazarla.
  async function uploadProfilePhoto(file) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('Usuario no autenticado')
    if (!file?.type?.startsWith('image/')) throw new Error('El archivo debe ser una imagen.')
    if (file.size > 5 * 1024 * 1024) throw new Error('La imagen no puede pesar más de 5 MB.')

    loading.value = true
    error.value = null
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileRef = storageRef(storage, `users/${uid}/photo.${ext}`)
      await uploadBytes(fileRef, file, { contentType: file.type })
      const rawURL = await getDownloadURL(fileRef)
      const photoURL = `${rawURL}${rawURL.includes('?') ? '&' : '?'}v=${Date.now()}`

      await updateDoc(doc(db, 'users', uid), { photoURL, updatedAt: serverTimestamp() })
      authStore.patchUser({ photoURL })
      return photoURL
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
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
      // Actualiza foto y nombre por si cambiaron en el proveedor (Google).
      // Con email/password, firebaseUser.displayName/photoURL vienen null:
      // no pisar lo que ya haya en Firestore con eso.
      const patch = { updatedAt: serverTimestamp() }
      if (firebaseUser.displayName) patch.displayName = firebaseUser.displayName
      if (firebaseUser.photoURL) patch.photoURL = firebaseUser.photoURL
      await setDoc(userRef, patch, { merge: true })
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
    registerWithEmail,
    loginWithEmail,
    resetPassword,
    resendVerificationEmail,
    refreshEmailVerified,
    logout,
    initAuthListener,
    updateUserProfile,
    uploadProfilePhoto,
  }
}
