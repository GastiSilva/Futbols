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
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  increment,
} from 'firebase/firestore'
import { db } from 'src/services/firebase'
import { useAuthStore } from 'src/stores/auth.store'

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
        displayName: authStore.user.displayName,
        photoURL: authStore.user.photoURL ?? null,
        role: 'owner',
        joinedAt: serverTimestamp(),
      })

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
      console.log("1. Buscando grupos para el UID:", uid)

      if (!uid) {
        console.error("🚨 ERROR: No hay UID al momento de buscar los grupos.")
        return []
      }

      const q = query(collectionGroup(db, 'members'), where('userId', '==', uid))
      const snaps = await getDocs(q)
      
      console.log("2. Cantidad de documentos members encontrados:", snaps.size)

      const groupIds = snaps.docs.map(d => d.ref.parent.parent.id)
      console.log("3. IDs de los grupos extraídos:", groupIds)

      if (groupIds.length === 0) return []

      const groupSnaps = await Promise.all(
        groupIds.map(id => getDoc(doc(db, 'groups', id))),
      )

      return groupSnaps
        .filter(snap => snap.exists())
        .map(snap => ({ id: snap.id, ...snap.data() }))
    } catch (err) {
      error.value = err.message
      console.error("🚨 Error en getMyGroups:", err)
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
  async function getGroupMembers(groupId) {
    const q = query(collection(db, 'groups', groupId, 'members'), orderBy('joinedAt', 'asc'))
    const snaps = await getDocs(q)
    return snaps.docs.map(d => ({ id: d.id, ...d.data() }))
  }

  // ── Obtener solicitudes de ingreso pendientes ──────────────────────────────
  async function getJoinRequests(groupId) {
    const q = query(
      collection(db, 'groups', groupId, 'joinRequests'),
      where('status', '==', 'pending'),
    )
    const snaps = await getDocs(q)
    return snaps.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.requestedAt?.seconds ?? 0) - (b.requestedAt?.seconds ?? 0))
  }

  // ── Buscar grupos por nombre (prefix search) ───────────────────────────────
  async function searchGroups(searchTerm) {
    if (!searchTerm.trim()) return []
    const term = searchTerm.trim().toLowerCase()
    const q = query(
      collection(db, 'groups'),
      where('nameLower', '>=', term),
      where('nameLower', '<=', term + '\uf8ff'),
      limit(20),
    )
    const snaps = await getDocs(q)
    return snaps.docs.map(d => ({ id: d.id, ...d.data() }))
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
        displayName: authStore.user.displayName,
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
          displayName: authStore.user.displayName,
          photoURL: authStore.user.photoURL ?? null,
          role: 'member',
          joinedAt: serverTimestamp(),
        })
        tx.update(doc(db, 'groups', groupId), {
          memberCount: increment(1),
          updatedAt: serverTimestamp(),
        })
      })

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
    } catch (err) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  // ── Expulsar miembro (admin/owner) ─────────────────────────────────────────
  async function removeMember(groupId, userId) {
    loading.value = true
    error.value = null
    try {
      await runTransaction(db, async tx => {
        tx.delete(doc(db, 'groups', groupId, 'members', userId))
        // También borrar de /users/{userId}/groups/{groupId}
        tx.delete(doc(db, 'users', userId, 'groups', groupId))
        tx.update(doc(db, 'groups', groupId), {
          memberCount: increment(-1),
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

  // ── Promover a admin ───────────────────────────────────────────────────────
  async function promoteToAdmin(groupId, userId) {
    await updateDoc(doc(db, 'groups', groupId, 'members', userId), { role: 'admin' })
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
    createGroup,
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
    getMyRole,
    regenerateInviteCode,
  }
}
