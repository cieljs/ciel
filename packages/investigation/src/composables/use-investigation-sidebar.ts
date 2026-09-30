import { computed, onMounted, onUnmounted, shallowRef } from 'vue';

const MIN_WIDTH = 176;
const MAX_WIDTH = 320;
const RESERVED_WIDTH = 520;

export function useInvestigationSidebar() {
  const width = shallowRef(216);
  const viewportWidth = shallowRef(window.innerWidth);
  const dragging = shallowRef(false);

  const maxWidth = computed(() =>
    Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth.value - RESERVED_WIDTH)),
  );

  function resize(value: number) {
    width.value = Math.max(MIN_WIDTH, Math.min(maxWidth.value, value));
  }

  function updateViewport() {
    viewportWidth.value = window.innerWidth;
    resize(width.value);
  }

  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.value = true;
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent) {
    if (dragging.value) {
      resize(event.clientX);
    }
  }

  function endDrag() {
    dragging.value = false;
  }

  function keyboardResize(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') {
      resize(width.value - 16);
    } else if (event.key === 'ArrowRight') {
      resize(width.value + 16);
    } else if (event.key === 'Home') {
      resize(MIN_WIDTH);
    } else if (event.key === 'End') {
      resize(maxWidth.value);
    } else {
      return;
    }

    event.preventDefault();
  }

  onMounted(() => {
    updateViewport();
    window.addEventListener('resize', updateViewport);
  });

  onUnmounted(() => window.removeEventListener('resize', updateViewport));

  return {
    width,
    maxWidth,
    dragging,
    startDrag,
    moveDrag,
    endDrag,
    keyboardResize,
  };
}
