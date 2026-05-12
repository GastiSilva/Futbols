<template>
  <q-page padding>
    <!-- Loading inicial -->
    <div v-if="loadingGroup" class="row justify-center q-mt-xl">
      <q-spinner-dots color="green-9" size="48px" />
    </div>

    <!-- Grupo no encontrado -->
    <div v-else-if="!group" class="text-center q-mt-xl text-grey-6">
      <q-icon name="group_off" size="72px" class="q-mb-md" />
      <div class="text-h6">Grupo no encontrado</div>
    </div>

    <!-- Contenido principal -->
    <template v-else>
      <!-- Cabecera -->
      <div class="row items-center q-mb-md no-wrap">
        <q-btn flat round icon="arrow_back" @click="$router.back()" />
        <div class="col q-ml-sm">
          <div class="text-h5 text-weight-bold ellipsis">{{ group.name }}</div>
          <div class="text-caption text-grey-6">
            {{ group.memberCount }} miembro{{ group.memberCount !== 1 ? 's' : '' }}
          </div>
        </div>
        <!-- Menú de opciones para admins/owner -->
        <q-btn
          v-if="myRole === 'owner' || myRole === 'admin'"
          flat
          round
          icon="more_vert"
        >
          <q-menu anchor="bottom right" self="top right">
            <q-list style="min-width: 220px">
              <q-item clickable v-close-popup @click="handleRegenerateCode">
                <q-item-section avatar>
                  <q-icon name="refresh" />
                </q-item-section>
                <q-item-section>Regenerar código de invitación</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </div>

      <!-- Descripción -->
      <div v-if="group.description" class="text-body2 text-grey-7 q-mb-md">
        {{ group.description }}
      </div>

      <!-- ── Enlace de invitación ──────────────────────────────────────────── -->
      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <div class="text-subtitle2 text-weight-bold q-mb-sm">
            <q-icon name="link" class="q-mr-xs text-green-9" />Enlace de invitación
          </div>
          <div class="row items-center no-wrap">
            <q-input
              :model-value="inviteLink"
              readonly
              outlined
              dense
              class="col"
              input-class="text-caption"
            />
            <q-btn flat round icon="content_copy" class="q-ml-xs" @click="copyInviteLink">
              <q-tooltip>Copiar enlace</q-tooltip>
            </q-btn>
          </div>
          <div class="text-caption text-grey-6 q-mt-xs">
            Código: <strong>{{ group.inviteCode }}</strong>
          </div>
        </q-card-section>
      </q-card>

      <!-- ── Solicitudes pendientes (solo admins/owner) ──────────────────────── -->
      <q-expansion-item
        v-if="(myRole === 'owner' || myRole === 'admin') && joinRequests.length > 0"
        icon="person_add"
        :label="`Solicitudes pendientes (${joinRequests.length})`"
        header-class="bg-orange-1 text-orange-9 text-weight-bold rounded-borders"
        class="q-mb-md rounded-borders overflow-hidden"
        style="border: 1px solid #ffe082"
        default-opened
      >
        <q-list>
          <q-item
            v-for="req in joinRequests"
            :key="req.id"
            class="q-py-sm"
          >
            <q-item-section avatar>
              <q-avatar>
                <img
                  v-if="req.photoURL"
                  :src="req.photoURL"
                  :alt="req.displayName"
                  referrerpolicy="no-referrer"
                />
                <q-icon v-else name="person" />
              </q-avatar>
            </q-item-section>

            <q-item-section>
              <q-item-label>{{ req.displayName }}</q-item-label>
            </q-item-section>

            <q-item-section side>
              <div class="row q-gutter-xs">
                <q-btn
                  flat
                  round
                  icon="check_circle"
                  color="positive"
                  :loading="processingId === req.id + '_accept'"
                  @click="handleAccept(req)"
                >
                  <q-tooltip>Aceptar</q-tooltip>
                </q-btn>
                <q-btn
                  flat
                  round
                  icon="cancel"
                  color="negative"
                  :loading="processingId === req.id + '_reject'"
                  @click="handleReject(req)"
                >
                  <q-tooltip>Rechazar</q-tooltip>
                </q-btn>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </q-expansion-item>

      <!-- ── Lista de miembros ────────────────────────────────────────────── -->
      <div class="text-subtitle1 text-weight-bold q-mb-sm">
        <q-icon name="people" class="q-mr-xs text-green-9" />Miembros
      </div>

      <q-list bordered separator class="rounded-borders">
        <q-item
          v-for="member in members"
          :key="member.id"
          class="q-py-sm"
        >
          <q-item-section avatar>
            <q-avatar>
              <img
                v-if="member.photoURL"
                :src="member.photoURL"
                :alt="member.displayName"
                referrerpolicy="no-referrer"
              />
              <q-icon v-else name="person" />
            </q-avatar>
          </q-item-section>

          <q-item-section>
            <q-item-label>
              {{ member.displayName }}
            </q-item-label>
            <q-item-label caption>
              <q-badge
                :color="roleColor(member.role)"
                :label="roleLabel(member.role)"
              />
            </q-item-label>
          </q-item-section>

          <!-- Opciones de gestión (visible si puede gestionar a este miembro) -->
          <q-item-section side v-if="canManageMember(member)">
            <q-btn flat round icon="more_vert" size="sm">
              <q-menu anchor="bottom right" self="top right">
                <q-list style="min-width: 200px">
                  <q-item
                    v-if="member.role === 'member' && myRole === 'owner'"
                    clickable
                    v-close-popup
                    @click="handlePromote(member)"
                  >
                    <q-item-section avatar>
                      <q-icon name="admin_panel_settings" color="blue-7" />
                    </q-item-section>
                    <q-item-section>Hacer administrador</q-item-section>
                  </q-item>

                  <q-item
                    clickable
                    v-close-popup
                    class="text-negative"
                    @click="handleRemove(member)"
                  >
                    <q-item-section avatar>
                      <q-icon name="person_remove" color="negative" />
                    </q-item-section>
                    <q-item-section>Expulsar del grupo</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-btn>
          </q-item-section>
        </q-item>
      </q-list>

      <!-- Salir del grupo (solo si no es owner) -->
      <div class="q-mt-xl text-center" v-if="myRole && myRole !== 'owner'">
        <q-btn
          outline
          color="negative"
          label="Salir del grupo"
          icon="exit_to_app"
          @click="handleLeave"
        />
      </div>

      <!-- ── Partidos del grupo ─────────────────────────────────────────── -->
      <div class="text-subtitle1 text-weight-bold q-mt-xl q-mb-sm">
        <q-icon name="sports_soccer" class="q-mr-xs text-green-9" />Partidos
      </div>

      <div v-if="matches.length === 0" class="text-center text-grey-5 q-py-lg">
        <q-icon name="event_busy" size="40px" class="q-mb-xs" />
        <div class="text-body2">No hay partidos en este grupo todavía</div>
      </div>

      <q-list v-else bordered separator class="rounded-borders">
        <q-item
          v-for="match in matches"
          :key="match.id"
          clickable
          :to="{ name: 'match-detail', params: { id: match.id } }"
        >
          <q-item-section>
            <q-item-label class="text-weight-medium">{{ match.title }}</q-item-label>
            <q-item-label caption>
              <q-icon name="calendar_today" size="xs" class="q-mr-xs" />
              {{ match.date ? formatMatchDate(match.date) : 'Sin fecha definida' }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-chip
              dense
              :color="matchStatusColor(match.status)"
              text-color="white"
              :label="matchStatusLabel(match.status)"
            />
          </q-item-section>
        </q-item>
      </q-list>

    </template>
  </q-page>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGroups } from 'src/composables/useGroups'
