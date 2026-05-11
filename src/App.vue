<template>
  <router-view />
</template>

<script setup>
import { onMounted } from 'vue'
import { useAuth } from 'src/composables/useAuth'

onMounted(() => {
  const { initAuthListener } = useAuth()
  initAuthListener()
})
</script>