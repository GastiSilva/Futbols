<template>
  <q-page padding>
    <div class="text-h5 text-weight-bold q-mb-lg">
      <q-icon name="admin_panel_settings" color="green-8" class="q-mr-sm" />
      Panel de Administración
    </div>

    <div class="row q-col-gutter-md">
      <!-- Acción rápida -->
      <div class="col-12 col-sm-6 col-md-4">
        <q-card flat bordered class="cursor-pointer" @click="$router.push({ name: 'create-match' })">
          <q-card-section class="text-center q-pa-lg">
            <q-icon name="add_circle" size="48px" color="green-8" />
            <div class="text-subtitle1 text-weight-bold q-mt-sm">Crear partido</div>
          </q-card-section>
        </q-card>
      </div>

      <!-- Lista de partidos activos -->
      <div class="col-12">
        <div class="text-subtitle1 text-weight-bold q-mb-sm">Partidos activos</div>

        <q-list bordered separator rounded>
          <q-item v-if="matches.length === 0">
            <q-item-section class="text-grey-6 text-center q-pa-md">
              No hay partidos activos
            </q-item-section>
          </q-item>

          <q-item
            v-for="m in matches"
            :key="m.id"
            clickable
            v-ripple
          >
            <q-item-section avatar>
              <q-icon name="sports_soccer" color="green-8" />
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-weight-bold">{{ m.title }}</q-item-label>
              <q-item-label caption>
                {{ formatDate(m.date) }} — {{ m.format }} — {{ m.currentPlayers }}/{{ m.maxPlayers }} jugadores
              </q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="row q-gutter-xs">
                <q-chip
                  :color="statusColor(m.status)"
                  text-color="white"
                  dense
                  :label="statusLabel(m.status)"
                />
                <q-btn
                  flat
                  round
                  dense
                  icon="edit_note"
                  color="blue-7"
                  @click.stop="$router.push({ name: 'edit-match', params: { id: m.id } })"
                >
                  <q-tooltip>Editar partido</q-tooltip>
                </q-btn>
                <q-btn
                  flat
                  round
                  dense
                  icon="scoreboard"
                  color="orange-7"
                  @click.stop="$router.push({ name: 'post-match', params: { id: m.id } })"
                >
                  <q-tooltip>Cargar resultado</q-tooltip>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <!-- Gestión de roles de usuarios -->
      <div class="col-12 q-mt-md">
        <div class="text-subtitle1 text-weight-bold q-mb-md">
          <q-icon name="manage_accounts" color="green-8" class="q-mr-xs" />
          Gestión de usuarios
        </div>

        <q-card flat bordered>
          <q-card-section class="bg-grey-1 q-pa-md">
            <q-input
              v-model="searchUser"
              filled
              dense
              placeholder="🔍 Buscar usuario por nombre..."
              class="q-mb-md"
            >
              <template #prepend>
                <q-icon name="search" />
              </template>
            </q-input>

            <div class="text-caption text-grey-7 q-mb-md">
              Total de usuarios: {{ users.length }} | Filtrados: {{ filteredUsers.length }}
            </div>
          </q-card-section>

          <q-separator />

          <q-list separator>
            <q-item v-if="loadingUsers" class="justify-center q-pa-md">
              <q-spinner-dots color="green-9" size="32px" />
            </q-item>
            <q-item v-else-if="filteredUsers.length === 0" class="text-grey-6 text-center q-pa-md">
              <q-item-section>
                {{ searchUser ? 'No se encontraron usuarios' : 'No hay usuarios registrados' }}
              </q-item-section>
            </q-item>

            <q-item v-for="u in filteredUsers" :key="u.id" class="q-pa-md">
              <q-item-section avatar>
                <q-avatar size="48px">
                  <img
                    v-if="u.photoURL"
                    :src="u.photoURL"
                    :alt="u.displayName"
                    referrerpolicy="no-referrer"
                  />
                  <q-icon v-else name="person" />
                </q-avatar>
              </q-item-section>

              <q-item-section>
                <q-item-label class="text-weight-bold">{{ u.displayName }}</q-item-label>
                <q-item-label caption>{{ u.email }}</q-item-label>
              </q-item-section>

              <q-item-section side top style="min-width: 180px">
                <div class="column items-end q-gutter-xs">
                  <!-- Rol actual con badge -->
                  <q-badge
                    :color="getRoleColor(u.role)"
                    :label="getRoleLabel(u.role)"
                    class="text-weight-bold"
                  />

                  <!-- Selector de rol -->
                  <q-select
                    :model-value="u.role ?? 'player'"
                    :options="ROLE_OPTIONS"
                    option-label="label"
                    option-value="value"
                    emit-value
                    map-options
                    dense
                    outlined
                    size="sm"
                    :loading="settingRoleFor === u.id"
                    @update:model-value="(newRole) => setRole(u, newRole)"
                    class="q-mt-xs"
                    style="min-width: 120px"
                  >
                    <template #prepend>
                      <q-icon :name="getRoleIcon(u.role)" />
                    </template>
                  </q-select>
                </div>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card>
      </div>

    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { date, useQuasar } from 'quasar'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/services/firebase'
