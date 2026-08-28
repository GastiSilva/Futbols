<template>
  <!--
    Vitrina de insignias. Se muestra en el perfil propio y en el de otro.

    `showGroup` NO es una decisión estética sino de privacidad: a quien no
    comparte grupo con esta persona se le muestra el premio sin el nombre del
    grupo, por el mismo motivo por el que ProfileViewPage le oculta
    statsByGroup — el listado de grupos es el mapa social de alguien.
  -->
  <q-card v-if="knownBadges.length > 0" flat bordered class="q-mb-md">
    <q-card-section>
      <div class="text-subtitle2 text-weight-bold q-mb-sm">
        <q-icon name="emoji_events" class="q-mr-xs text-amber-8" />
        Vitrina
        <span class="text-caption text-grey-6 text-weight-regular">
          · {{ knownBadges.length }}
        </span>
      </div>

      <div class="row q-col-gutter-sm">
        <div
          v-for="badge in visibleBadges"
          :key="badge.id"
          class="col-12 col-sm-6"
        >
          <div class="row items-center no-wrap badge-row">
            <!-- La ilustración va sobre un disco tenue del color del premio:
                 da peso visual sin competir con el trofeo, que es el que tiene
                 que leerse. `loading="lazy"` porque un perfil con historial
                 puede tener 20 y solo se ven 4 sin desplegar. -->
            <div class="badge-art">
              <span class="badge-art-disc" :class="`bg-${badge.view.color}`"></span>
              <img
                v-if="badge.view.art"
                :src="badge.view.art"
                :alt="badge.view.label"
                width="34"
                height="34"
                loading="lazy"
                decoding="async"
              />
              <q-icon v-else-if="badge.view.icon" :name="badge.view.icon" :color="badge.view.color" size="26px" />
            </div>
            <div class="col q-ml-sm overflow-hidden">
              <div class="text-body2 text-weight-bold ellipsis">{{ badge.view.label }}</div>
              <div class="text-caption text-grey-7 ellipsis">{{ badge.view.detail }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Un jugador con años de historial junta muchas: se muestran las
           últimas y el resto se despliega a pedido. -->
      <q-btn
        v-if="knownBadges.length > COLLAPSED_COUNT"
        flat
        dense
        no-caps
        size="sm"
        color="grey-7"
        class="q-mt-sm"
        :label="expanded ? 'Ver menos' : `Ver las ${knownBadges.length}`"
        @click="expanded = !expanded"
      />
    </q-card-section>
  </q-card>
</template>

<script setup>
import { computed, ref } from 'vue'
import { describeBadge } from 'src/utils/badges'

const props = defineProps({
  badges: { type: Array, default: () => [] },
  // true solo cuando el que mira comparte grupo con el dueño del perfil.
  showGroup: { type: Boolean, default: false },
})

const COLLAPSED_COUNT = 4
const expanded = ref(false)

// Las que el catálogo no reconoce se descartan en vez de dibujarse rotas:
// puede pasar si el backend otorga un tipo nuevo y el cliente todavía no se
// actualizó (el usuario tiene la PWA vieja cacheada).
const knownBadges = computed(() =>
  props.badges
    .map((b) => ({ ...b, view: describeBadge(b, { showGroup: props.showGroup }) }))
    .filter((b) => b.view !== null),
)

const visibleBadges = computed(() =>
  expanded.value ? knownBadges.value : knownBadges.value.slice(0, COLLAPSED_COUNT),
)
</script>

<style scoped>
.badge-row {
  padding: 4px 0;
}

.badge-art {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  position: relative;
}

/* Disco del color del premio, atenuado: sostiene la ilustración sin competir
   con ella. A opacidad plena el trofeo se apagaba contra el fondo. */
.badge-art-disc {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  opacity: 0.14;
}

.badge-art img {
  position: relative;
  display: block;
  object-fit: contain;
}
</style>
