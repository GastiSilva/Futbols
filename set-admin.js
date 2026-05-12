// Script para dar admin al primer usuario
// Ejecutar: node set-admin.js
const admin = require('./functions/node_modules/firebase-admin')

let credential
try {
  const serviceAccount = require('./serviceAccount.json')
  credential = admin.credential.cert(serviceAccount)
  console.log('Usando service account key...')
} catch {
  credential = admin.credential.applicationDefault()
  console.log('Usando Application Default Credentials...')
}

admin.initializeApp({
  credential,
  projectId: 'listasfutbol-23089'
})

const TARGET_UID = 'k5KzNayaP2boTMjtRzZygz5evk62'

async function setAdmin() {
  await admin.auth().setCustomUserClaims(TARGET_UID, { admin: true })
  console.log('✅ Claim admin:true asignado')

  await admin.firestore().collection('users').doc(TARGET_UID).update({
    role: 'admin',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  })
  console.log('✅ Firestore: role=admin guardado')
  console.log('\n✅ LISTO. Cerrá sesión y volvé a entrar en la app.')
}

setAdmin()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Error:', err.message)
    if (err.message.includes('credential') || err.message.includes('auth')) {
      console.error('\n--- SOLUCIÓN ---')
      console.error('1. Ir a: https://console.firebase.google.com/project/listasfutbol-23089/settings/serviceaccounts/adminsdk')
      console.error('2. Clic en "Generar nueva clave privada"')
      console.error('3. Guardar el archivo descargado como: C:\\Users\\Usuario\\Desktop\\Futbols\\serviceAccount.json')
      console.error('4. Volver a ejecutar: node set-admin.js')
    }
    process.exit(1)
  })
