// src/boot/pinia.js
// ─────────────────────────────────────────────────────────────────────────────
// Boot file de Pinia: registra el store de Pinia en la app antes de montarla.
// ─────────────────────────────────────────────────────────────────────────────
import { boot } from 'quasar/wrappers'
import { createPinia } from 'pinia'

export default boot(({ app }) => {
  const pinia = createPinia()
  app.use(pinia)
})
