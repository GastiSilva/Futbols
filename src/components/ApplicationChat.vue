<template>
  <q-dialog v-model="open" @show="handleShow" @hide="handleHide">
    <q-card style="min-width: 320px; max-width: 460px; display: flex; flex-direction: column">
      <q-card-section class="row items-center q-pb-sm">
        <q-avatar size="36px" class="q-mr-sm">
          <img
            :src="otherPhotoURL ?? '/icons/icon-128x128.png'"
            :alt="otherName"
            referrerpolicy="no-referrer"
          />
        </q-avatar>
        <div class="col">
          <div class="text-subtitle2 text-weight-bold">{{ otherName }}</div>
          <div class="text-caption text-grey-7">{{ matchTitle }}</div>
        </div>
        <q-btn flat round dense icon="close" v-close-popup />
      </q-card-section>

      <q-separator />

      <q-card-section
        ref="scrollArea"
        style="height: 300px; overflow-y: auto"
        class="bg-grey-1 q-py-sm"
      >
        <div v-if="messages.length === 0" class="text-center text-grey-6 q-pa-md">
          <q-icon name="chat_bubble_outline" size="32px" class="q-mb-sm" />
          <div class="text-body2">
            Todavía no hay mensajes. Escribile para coordinar.
          </div>
        </div>

        <div
          v-for="msg in messages"
          :key="msg.id"
          class="row q-mb-sm"
          :class="isMine(msg) ? 'justify-end' : 'justify-start'"
        >
          <div
            class="q-pa-sm"
            :class="isMine(msg) ? 'bubble bubble--mine' : 'bubble bubble--theirs'"
          >
            <div class="text-body2" style="white-space: pre-wrap">{{ msg.text }}</div>
            <div class="text-caption text-right" style="opacity: 0.7; font-size: 10px">
              {{ timeLabel(msg) }}
            </div>
          </div>
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-py-sm">
        <q-input
          v-model="draft"
          outlined
          dense
          autogrow
          placeholder="Escribí un mensaje…"
          :maxlength="MAX_CHAT_MESSAGE_LENGTH"
          :disable="sending"
          @keydown.enter.exact.prevent="handleSend"
        >
          <template #after>
            <q-btn
              round
              dense
              unelevated
              color="primary"
              icon="send"
              :disable="!draft.trim()"
              :loading="sending"
              @click="handleSend"
            />
          </template>
        </q-input>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
// Chat 1-a-1 entre el postulante y quien organiza el partido.
//
// Es 1-a-1 y NO un chat grupal del partido a propósito: un chat de 14 personas
// manda 13 notificaciones irrelevantes por mensaje ("¿alguien tiene pechera?"
// no le importa a los que no la tienen). Acá los dos participantes necesitan
// cada mensaje que se manda.
import { ref, computed, nextTick, watch } from 'vue'
import { useQuasar, date as qdate } from 'quasar'
import { useApplications, MAX_CHAT_MESSAGE_LENGTH } from 'src/composables/useApplications'
import { useAuthStore } from 'src/stores/auth.store'

const props = defineProps({
  matchId: { type: String, required: true },
  applicantId: { type: String, required: true },
  otherName: { type: String, default: 'Jugador' },
  otherPhotoURL: { type: String, default: null },
  matchTitle: { type: String, default: '' },
})

const open = defineModel({ type: Boolean, default: false })

const $q = useQuasar()
const authStore = useAuthStore()
const { messages, subscribeToMessages, sendMessage, stopListening } = useApplications()

const draft = ref('')
const sending = ref(false)
const scrollArea = ref(null)

const chatKey = computed(() => `msg:${props.matchId}:${props.applicantId}`)

function isMine(msg) {
  return msg.senderId === authStore.user?.uid
}

function timeLabel(msg) {
  const d = msg.createdAt?.toDate?.()
  return d ? qdate.formatDate(d, 'HH:mm') : ''
}

function scrollToBottom() {
  nextTick(() => {
    const el = scrollArea.value?.$el ?? scrollArea.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// Los mensajes nuevos aparecen abajo: sin esto el chat se queda mirando arriba
// y parece que no llegó nada.
watch(messages, scrollToBottom)

function handleShow() {
  subscribeToMessages(props.matchId, props.applicantId)
  scrollToBottom()
}

function handleHide() {
  stopListening(chatKey.value)
  draft.value = ''
}

async function handleSend() {
  const text = draft.value.trim()
  if (!text) return

  sending.value = true
  try {
    await sendMessage(props.matchId, props.applicantId, text)
    draft.value = ''
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    sending.value = false
  }
}
</script>

<style scoped>
.bubble {
  max-width: 78%;
  border-radius: 12px;
  word-break: break-word;
}

.bubble--mine {
  background: var(--q-primary);
  color: #fff;
  border-bottom-right-radius: 3px;
}

.bubble--theirs {
  background: #fff;
  color: #1a1a1a;
  border: 1px solid #e0e0e0;
  border-bottom-left-radius: 3px;
}
</style>
