<template>
  <q-dialog v-model="open" @hide="reset">
    <q-card style="min-width: 320px; max-width: 420px">
      <q-card-section class="row items-center q-pb-none">
        <q-icon name="flag" color="negative" size="24px" class="q-mr-sm" />
        <div class="text-h6">Reportar a {{ userName }}</div>
      </q-card-section>

      <q-card-section>
        <div class="text-caption text-grey-7 q-mb-md">
          El reporte lo revisa el equipo de YASTA. {{ userName }} no ve quién lo reportó.
        </div>

        <q-select
          v-model="reason"
          :options="REPORT_REASONS"
          label="Motivo *"
          outlined
          dense
          emit-value
          map-options
          class="q-mb-md"
        />

        <q-input
          v-model="details"
          label="Contanos qué pasó (opcional)"
          type="textarea"
          outlined
          dense
          autogrow
          :maxlength="MAX_REPORT_DETAILS"
          counter
          :input-style="{ minHeight: '70px' }"
        />
      </q-card-section>

      <q-card-actions align="right" class="q-px-md q-pb-md">
        <q-btn flat label="Cancelar" color="grey-7" v-close-popup />
        <q-btn
          unelevated
          label="Enviar reporte"
          color="negative"
          icon="send"
          :disable="!reason"
          :loading="loading"
          @click="handleSubmit"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref } from 'vue'
import { useQuasar } from 'quasar'
import { useReports, REPORT_REASONS, MAX_REPORT_DETAILS } from 'src/composables/useReports'

const props = defineProps({
  userId: { type: String, required: true },
  userName: { type: String, default: 'este jugador' },
  matchId: { type: String, default: null },
})

const $q = useQuasar()
const { reportUser, loading } = useReports()

const open = defineModel({ type: Boolean, default: false })
const reason = ref(null)
const details = ref('')

function reset() {
  reason.value = null
  details.value = ''
}

async function handleSubmit() {
  try {
    await reportUser(props.userId, reason.value, details.value, props.matchId)
    open.value = false
    $q.notify({
      type: 'positive',
      icon: 'check_circle',
      message: 'Reporte enviado. Gracias por avisar.',
    })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  }
}
</script>
