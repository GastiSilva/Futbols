<template>
  <router-view />
</template>

<script setup>
import { onMounted } from 'vue'
import { useAuth } from 'src/composables/useAuth'

const { initAuthListener } = useAuth()

// Inicia el listener de Firebase Auth una única vez en el root
onMounted(() => initAuthListener())
</script>
