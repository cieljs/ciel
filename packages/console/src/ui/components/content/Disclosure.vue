<script setup lang="ts">
import { Collapsible } from '@vuetify/v0/components';
import { shallowRef } from 'vue';

const props = withDefaults(defineProps<{ title: string; defaultOpen?: boolean }>(), {
  defaultOpen: true,
});

const open = shallowRef(props.defaultOpen);
</script>

<template>
  <Collapsible.Root v-model="open" class="dt-section">
    <Collapsible.Activator class="dt-disclosure">
      <Collapsible.Cue class="dt-cue">›</Collapsible.Cue>
      <span class="dt-disclosure-title"
        ><slot name="title">{{ title }}</slot></span
      >
      <slot name="trailing" />
    </Collapsible.Activator>
    <Collapsible.Content class="dt-section-content"><slot /></Collapsible.Content>
  </Collapsible.Root>
</template>
