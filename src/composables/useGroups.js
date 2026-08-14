// src/composables/useGroups.js
// ─────────────────────────────────────────────────────────────────────────────
// Composable para gestionar grupos de amigos.
// ─────────────────────────────────────────────────────────────────────────────
import { ref } from 'vue'
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  increment,
} from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

// Estado reactivo compartido entre instancias del composable — se actualiza al instante
const groups = ref([])

// Pisa `displayName` con el nickname actual del usuario (users/{uid}.nickname)
// en una lista de docs cuyo `id`/`userId` es el uid, y de paso denormaliza un
// resumen de su Mundial personal (users/{uid}.mundial) en `item.mundial` — se
// reusa esta misma lectura para no agregar un N+1 aparte (ver LeaderboardPage,
// tab "Mundial"). Silencioso ante errores de lectura individuales: se queda
// con el displayName congelado y sin mundial como fallback.
async function resolveNicknames(items) {
  const snaps = await Promise.all(
    items.map(item => getDoc(doc(db, 'users', item.userId ?? item.id)).catch(() => null)),
  )
  return items.map((item, i) => {
    const data = snaps[i]?.exists() ? snaps[i].data() : null
    const nickname = data?.nickname ?? null
    return {
      ...item,
      ...(nickname ? { displayName: nickname } : {}),
      mundial: data?.mundial
        ? { active: data.mundial.active, phase: data.mundial.phase, titles: data.mundial.titles ?? 0 }
        : null,
    }
  })
}

