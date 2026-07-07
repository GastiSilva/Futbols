<template>
  <q-page padding>
    <div class="row items-center q-mb-md">
      <q-btn flat round icon="arrow_back" @click="$router.back()" class="q-mr-sm" />
      <div class="text-h5 text-weight-bold">Unirse a un grupo</div>
    </div>

    <!-- Banner de invitación por enlace -->
    <q-banner
      v-if="inviteCode"
      class="bg-green-1 text-green-10 q-mb-lg rounded-borders"
      rounded
    >
      <template #avatar>
        <q-icon name="link" color="green-9" size="28px" />
      </template>
      <div class="text-subtitle1 text-weight-bold">Tienes una invitación</div>
      <div class="text-body2 q-mt-xs">
        Código: <strong>{{ inviteCode }}</strong>
      </div>
      <template #action>
        <q-btn
          unelevated
          color="primary"
          label="Aceptar invitación"
          class="pill-btn"
          :loading="joiningByLink"
          @click="handleJoinByLink"
        />
      </template>
    </q-banner>

    <!-- Búsqueda por nombre -->
    <q-input
      v-model="searchQuery"
      outlined
      label="Buscar grupo por nombre"
      debounce="400"
      clearable
      @update:model-value="handleSearch"
    >
      <template #prepend>
        <q-icon name="search" />
      </template>
    </q-input>

    <!-- Spinner búsqueda -->
    <div v-if="searching" class="row justify-center q-mt-lg">
      <q-spinner-dots color="green-9" size="36px" />
    </div>

    <!-- Resultados -->
    <q-list v-else-if="results.length > 0" bordered separator class="rounded-borders q-mt-md">
      <q-item
        v-for="group in results"
        :key="group.id"
        class="q-py-md"
      >
        <q-item-section avatar>
          <q-avatar color="green-9" text-color="white">
            <q-icon name="sports_soccer" />
          </q-avatar>
        </q-item-section>

        <q-item-section>
          <q-item-label class="text-weight-medium">{{ group.name }}</q-item-label>
          <q-item-label caption>
            {{ group.memberCount }} miembro{{ group.memberCount !== 1 ? 's' : '' }}
          </q-item-label>
          <q-item-label v-if="group.description" caption class="text-grey-7 ellipsis">
            {{ group.description }}
          </q-item-label>
        </q-item-section>

        <q-item-section side>
          <q-btn
            v-if="!requestedIds.has(group.id)"
            unelevated
            color="primary"
            label="Solicitar"
            size="sm"
            class="pill-btn"
            :loading="requestingId === group.id"
            @click="handleRequestJoin(group)"
          />
          <q-chip
            v-else
            dense
            color="grey-3"
            text-color="grey-7"
            icon="hourglass_empty"
            label="Pendiente"
          />
        </q-item-section>
      </q-item>
    </q-list>

    <!-- Sin resultados -->
    <div
      v-else-if="searchQuery.length >= 2 && !searching"
      class="text-center q-mt-xl text-grey-6"
    >
      <q-icon name="search_off" size="56px" class="q-mb-md" />
      <div class="text-body1">No se encontraron grupos con ese nombre</div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGroups } from 'src/composables/useGroups'
import { useQuasar } from 'quasar'

const route = useRoute()
const router = useRouter()
const $q = useQuasar()
const { searchGroups, requestToJoin, joinByInviteCode } = useGroups()

const searchQuery = ref('')
const results = ref([])
const searching = ref(false)
const requestingId = ref(null)
const requestedIds = ref(new Set())
const inviteCode = ref(route.query.code ? String(route.query.code).toUpperCase() : null)
const joiningByLink = ref(false)

async function handleSearch(val) {
  if (!val || val.length < 2) {
    results.value = []
    return
  }
  searching.value = true
  try {
    results.value = await searchGroups(val)
  } finally {
    searching.value = false
  }
}

async function handleRequestJoin(group) {
  requestingId.value = group.id
  try {
    await requestToJoin(group.id)
    requestedIds.value = new Set([...requestedIds.value, group.id])
    $q.notify({ type: 'positive', message: `Solicitud enviada a "${group.name}"` })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    requestingId.value = null
  }
}

async function handleJoinByLink() {
  joiningByLink.value = true
  try {
    const { groupId, alreadyMember } = await joinByInviteCode(inviteCode.value)
    if (alreadyMember) {
      $q.notify({ type: 'info', message: 'Ya eres miembro de este grupo' })
    } else {
      $q.notify({ type: 'positive', message: '¡Te uniste al grupo correctamente!' })
    }
    router.push({ name: 'group-detail', params: { id: groupId } })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    joiningByLink.value = false
  }
}
</script>