import { useMatch } from 'src/composables/useMatch'
import { useAuthStore } from 'src/stores/auth.store'
import { useQuasar } from 'quasar'

const route = useRoute()
const router = useRouter()
const $q = useQuasar()
const authStore = useAuthStore()

const {
  getGroup,
  getGroupMembers,
  getJoinRequests,
  acceptJoinRequest,
  rejectJoinRequest,
  leaveGroup,
  removeMember,
  promoteToAdmin,
  getMyRole,
  regenerateInviteCode,
} = useGroups()

const { matches, subscribeToGroupMatches, stopListening } = useMatch()

const groupId = route.params.id
const group = ref(null)
const members = ref([])
const joinRequests = ref([])
const myRole = ref(null)
const loadingGroup = ref(true)
const processingId = ref(null)

const inviteLink = computed(() => {
  if (!group.value) return ''
  return `${window.location.origin}/grupos/unirse?code=${group.value.inviteCode}`
})

onMounted(async () => {
  try {
    const [g, mems, reqs, role] = await Promise.all([
      getGroup(groupId),
      getGroupMembers(groupId),
      getJoinRequests(groupId),
      getMyRole(groupId),
    ])
    group.value = g
    members.value = mems
    joinRequests.value = reqs
    myRole.value = role
  } finally {
    loadingGroup.value = false
  }
  subscribeToGroupMatches(groupId)
})

onUnmounted(() => {
  stopListening()
})

// ── Helpers de rol ─────────────────────────────────────────────────────────
function roleLabel(role) {
  return { owner: 'Propietario', admin: 'Administrador', member: 'Miembro' }[role] ?? role
}

function roleColor(role) {
  return { owner: 'green-9', admin: 'blue-7', member: 'grey-5' }[role] ?? 'grey-5'
}

