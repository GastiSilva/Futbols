// src/services/firebase.js
// ─────────────────────────────────────────────────────────────────────────────
// Inicialización centralizada de Firebase.
// Reemplaza los valores de firebaseConfig con los de tu proyecto en Firebase Console.
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { getStorage, connectStorageEmulator } from 'firebase/storage'

// ── ¿Corremos contra los emuladores locales? ─────────────────────────────────
// Opt-in EXPLÍCITO con VITE_USE_EMULATORS=true en .env.local — nunca por el
// solo hecho de estar en modo dev. La app ya está viva en yasta.com.ar, así
// que "modo dev = emulador" sería peligroso al revés: un día levantás el dev
// para tocar un estilo, el emulador no está corriendo, y la app falla entera
// sin razón aparente. Con un flag explícito, vos elegís contra qué base
// trabajás y siempre sabés cuál es.
const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === 'true'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// ── App ───────────────────────────────────────────────────────────────────────
export const firebaseApp = initializeApp(firebaseConfig)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = getAuth(firebaseApp)
export const googleProvider = new GoogleAuthProvider()
googleProvider.addScope('profile')
googleProvider.addScope('email')

// ── Firestore (con caché persistente multi-pestaña) ────────────────────────
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})

// ── Cloud Functions ───────────────────────────────────────────────────────────
export const functions = getFunctions(firebaseApp, 'southamerica-east1')

// ── Storage ────────────────────────────────────────────────────────────────────
export const storage = getStorage(firebaseApp)

// ── Conexión a los emuladores locales ────────────────────────────────────────
// Va DESPUÉS de crear cada servicio pero ANTES de cualquier operación: el SDK
// no deja redirigir a un emulador una instancia que ya empezó a hablar con
// producción.
//
// Los puertos son los que declara firebase.json → "emulators". Si cambiás uno
// allá, cambialo acá.
if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  connectStorageEmulator(storage, '127.0.0.1', 9199)

  // Cartel bien visible: la consola es el único lugar donde se nota que los
  // datos que ves NO son los de producción. Sin esto es facilísimo cargar
  // media hora de datos de prueba creyendo que estás en la base real (o peor,
  // al revés).
  // eslint-disable-next-line no-console
  console.info(
    '%c🧪 EMULADORES LOCALES%c\nFirestore, Auth, Functions y Storage corren en tu máquina.\nLos datos NO son los de producción y se pierden al apagar el emulador.\nPanel: http://127.0.0.1:4000',
    'background:#f59e0b;color:#000;font-weight:bold;padding:2px 6px;border-radius:3px',
    'color:#92400e',
  )
}

// ── FCM (Firebase Cloud Messaging) ────────────────────────────────────────────
// Se inicializa de forma lazy porque isSupported() es async
export let messaging = null
export async function initMessaging() {
  // El emulador no implementa FCM: pedir un token contra él falla y llena la
  // consola de errores. En local las notificaciones push simplemente no van.
  if (USE_EMULATORS) return null

  const supported = await isSupported()
  if (supported) {
    messaging = getMessaging(firebaseApp)
  }
  return messaging
}
