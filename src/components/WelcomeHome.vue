<template>
  <!--
    Pantalla de arranque para el usuario que todavía no tiene nada: ni grupos,
    ni partidos a la vista. Reemplaza al viejo cartel muerto ("No hay partidos
    programados / avisale al admin"), que le hablaba de un admin inexistente y
    no le ofrecía UNA sola acción — encima el botón "Crear partido" del header
    está oculto justo para él (requiere pertenecer a algún grupo).

    Son las tres puertas reales de entrada a la app, en el orden en que se dan
    en la vida real: el que organiza, el que fue invitado, y el que no conoce
    a nadie todavía.
  -->
  <div class="welcome-home">

    <!-- Qué es esto. Dos líneas, no un tutorial: el usuario vino a jugar. -->
    <div class="text-center q-mb-lg">
      <q-icon name="sports_soccer" size="64px" class="text-green-9" />
      <div class="text-h6 text-weight-bold q-mt-sm">Organizá tus partidos</div>
      <div class="text-body2 text-grey-7 q-mt-xs welcome-lead">
        La lista, los cupos, los suplentes y las estadísticas en un solo lugar.
        Se acabaron las cadenas de WhatsApp para saber quién juega.
      </div>
    </div>

    <div class="text-overline text-green-9 text-weight-bold q-mb-sm">
      PARA EMPEZAR
    </div>

    <div class="q-gutter-sm">
      <q-card
        v-for="option in options"
        :key="option.label"
        flat
        bordered
        class="welcome-card cursor-pointer"
        @click="go(option)"
      >
        <q-card-section class="row items-center no-wrap q-py-md">
          <q-avatar :color="option.color" text-color="white" :icon="option.icon" size="44px" />
          <div class="col q-ml-md overflow-hidden">
            <div class="text-subtitle1 text-weight-bold">{{ option.label }}</div>
            <div class="text-caption text-grey-7">{{ option.caption }}</div>
          </div>
          <q-icon name="chevron_right" size="24px" class="text-grey-5" />
        </q-card-section>
      </q-card>
    </div>

  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()

// El orden importa: primero el que organiza (crea el grupo y arrastra al resto),
// después el invitado, y último el que no conoce a nadie. "Partidos abiertos"
// existe desde los partidos públicos pero el recién llegado no tiene forma de
// enterarse — es justamente la respuesta a "no tengo grupo todavía".
const options = [
  {
    label: 'Crear un grupo',
    caption: 'Sos el que organiza. Armá tu grupo y sumá a los pibes.',
    icon: 'group_add',
    color: 'green-9',
    // ?crear=1 abre el diálogo de creación apenas carga GroupsPage, así la
    // tarjeta lleva a la acción y no a otra pantalla donde volver a buscarla.
    to: { name: 'groups', query: { crear: '1' } },
  },
  {
    label: 'Unirme a un grupo',
    caption: 'Ya te pasaron un código o un link de invitación.',
    icon: 'vpn_key',
    color: 'blue-8',
    to: { name: 'join-group' },
  },
  {
    label: 'Buscar partidos abiertos',
    caption: 'Todavía no tenés grupo: metete en el partido de otro.',
    icon: 'travel_explore',
    color: 'deep-orange-7',
    to: { name: 'public-matches' },
  },
]

function go(option) {
  router.push(option.to)
}
</script>

<style scoped>
.welcome-home {
  max-width: 520px;
  margin: 0 auto;
}

.welcome-lead {
  max-width: 380px;
  margin: 0 auto;
}

.welcome-card {
  border-radius: 14px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.welcome-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
}
</style>
