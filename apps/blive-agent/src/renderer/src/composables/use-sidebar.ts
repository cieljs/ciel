import { computed, onMounted, onUnmounted, shallowRef } from 'vue';

export function useSidebar(side: 'left' | 'right' = 'left') {
  const collapsed = shallowRef(false);
  const width = shallowRef(side === 'left' ? 280 : 420);
  const viewportWidth = shallowRef(window.innerWidth);
  // 两侧面板分别为直播区域预留空间，避免缩窗后侧栏挤满整个工作区。
  const maximumWidth = side === 'left' ? 380 : 900;
  const reservedWidth = side === 'left' ? 600 : 640;

  const maxWidth = computed(() =>
    Math.max(260, Math.min(maximumWidth, viewportWidth.value - reservedWidth)),
  );

  const dragging = shallowRef(false);

  function resize(value: number) {
    width.value = Math.max(260, Math.min(maxWidth.value, value));
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
      resize(side === 'left' ? event.clientX : viewportWidth.value - event.clientX);
    }
  }

  function endDrag() {
    dragging.value = false;
  }

  function keyboardResize(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') {
      resize(width.value + (side === 'left' ? -16 : 16));
    } else if (event.key === 'ArrowRight') {
      resize(width.value + (side === 'left' ? 16 : -16));
    } else if (event.key === 'Home') {
      resize(260);
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

  return { collapsed, width, maxWidth, dragging, startDrag, moveDrag, endDrag, keyboardResize };
}
