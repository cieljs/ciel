import type { ObjectDirective } from 'vue';

const cleanups = new WeakMap<HTMLElement, () => void>();
const enabled = new WeakMap<HTMLElement, boolean>();
/** 距底部多少像素内算「还贴着底部」，留出亚像素与行高误差。 */
const NEAR_BOTTOM = 24;

/**
 * 内容流式更新时跟随底部；用户自己往上滚就停下，滚回底部再自动跟随。
 *
 * 滚离底部时在元素上挂 `data-detached`，容器外的「返回底部」按钮据此显示。
 */
export const vFollowScroll: ObjectDirective<HTMLElement> = {
  mounted(element, binding) {
    enabled.set(element, binding.value !== false);
    let atBottom = true;
    /** 用户是否主动滚离过底部；在那之前即使宿主关掉 autoScroll 也要保持贴底。 */
    let everDetached = false;

    const near = () => {
      // 面板不可见时几何量都是 0，保持原状态，否则会被误判成「已滚离底部」。
      if (element.clientHeight === 0) {
        return atBottom;
      }

      return element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_BOTTOM;
    };

    const follow = () => {
      if (!atBottom) {
        return;
      }

      // autoScroll 只在用户已经自己翻过之后才生效，否则首次进入会停在顶部。
      if (!enabled.get(element) && everDetached) {
        return;
      }

      element.scrollTop = element.scrollHeight;
    };

    // 程序化吸底自身也会触发 scroll，重新判定后仍是「在底部」，不会自锁。
    const onScroll = () => {
      const next = near();

      if (next === atBottom) {
        return;
      }

      atBottom = next;

      if (!atBottom) {
        everDetached = true;
      }

      element.toggleAttribute('data-detached', !atBottom);
    };

    const observer = new MutationObserver(follow);

    observer.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    // 分栏尺寸变化（拖宽/拉高）时继续吸底。
    const resizeObserver = new ResizeObserver(follow);
    resizeObserver.observe(element);
    element.addEventListener('scroll', onScroll, { passive: true });
    // 图片加载会改变内容高度，此时只有仍贴着底部才需要跟随。
    element.addEventListener('load', follow, true);

    cleanups.set(element, () => {
      observer.disconnect();
      resizeObserver.disconnect();
      element.removeEventListener('scroll', onScroll);
      element.removeEventListener('load', follow, true);
    });

    // 挂载时视为贴着底部：清掉可能由复用节点留下的属性。
    element.toggleAttribute('data-detached', false);
    follow();
  },
  updated(element, binding) {
    enabled.set(element, binding.value !== false);
  },
  unmounted(element) {
    enabled.delete(element);
    cleanups.get(element)?.();
    cleanups.delete(element);
  },
};
