import type { Component } from 'vue';

/** 匹配一条消息所需的纯数据；`json` 只在整串文本本身就是 JSON 对象/数组时存在。 */
export interface MessageRendererMatch {
  /** 消息角色：assistant / user / perception / toolResult 等。 */
  name: string;
  /** 条目上的标签，例如「视频语音 · 1:20」「关键词唤醒」。 */
  label?: string;
  /** 消息原始文本，没有文本时为空串。 */
  text: string;
  json?: unknown;
}

/** 宿主自定义消息渲染器收到的纯数据：Ciel Console 负责取值，渲染器只负责展示。 */
export interface MessageRendererProps extends MessageRendererMatch {
  model?: string;
  status: 'running' | 'completed' | 'error';
}

export interface MessageRenderer {
  /**
   * 命中即用 `component` 渲染整条消息，未命中继续找下一个渲染器，最后走默认 Markdown/图片渲染。
   *
   * 用谓词而不是按角色索引，是因为同一条 assistant 消息既可能是结构化输出也可能是普通回复，
   * 宿主必须能「认不出就交还默认渲染」，不必在自己的组件里复刻 Ciel Console 的默认渲染。
   */
  match: (message: MessageRendererMatch) => boolean;
  component: Component;
}

/** 宿主传入的消息渲染器；请用普通常量或 markRaw，不要放进 reactive。 */
export type MessageRenderers = readonly MessageRenderer[];

/** 第一个命中的渲染器，没有命中返回 undefined。 */
export function messageRenderer(
  match: MessageRendererMatch,
  renderers?: MessageRenderers,
): Component | undefined {
  return renderers?.find(renderer => renderer.match(match))?.component;
}
