// src/utils/features.js
//
// Interruptores de funcionalidades de la app. Apagar uno acá OCULTA la función
// de toda la UI (drawer, home, páginas, banners, secciones) sin borrar el
// código, las Cloud Functions ni las reglas de Firestore. Para revivirla,
// poné el booleano en `true` de nuevo — no hace falta tocar nada más.

// "Partidos abiertos" (partidos públicos + postulaciones, Fase 1): publicar un
// partido al que le faltan jugadores y que alguien de afuera del grupo se
// postule. Se apagó a pedido: el back (colección `applications`, CF
// `onApplicationResolved`, reglas) sigue intacto, solo se esconden las puertas
// de entrada.
export const PUBLIC_MATCHES_ENABLED = false
