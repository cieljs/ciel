<script setup lang="ts">
import InvestigationWindow from './components/InvestigationWindow.vue';
import WatchWorkspace from './components/WatchWorkspace.vue';

const view = new URLSearchParams(window.location.search).get('view');
</script>

<template>
  <InvestigationWindow v-if="view === 'investigation'" />
  <WatchWorkspace v-else />
</template>