import { useMatch } from 'src/composables/useMatch'

const $q = useQuasar()
const { matches, subscribeToUpcoming, stopListening } = useMatch()

// ── Usuarios ──────────────────────────────────────────────────────────────────
const users = ref([])
const loadingUsers = ref(false)
const settingRoleFor = ref(null)
const searchUser = ref('')

const ROLE_OPTIONS = [
  { label: '👤 Jugador', value: 'player' },
  { label: '🎯 OG', value: 'og' },
  { label: '⚙️ Admin', value: 'admin' },
]

// Filtrar usuarios según búsqueda
const filteredUsers = computed(() => {
  if (!searchUser.value) return users.value
  const search = searchUser.value.toLowerCase()
  return users.value.filter(
    u =>
      u.displayName?.toLowerCase().includes(search) ||
      u.email?.toLowerCase().includes(search),
  )
})

onMounted(async () => {
  subscribeToUpcoming()
  loadingUsers.value = true
  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('displayName', 'asc')))
    users.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } finally {
    loadingUsers.value = false
  }
})
onUnmounted(() => stopListening())

async function setRole(u, newRole) {
  if (u.role === newRole) return
  settingRoleFor.value = u.id
  try {
    const fn = httpsCallable(functions, 'setUserRole')
    await fn({ targetUid: u.id, role: newRole })
    u.role = newRole
    $q.notify({
      type: 'positive',
      message: `✅ ${u.displayName} es ahora ${getRoleLabel(newRole)}`,
      position: 'top',
    })
  } catch (err) {
    $q.notify({
      type: 'negative',
      message: `❌ Error: ${err.message}`,
      position: 'top',
    })
  } finally {
    settingRoleFor.value = null
  }
}

function getRoleColor(role) {
  const map = {
    admin: 'red-6',
    og: 'purple-6',
    player: 'blue-6',
  }
  return map[role] ?? 'grey-6'
}

function getRoleLabel(role) {
  const map = {
    admin: '⚙️ Admin',
    og: '🎯 OG',
    player: '👤 Jugador',
  }
  return map[role] ?? 'Desconocido'
}

function getRoleIcon(role) {
  const map = {
    admin: 'admin_panel_settings',
    og: 'sports_soccer',
    player: 'person',
  }
  return map[role] ?? 'help'
}

function formatDate(ts) {
  return ts ? date.formatDate(ts.toDate(), 'DD/MM HH:mm') : ''
}

function statusLabel(s) {
  const map = { scheduled: 'Programado', open: 'Abierto', closed: 'Completo', finished: 'Finalizado' }
  return map[s] ?? s
}

function statusColor(s) {
  const map = { scheduled: 'blue-grey-6', open: 'green-7', closed: 'orange-7', finished: 'grey-6' }
  return map[s] ?? 'grey'
}
</script>
