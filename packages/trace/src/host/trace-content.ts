import type { AgentMessage } from '@earendil-works/pi-agent-core';

export function messageContent(message: AgentMessage) {
  if (message.role !== 'assistant' && message.role !== 'user' && message.role !== 'toolResult') {
    return { text: '', thinking: '' };
  }

  if (typeof message.content === 'string') {
    return { text: message.content, thinking: '' };
  }

  let text = '';
  let thinking = '';

  for (const block of message.content) {
    if (block.type === 'text') {
      text += block.text;
    }

    if (block.type === 'thinking') {
      thinking += block.thinking;
    }
  }

  return { text: text, thinking: thinking };
}

export function preview(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 160 ? `${value.slice(0, 160)}… (${value.length} chars)` : value;
  }

  if (value === null || typeof value !== 'object') {
    return String(value).slice(0, 160);
  }

  if (ArrayBuffer.isView(value)) {
    return `${value.constructor.name} (${value.byteLength} bytes)`;
  }

  if (value instanceof ArrayBuffer) {
    return `ArrayBuffer (${value.byteLength} bytes)`;
  }

  if (Array.isArray(value)) {
    return `Array (${value.length})`;
  }

  if (value instanceof Date) {
    return String(value);
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message.slice(0, 160)}`;
  }

  if (value instanceof Map || value instanceof Set) {
    return `${value.constructor.name} (${value.size})`;
  }

  return 'Object';
}
