<!-- src/components/ActivityFeedCard.vue
     ─────────────────────────────────────────────────────────────────────────
     Timeline de actividad de los grupos del usuario: quién se anotó, quién
     ganó una insignia. Existe para dar un motivo de entrar a la app además de
     "tengo que anotarme" — mirar qué pasó en el grupo, aunque no haya
     partido esta semana. Los eventos los escribe SOLO el backend
     (onRegistrationCreated, runMonthlyBadges); acá es de puro consumo.
-->
<template>
  <q-card v-if="events.length > 0" flat bordered class="q-mb-md">
    <q-card-section class="q-pb-none">
      <div class="text-subtitle2 text-weight-bold">
        <q-icon name="dynamic_feed" class="q-mr-xs text-primary" />
        Actividad reciente
      </div>
    </q-card-section>
    <q-list separator class="q-mt-sm">
      <q-item v-for="ev in events" :key="ev.id" clickable @click="goTo(ev)">
        <q-item-section avatar>
          <q-icon :name="eventMeta(ev.type).icon" :color="eventMeta(ev.type).color" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ ev.text }}</q-item-label>
          <q-item-label caption v-if="ev.createdAt">
            {{ qdate.formatDate(ev.createdAt.toDate(), 'D/M HH:mm') }}
          </q-item-label>
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { date as qdate } from 'quasar'
import { useRouter } from 'vue-router'
import { useActivityFeed } from 'src/composables/useActivityFeed'
import { useAuthStore } from 'src/stores/auth.store'

const router = useRouter()
const authStore = useAuthStore()
const { events, subscribeToFeed } = useActivityFeed()

let stop = null

function eventMeta(type) {
  if (type === 'badge') return { icon: 'military_tech', color: 'orange-8' }
  if (type === 'streak') return { icon: 'local_fire_department', color: 'deep-orange-8' }
  return { icon: 'how_to_reg', color: 'green-8' } // 'registration'
}

function goTo(ev) {
  if (ev.matchId) router.push({ name: 'match-detail', params: { id: ev.matchId } })
}

onMounted(() => {
  if (authStore.isGuest) return
  stop = subscribeToFeed()
})

onUnmounted(() => {
  stop?.()
})
</script>
