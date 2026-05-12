<template>
  <q-page class="flex flex-center">
    <div class="text-center q-pa-xl">
      <q-icon name="sports_soccer" size="72px" color="green-9" class="q-mb-md" />
      <div class="text-h4 text-weight-bold q-mb-sm">404</div>
      <div class="text-h6 text-grey-7 q-mb-lg">Página no encontrada</div>
      <q-btn
        unelevated
        color="green-9"
        label="Volver al inicio"
        icon="home"
        :to="{ name: 'player-dashboard' }"
      />
    </div>
  </q-page>
</template>

<script setup>
</script>
