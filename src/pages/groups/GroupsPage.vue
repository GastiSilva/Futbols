<template>
  <q-page padding>
    <!-- Cabecera -->
    <div class="row justify-between items-center q-mb-md">
      <div class="text-h5 text-weight-bold">
        <q-icon name="group" class="q-mr-sm text-green-9" />Mis Grupos
      </div>
      <q-btn
        unelevated
        color="green-9"
        icon="add"
        label="Crear grupo"
        @click="showCreateDialog = true"
      />
    </div>

    <q-btn
      flat
      color="green-9"
      icon="search"
      label="Buscar y unirse a un grupo"
      class="q-mb-lg"
      :to="{ name: 'join-group' }"
    />

    <!-- Loading -->
    <div v-if="loading" class="row justify-center q-mt-xl">
      <q-spinner-dots color="green-9" size="48px" />
    </div>

    <!-- Error -->
    <q-banner
      v-else-if="loadError"
      class="bg-negative text-white rounded-borders q-mb-md"
      dense
    >
      <template #avatar><q-icon name="error" /></template>
      {{ loadError }}
    </q-banner>

    <!-- Sin grupos -->
    <div v-else-if="groups.length === 0" class="text-center q-mt-xl text-grey-6">
      <q-icon name="group_off" size="72px" class="q-mb-md" />
      <div class="text-h6">Aún no perteneces a ningún grupo</div>
      <div class="q-mt-xs text-body2">Crea uno o busca un grupo para unirte</div>
    </div>

    <!-- Lista de grupos -->
    <div v-else class="row q-col-gutter-md">
      <div
        v-for="group in groups"
        :key="group.id"
        class="col-12 col-sm-6 col-md-4"
      >
        <q-card class="full-height">
          <q-card-section
            class="cursor-pointer"
            @click="$router.push({ name: 'group-detail', params: { id: group.id } })"
          >
            <div class="row items-center no-wrap">
              <q-avatar color="green-9" text-color="white" size="48px" class="q-mr-md">
                <img v-if="group.photoURL" :src="group.photoURL" :alt="group.name" referrerpolicy="no-referrer" />
                <q-icon v-else name="sports_soccer" />
              </q-avatar>
              <div class="col">
                <div class="text-subtitle1 text-weight-bold ellipsis">{{ group.name }}</div>
                <div class="text-caption text-grey-6">
                  {{ group.memberCount }} miembro{{ group.memberCount !== 1 ? 's' : '' }}
                </div>
              </div>
            </div>
            <div v-if="group.description" class="q-mt-sm text-body2 text-grey-7 ellipsis-2-lines">
              {{ group.description }}
            </div>
          </q-card-section>

          <!-- Desplegable de miembros -->
          <q-expansion-item
            dense
            icon="people"
            label="Ver miembros"
            header-class="text-green-9 text-caption"
            @before-show="loadMembers(group.id)"
          >
            <q-list dense class="q-pb-sm">
              <q-item v-if="!groupMembers[group.id]" class="justify-center">
                <q-spinner-dots color="green-9" size="24px" />
              </q-item>
              <q-item
                v-for="member in groupMembers[group.id]"
                :key="member.id"
                class="q-py-xs"
              >
                <q-item-section avatar>
                  <q-avatar size="28px">
                    <img
                      v-if="member.photoURL"
                      :src="member.photoURL"
                      :alt="member.displayName"
                      referrerpolicy="no-referrer"
                    />
                    <q-icon v-else name="person" size="18px" />
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-body2">{{ member.displayName }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-badge
                    :color="member.role === 'owner' ? 'green-9' : member.role === 'admin' ? 'blue-7' : 'grey-5'"
                    :label="member.role === 'owner' ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Miembro'"
                    dense
                  />
                </q-item-section>
              </q-item>
            </q-list>
          </q-expansion-item>

          <q-card-actions align="right">
            <q-btn flat color="green-9" label="Ver grupo" icon-right="chevron_right"
              @click="$router.push({ name: 'group-detail', params: { id: group.id } })" />
          </q-card-actions>
        </q-card>
      </div>
    </div>

    <!-- ── Dialog: Crear grupo ─────────────────────────────────────────────── -->
    <q-dialog v-model="showCreateDialog" persistent>
      <q-card style="min-width: 320px; max-width: 480px; width: 100%">
        <q-card-section>
          <div class="text-h6">Crear nuevo grupo</div>
        </q-card-section>

        <q-form @submit.prevent="handleCreate">
          <q-card-section class="q-pt-none q-gutter-sm">
            <q-input
              v-model="newGroup.name"
              label="Nombre del grupo *"
              outlined
              autofocus
              :rules="[val => !!val.trim() || 'El nombre es obligatorio']"
            />
            <q-input
              v-model="newGroup.description"
              label="Descripción (opcional)"
              outlined
              type="textarea"
              autogrow
            />
          </q-card-section>

          <q-card-actions align="right" class="q-pb-md q-px-md">
            <q-btn flat label="Cancelar" @click="closeCreateDialog" :disable="creating" />
            <q-btn
              unelevated
              color="green-9"
              label="Crear"
              type="submit"
              :loading="creating"
            />
          </q-card-actions>
        </q-form>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useGroups } from 'src/composables/useGroups'
import { useQuasar } from 'quasar'
import { useAuthStore } from 'src/stores/auth.store'

const router = useRouter()
const $q = useQuasar()
const { loading, createGroup, getMyGroups, getGroupMembers } = useGroups()
const authStore = useAuthStore()

const groups = ref([])
const groupMembers = ref({})
const loadError = ref(null)
const showCreateDialog = ref(false)
const creating = ref(false)
const newGroup = ref({ name: '', description: '' })

// El "watch" mágico: Ni bien Pinia detecta tu usuario, va a buscar los grupos.
watch(
  () => authStore.user?.uid,
  async (newUid) => {
    if (newUid) {
      try {
        loadError.value = null
        groups.value = await getMyGroups()
      } catch (err) {
        loadError.value = err.message ?? 'Error al cargar los grupos.'
        console.error("Error cargando grupos:", err)
      }
    } else {
      groups.value = [] // Si no estás logueado, limpia la lista
    }
  },
  { immediate: true }
)

async function loadMembers(groupId) {
  if (groupMembers.value[groupId]) return
  try {
    groupMembers.value[groupId] = await getGroupMembers(groupId)
  } catch {
    groupMembers.value[groupId] = []
  }
}

function closeCreateDialog() {
  showCreateDialog.value = false
  newGroup.value = { name: '', description: '' }
}

async function handleCreate() {
  if (!newGroup.value.name.trim()) return
  creating.value = true
  try {
    const groupId = await createGroup(newGroup.value)
    closeCreateDialog()
    $q.notify({ type: 'positive', message: 'Grupo creado correctamente' })
    router.push({ name: 'group-detail', params: { id: groupId } })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    creating.value = false
  }
}
</script>
