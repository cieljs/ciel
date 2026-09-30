import type { Component } from 'vue';

/**
 * 宿主自定义工具渲染器收到的纯数据：Ciel Console 负责取值与加载状态，渲染器只负责展示。
 *
 * `result` 是工具的原始返回（`{ content, details }`），未取到时为 undefined；
 * `loadError` 是 Ciel Console 取值失败，与工具执行失败的 `status === 'error'` 不是一回事。
 */
export interface ToolRendererProps {
  name: string;
  label?: string;
  description?: string;
  status: 'running' | 'completed' | 'error';
  toolCallId: string;
  args: unknown;
  result: unknown;
  loading: boolean;
  loadError: string;
}

/** 按工具机器名索引的自定义渲染器；组件只替换块的正文，标题与状态仍由 Ciel Console 渲染。 */
export type ToolRenderers = Record<string, Component>;
