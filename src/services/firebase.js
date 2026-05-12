// src/services/firebase.js
// ─────────────────────────────────────────────────────────────────────────────
// Inicialización centralizada de Firebase.
// Reemplaza los valores de firebaseConfig con los de tu proyecto en Firebase Console.
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'
import { getFunctions } from 'firebase/functions'

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

// ── FCM (Firebase Cloud Messaging) ────────────────────────────────────────────
// Se inicializa de forma lazy porque isSupported() es async
export let messaging = null
export async function initMessaging() {
  const supported = await isSupported()
  if (supported) {
    messaging = getMessaging(firebaseApp)
  }
  return messaging
}
