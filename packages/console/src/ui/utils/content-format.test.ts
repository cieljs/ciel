import { expect, it } from 'vite-plus/test';

import {
  hasMessageContent,
  jsonMarkdown,
  jsonText,
  messageFallback,
  messageText,
  readableText,
  wholeJson,
} from './content-format.ts';

it('结构化值统一转成 JSON 代码块', () => {
  expect(jsonMarkdown({ a: [1, null] })).toBe(
    '```json\n{\n  "a": [\n    1,\n    null\n  ]\n}\n```',
  );
});

it('BigInt 与循环引用不阻塞序列化', () => {
  const node: { id: bigint; self?: unknown } = { id: 10n };
  node.self = node;
  expect(jsonMarkdown(node)).toBe('```json\n{\n  "id": "10",\n  "self": "[Circular]"\n}\n```');
});

it('jsonText 给出缩进后的纯 JSON 文本', () => {
  expect(jsonText({ action: 'stay', score: 90 })).toBe('{\n  "action": "stay",\n  "score": 90\n}');
  expect(jsonText([1, 'a'])).toBe('[\n  1,\n  "a"\n]');
  // 根值不是对象/数组时也要产出合法 JSON，JSON 树不能拿到裸 undefined。
  expect(jsonText(undefined)).toBe('null');
  expect(jsonText(null)).toBe('null');
  expect(jsonText('文本')).toBe('"文本"');
});

it('jsonText 同样兜住 BigInt 与循环引用', () => {
  const node: { id: bigint; self?: unknown } = { id: 10n };
  node.self = node;
  expect(jsonText(node)).toBe('{\n  "id": "10",\n  "self": "[Circular]"\n}');
});

it('jsonMarkdown 只是把 jsonText 包进代码块', () => {
  const value = { messages: [{ text: '第一行\n第二行' }] };
  expect(jsonMarkdown(value)).toBe(`\`\`\`json\n${jsonText(value)}\n\`\`\``);
});

it('多行工具 JSON 保留转义并展示为 JSON 代码块', () => {
  const value = { messages: [{ content: '第一行\n第二行', path: 'C:\\Videos\\视频.mp4' }] };
  const json = JSON.stringify(value, null, 2);
  expect(readableText(json)).toBe(`\n\`\`\`json\n${json}\n\`\`\`\n`);
});

it('已有代码块和普通 Markdown 不重复包裹', () => {
  const text = '# 内容\n```json\n{ "a": 1 }\n```';
  expect(readableText(text)).toBe(text);
});

it('消息文本只认字符串与 content 字符串', () => {
  expect(messageText('文本')).toBe('文本');
  expect(messageText({ content: '带 blocks 的消息' })).toBe('带 blocks 的消息');
  expect(messageText({ content: [{ type: 'text', text: 'x' }] })).toBeUndefined();
  expect(messageText(undefined)).toBeUndefined();
  expect(messageText(42)).toBeUndefined();
});

it('空流式消息、错误和拒绝使用可读状态而不是消息 JSON', () => {
  expect(hasMessageContent({ role: 'assistant', content: [] })).toBe(false);
  expect(hasMessageContent({ content: [{ type: 'text', text: '回答中' }] })).toBe(true);
  expect(messageFallback({ stopReason: 'aborted', content: [] })).toBe('生成已停止。');

  expect(messageFallback({ stopReason: 'error', errorMessage: '模型不可用', content: [] })).toBe(
    '模型不可用',
  );

  expect(messageFallback({ content: [{ type: 'refusal', refusal: '无法处理这个请求' }] })).toBe(
    '无法处理这个请求',
  );
});

it('整串 JSON 才给结构化结果', () => {
  expect(wholeJson('{"action":"stay","score":90}')).toEqual({ action: 'stay', score: 90 });
  expect(wholeJson('  [1, 2]  ')).toEqual([1, 2]);
  expect(wholeJson('分析如下\n{"a":1}')).toBeUndefined();
  expect(wholeJson('```json\n{"a":1}\n```')).toBeUndefined();
  expect(wholeJson('{"a":')).toBeUndefined();
  expect(wholeJson('{不是 JSON}')).toBeUndefined();
  expect(wholeJson('plain')).toBeUndefined();
});