// Genera un código de 8 caracteres sin letras/números ambiguos (O, 0, I, 1)
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export function useGroups() {
  const authStore = useAuthStore()
  const loading = ref(false)
  const error = ref(null)

  // ── Crear grupo ────────────────────────────────────────────────────────────
  async function createGroup({ name, description = '' }) {
    loading.value = true
    error.value = null
    try {
      const uid = authStore.user.uid
      const trimmedName = name.trim()
      const inviteCode = generateInviteCode()

      const groupRef = await addDoc(collection(db, 'groups'), {
        name: trimmedName,
        nameLower: trimmedName.toLowerCase(),
        description: description.trim(),
        inviteCode,
        createdBy: uid,
        memberCount: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // El creador se agrega como 'owner'
      await setDoc(doc(db, 'groups', groupRef.id, 'members', uid), {
        userId: uid,
        displayName: authStore.user.nickname || authStore.user.displayName,
        photoURL: authStore.user.photoURL ?? null,
        role: 'owner',
        joinedAt: serverTimestamp(),
      })

      // Actualizar estado reactivo al instante
      const newGroupSnap = await getDoc(doc(db, 'groups', groupRef.id))
      if (newGroupSnap.exists()) {
        groups.value = [...groups.value, { id: newGroupSnap.id, ...newGroupSnap.data() }]
      }

      // El creador entra como 'owner', o sea miembro CON acceso anticipado.
      // Sin reflejarlo en el store, quien acaba de crear el grupo no podía
      // anotarse a sus propios partidos hasta volver a iniciar sesión.
      if (!authStore.memberGroupIds.includes(groupRef.id)) {
        authStore.setMemberGroups([...authStore.memberGroupIds, groupRef.id])
      }
      if (!authStore.ogGroupIds.includes(groupRef.id)) {
        authStore.setOgGroups([...authStore.ogGroupIds, groupRef.id])
      }

      return groupRef.id
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

// ── Mis grupos (collectionGroup query en members) ──────────────────────────
  async function getMyGroups() {
    loading.value = true
    error.value = null
    try {
      const uid = authStore.user?.uid

      if (!uid) {
        return []
      }

      const q = query(collectionGroup(db, 'members'), where('userId', '==', uid))
      const snaps = await getDocs(q)

      const groupIds = snaps.docs.map(d => d.ref.parent.parent.id)

      if (groupIds.length === 0) {
        groups.value = []
        return []
      }

      const groupSnaps = await Promise.all(
        groupIds.map(id => getDoc(doc(db, 'groups', id))),
      )

      const result = groupSnaps
        .filter(snap => snap.exists())
        .map(snap => ({ id: snap.id, ...snap.data() }))

      groups.value = result
      return result
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Cambiar la foto de perfil de un grupo (subida de archivo) ──────────────
  // Sube la imagen a Storage en groups/{groupId}/photo.{ext} (mismo path se
  // sobreescribe en cada cambio) y guarda la download URL en el doc del grupo.
  // Se agrega ?v=timestamp para evitar que el navegador cachee la foto vieja.
  async function uploadGroupPhoto(groupId, file) {
    loading.value = true
    error.value = null
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const fileRef = storageRef(storage, `groups/${groupId}/photo.${ext}`)
      await uploadBytes(fileRef, file, { contentType: file.type })
      const rawURL = await getDownloadURL(fileRef)
      const photoURL = `${rawURL}${rawURL.includes('?') ? '&' : '?'}v=${Date.now()}`

      await updateDoc(doc(db, 'groups', groupId), {
        photoURL,
        updatedAt: serverTimestamp(),
      })

      // Actualizar estado reactivo al instante
      groups.value = groups.value.map((g) =>
        g.id === groupId ? { ...g, photoURL } : g,
      )

      return photoURL
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Obtener un grupo ───────────────────────────────────────────────────────
  async function getGroup(groupId) {
    const snap = await getDoc(doc(db, 'groups', groupId))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() }
  }

  // ── Obtener miembros de un grupo ───────────────────────────────────────────
  // El displayName queda congelado en el member doc al momento del join; acá
  // lo pisamos con el nickname actual (users/{uid}.nickname) si el usuario se
  // puso uno después, para no mostrar el nombre de Google/email desactualizado.
  const MEMBER_ROLE_ORDER = { owner: 0, admin: 1, member: 2 }

  async function getGroupMembers(groupId) {
    const q = query(collection(db, 'groups', groupId, 'members'), orderBy('joinedAt', 'asc'))
    const snaps = await getDocs(q)
    const members = snaps.docs.map(d => ({ id: d.id, ...d.data() }))
    const withNicknames = await resolveNicknames(members)
    // Owner primero, después admins, después miembros — dentro de cada rol se
    // mantiene el orden de ingreso (Array.sort es estable).
    return withNicknames.sort(
      (a, b) => (MEMBER_ROLE_ORDER[a.role] ?? 3) - (MEMBER_ROLE_ORDER[b.role] ?? 3),
    )
  }

  // ── Obtener solicitudes de ingreso pendientes ──────────────────────────────
  async function getJoinRequests(groupId) {
    const q = query(
      collection(db, 'groups', groupId, 'joinRequests'),
      where('status', '==', 'pending'),
    )
    const snaps = await getDocs(q)
    const requests = snaps.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.requestedAt?.seconds ?? 0) - (b.requestedAt?.seconds ?? 0))
    return resolveNicknames(requests)
  }

  // ── Buscar grupos por nombre (contiene, no solo "empieza con") ─────────────
  // Antes era un prefix-match ("nameLower >= term") que solo encontraba
  // grupos cuyo NOMBRE COMPLETO empezaba con el término buscado — si el grupo
  // se llamaba "Los Pibes FC" y buscabas "pibes", no aparecía nada (por eso
  // la búsqueda se sentía rota). Ahora se trae un lote de grupos y se filtra
  // por substring en el cliente — a esta escala (decenas/cientos de grupos)
  // alcanza de sobra, sin necesitar un índice de búsqueda por palabras.
  async function searchGroups(searchTerm) {
    if (!searchTerm.trim()) return []
    const term = searchTerm.trim().toLowerCase()
    const q = query(collection(db, 'groups'), orderBy('nameLower', 'asc'), limit(300))
    const snaps = await getDocs(q)
    return snaps.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(g => (g.nameLower ?? '').includes(term))
      .slice(0, 20)
  }

  // ── Solicitar unirse a un grupo ────────────────────────────────────────────
  async function requestToJoin(groupId) {
    loading.value = true
    error.value = null
    try {
      const uid = authStore.user.uid

      const memberSnap = await getDoc(doc(db, 'groups', groupId, 'members', uid))
      if (memberSnap.exists()) throw new Error('Ya eres miembro de este grupo.')

      const reqSnap = await getDoc(doc(db, 'groups', groupId, 'joinRequests', uid))
      if (reqSnap.exists() && reqSnap.data().status === 'pending') {
        throw new Error('Ya enviaste una solicitud para este grupo.')
      }

      await setDoc(doc(db, 'groups', groupId, 'joinRequests', uid), {
        userId: uid,
        displayName: authStore.user.nickname || authStore.user.displayName,
        photoURL: authStore.user.photoURL ?? null,
        requestedAt: serverTimestamp(),
        status: 'pending',
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Unirse por código de invitación ───────────────────────────────────────
  async function joinByInviteCode(code) {
    loading.value = true
    error.value = null
    try {
      const uid = authStore.user.uid
      const normalizedCode = code.trim().toUpperCase()

      const q = query(
        collection(db, 'groups'),
        where('inviteCode', '==', normalizedCode),
        limit(1),
      )
      const snaps = await getDocs(q)
      if (snaps.empty) throw new Error('Código de invitación inválido.')

      const groupId = snaps.docs[0].id

      const memberSnap = await getDoc(doc(db, 'groups', groupId, 'members', uid))
      if (memberSnap.exists()) return { groupId, alreadyMember: true }

      await runTransaction(db, async tx => {
        tx.set(doc(db, 'groups', groupId, 'members', uid), {
          userId: uid,
          displayName: authStore.user.nickname || authStore.user.displayName,
          photoURL: authStore.user.photoURL ?? null,
          role: 'member',
          joinedAt: serverTimestamp(),
        })
        tx.update(doc(db, 'groups', groupId), {
          memberCount: increment(1),
          updatedAt: serverTimestamp(),
        })
      })

      // Espejo en users/{uid}/groups — es lo que lee getMyGroups. Sin esto el
      // grupo recién unido no aparecía en "Mis grupos" hasta el siguiente
      // login (acceptJoinRequest sí lo escribía; esta rama se lo salteaba).
      await setDoc(doc(db, 'users', uid, 'groups', groupId), {
        joinedAt: serverTimestamp(),
      })

      // Actualizar estado reactivo al instante
      const joinedSnap = await getDoc(doc(db, 'groups', groupId))
      if (joinedSnap.exists() && !groups.value.some(g => g.id === groupId)) {
        groups.value = [...groups.value, { id: joinedSnap.id, ...joinedSnap.data() }]
      }

      // El store de membresía se carga en el login: sin esto, el usuario recién
      // unido seguía viendo el botón "Anotarme" deshabilitado en los partidos
      // de este grupo hasta cerrar y volver a entrar (ver refreshMyGroups).
      if (!authStore.memberGroupIds.includes(groupId)) {
        authStore.setMemberGroups([...authStore.memberGroupIds, groupId])
      }

      return { groupId, alreadyMember: false }
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Aceptar solicitud de ingreso ───────────────────────────────────────────
  async function acceptJoinRequest(groupId, userId, displayName, photoURL) {
    loading.value = true
    error.value = null
    try {
      await runTransaction(db, async tx => {
        tx.set(doc(db, 'groups', groupId, 'members', userId), {
          userId,
          displayName,
          photoURL: photoURL ?? null,
          role: 'member',
          joinedAt: serverTimestamp(),
        })
        // También guardar en /users/{userId}/groups/{groupId} para getMyGroups
        tx.set(doc(db, 'users', userId, 'groups', groupId), {
          joinedAt: serverTimestamp(),
        })
        tx.update(doc(db, 'groups', groupId, 'joinRequests', userId), {
          status: 'accepted',
        })
        tx.update(doc(db, 'groups', groupId), {
          memberCount: increment(1),
          updatedAt: serverTimestamp(),
        })
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Rechazar solicitud de ingreso ──────────────────────────────────────────
  async function rejectJoinRequest(groupId, userId) {
    loading.value = true
    error.value = null
    try {
      await updateDoc(doc(db, 'groups', groupId, 'joinRequests', userId), {
        status: 'rejected',
      })
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Salir del grupo ────────────────────────────────────────────────────────
  async function leaveGroup(groupId) {
    loading.value = true
    error.value = null
    try {
      const uid = authStore.user.uid
      await runTransaction(db, async tx => {
        tx.delete(doc(db, 'groups', groupId, 'members', uid))
        // También borrar de /users/{uid}/groups/{groupId}
        tx.delete(doc(db, 'users', uid, 'groups', groupId))
        tx.update(doc(db, 'groups', groupId), {
          memberCount: increment(-1),
          updatedAt: serverTimestamp(),
        })
      })
      // Actualizar estado reactivo al instante
      groups.value = groups.value.filter(g => g.id !== groupId)
      // Y también la membresía del store: si no, los partidos de un grupo del
      // que ya me fui me seguían apareciendo como propios hasta re-loguear.
      authStore.setMemberGroups(authStore.memberGroupIds.filter(id => id !== groupId))
      authStore.setOgGroups(authStore.ogGroupIds.filter(id => id !== groupId))
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Expulsar miembro (admin/owner) ─────────────────────────────────────────
  // Al expulsar se ROTA el código de invitación del grupo. Sin eso, el
  // expulsado se vuelve a meter solo: el código que ya conoce sigue siendo
  // válido, así que echarlo no servía de nada. El costo es que los links
  // viejos dejan de andar para todos — es el precio de que la expulsión
  // signifique algo, y el owner/admin puede volver a compartir el nuevo.
  async function removeMember(groupId, userId) {
    loading.value = true
    error.value = null
    try {
      const newCode = generateInviteCode()
      await runTransaction(db, async tx => {
        // Lecturas primero (requisito de las transacciones de Firestore)
        const groupSnap = await tx.get(doc(db, 'groups', groupId))
        const prevCount = groupSnap.exists() ? (groupSnap.data().memberCount ?? 0) : 0

        tx.delete(doc(db, 'groups', groupId, 'members', userId))
        // También borrar de /users/{userId}/groups/{groupId}
        tx.delete(doc(db, 'users', userId, 'groups', groupId))
        tx.update(doc(db, 'groups', groupId), {
          // Nunca por debajo de 0: las reglas rechazan un memberCount negativo,
          // y con increment(-1) sobre un contador ya en 0 la expulsión fallaba.
          memberCount: Math.max(0, prevCount - 1),
          inviteCode: newCode,
          updatedAt: serverTimestamp(),
        })
      })
      // Reflejar el código nuevo en el estado compartido, sin recargar
      groups.value = groups.value.map(g =>
        g.id === groupId ? { ...g, inviteCode: newCode } : g,
      )
      return { newInviteCode: newCode }
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Promover a admin ───────────────────────────────────────────────────────
  async function promoteToAdmin(groupId, userId) {
    await updateDoc(doc(db, 'groups', groupId, 'members', userId), { role: 'admin' })
  }

  // ── Marcar / desmarcar OG (acceso anticipado 30 min a las listas) ──────────
  async function setMemberOG(groupId, userId, og) {
    await updateDoc(doc(db, 'groups', groupId, 'members', userId), { og: !!og })
  }

  // ── Obtener mi rol en el grupo ─────────────────────────────────────────────
  async function getMyRole(groupId) {
    const uid = authStore.user.uid
    const snap = await getDoc(doc(db, 'groups', groupId, 'members', uid))
    if (!snap.exists()) return null
    return snap.data().role
  }

  // ── Regenerar código de invitación ─────────────────────────────────────────
  async function regenerateInviteCode(groupId) {
    const newCode = generateInviteCode()
    await updateDoc(doc(db, 'groups', groupId), {
      inviteCode: newCode,
      updatedAt: serverTimestamp(),
    })
    return newCode
  }

  return {
    loading,
    error,
    groups,
    createGroup,
    uploadGroupPhoto,
    getMyGroups,
    getGroup,
    getGroupMembers,
    getJoinRequests,
    searchGroups,
    requestToJoin,
    joinByInviteCode,
    acceptJoinRequest,
    rejectJoinRequest,
    leaveGroup,
    removeMember,
    promoteToAdmin,
    setMemberOG,
    getMyRole,
    regenerateInviteCode,
  }
}