function canManageMember(member) {
  if (member.userId === authStore.user.uid) return false
  if (member.role === 'owner') return false
  if (myRole.value === 'owner') return true
  if (myRole.value === 'admin' && member.role === 'member') return true
  return false
}

// ── Copiar enlace ──────────────────────────────────────────────────────────
async function copyInviteLink() {
  try {
    await navigator.clipboard.writeText(inviteLink.value)
    $q.notify({ type: 'positive', message: 'Enlace copiado al portapapeles' })
  } catch {
    $q.notify({ type: 'warning', message: 'No se pudo copiar automáticamente. Cópialo manualmente.' })
  }
}

// ── Aceptar solicitud ──────────────────────────────────────────────────────
async function handleAccept(req) {
  processingId.value = req.id + '_accept'
  try {
    await acceptJoinRequest(groupId, req.userId, req.displayName, req.photoURL)
    joinRequests.value = joinRequests.value.filter(r => r.id !== req.id)
    members.value = await getGroupMembers(groupId)
    if (group.value) group.value.memberCount++
    $q.notify({ type: 'positive', message: `${req.displayName} aceptado en el grupo` })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    processingId.value = null
  }
}

// ── Rechazar solicitud ─────────────────────────────────────────────────────
async function handleReject(req) {
  processingId.value = req.id + '_reject'
  try {
    await rejectJoinRequest(groupId, req.userId)
    joinRequests.value = joinRequests.value.filter(r => r.id !== req.id)
    $q.notify({ type: 'info', message: `Solicitud de ${req.displayName} rechazada` })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  } finally {
    processingId.value = null
  }
}

// ── Salir del grupo ────────────────────────────────────────────────────────
function handleLeave() {
  $q.dialog({
    title: 'Salir del grupo',
    message: `¿Estás seguro de que quieres salir de "${group.value?.name}"?`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { unelevated: true, color: 'negative', label: 'Salir' },
    persistent: true,
  }).onOk(async () => {
    try {
      await leaveGroup(groupId)
      $q.notify({ type: 'positive', message: 'Saliste del grupo correctamente' })
      router.push({ name: 'groups' })
    } catch (err) {
      $q.notify({ type: 'negative', message: err.message })
    }
  })
}

// ── Expulsar miembro ───────────────────────────────────────────────────────
function handleRemove(member) {
  $q.dialog({
    title: 'Expulsar miembro',
    message: `¿Expulsar a ${member.displayName} del grupo?`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { unelevated: true, color: 'negative', label: 'Expulsar' },
  }).onOk(async () => {
    try {
      await removeMember(groupId, member.userId)
      members.value = members.value.filter(m => m.userId !== member.userId)
      if (group.value) group.value.memberCount--
      $q.notify({ type: 'positive', message: `${member.displayName} fue expulsado del grupo` })
    } catch (err) {
      $q.notify({ type: 'negative', message: err.message })
    }
  })
}

// ── Promover a admin ───────────────────────────────────────────────────────
async function handlePromote(member) {
  try {
    await promoteToAdmin(groupId, member.userId)
    const idx = members.value.findIndex(m => m.userId === member.userId)
    if (idx !== -1) members.value[idx] = { ...members.value[idx], role: 'admin' }
    $q.notify({ type: 'positive', message: `${member.displayName} es ahora administrador` })
  } catch (err) {
    $q.notify({ type: 'negative', message: err.message })
  }
}

// ── Regenerar código ───────────────────────────────────────────────────────
function handleRegenerateCode() {
  $q.dialog({
    title: 'Regenerar código de invitación',
    message: 'El enlace anterior dejará de funcionar. ¿Continuar?',
    cancel: { flat: true, label: 'Cancelar' },
    ok: { unelevated: true, color: 'green-9', label: 'Regenerar' },
  }).onOk(async () => {
    try {
      const newCode = await regenerateInviteCode(groupId)
      if (group.value) group.value.inviteCode = newCode
      $q.notify({ type: 'positive', message: 'Código de invitación regenerado' })
    } catch (err) {
      $q.notify({ type: 'negative', message: err.message })
    }
  })
}

// ── Helpers de partidos ────────────────────────────────────────────────────
function formatMatchDate(ts) {
  const date = ts?.toDate ? ts.toDate() : new Date(ts)
  return date.toLocaleDateString('es-AR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function matchStatusLabel(status) {
  return {
    scheduled: 'Programado',
    open: 'Abierto',
    closed: 'Cerrado',
    finished: 'Finalizado',
  }[status] ?? status
}

function matchStatusColor(status) {
  return {
    scheduled: 'blue-grey-5',
    open: 'green-8',
    closed: 'orange-7',
    finished: 'grey-6',
  }[status] ?? 'grey-5'
}
</script>
