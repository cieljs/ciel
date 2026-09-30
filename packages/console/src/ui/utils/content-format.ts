/** 从消息值里取纯文本：字符串本身，或 content 为字符串的对象。 */
export function messageText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if ('content' in value && typeof value.content === 'string') {
    return value.content;
  }

  return undefined;
}

/** 判断消息是否已经产生可展示正文；元数据字段本身不应回落成 JSON。 */
export function hasMessageContent(value: unknown): boolean {
  const text = messageText(value);

  if (text !== undefined) {
    return Boolean(text.trim());
  }

  if (!value || typeof value !== 'object' || !('content' in value)) {
    return false;
  }

  const content = value.content;

  if (!Array.isArray(content)) {
    return false;
  }

  return content.some(block => {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      return false;
    }

    if (block.type === 'text') {
      return 'text' in block && Boolean(String(block.text).trim());
    }

    if (block.type === 'thinking') {
      return 'thinking' in block && Boolean(String(block.thinking).trim());
    }

    if (block.type === 'image') {
      return 'data' in block && Boolean(block.data);
    }

    if (block.type === 'toolCall') {
      return true;
    }

    return false;
  });
}

/** 空正文结束时显示可读状态，避免把 Agent 消息元数据直接展示为 JSON。 */
// oxlint-disable-next-line eslint/complexity -- 未知消息结构需要按可展示字段逐项收窄。
export function messageFallback(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '没有返回内容。';
  }

  if ('errorMessage' in value && typeof value.errorMessage === 'string') {
    return value.errorMessage.trim() || '生成失败。';
  }

  if ('content' in value && Array.isArray(value.content)) {
    const refusal = value.content.find(
      block => block && typeof block === 'object' && block.type === 'refusal',
    ) as { refusal?: unknown } | undefined;

    if (typeof refusal?.refusal === 'string' && refusal.refusal.trim()) {
      return refusal.refusal.trim();
    }
  }

  if ('stopReason' in value && value.stopReason === 'aborted') {
    return '生成已停止。';
  }

  if ('stopReason' in value && value.stopReason === 'error') {
    return '生成失败。';
  }

  return '没有返回内容。';
}

/** 整串能解析成 JSON 对象/数组时给出解析结果；混合文本、标量和非法 JSON 都返回 undefined。 */
export function wholeJson(text: string): object | undefined {
  const trimmed = text.trim();

  if (!/^[[{]/.test(trimmed)) {
    return undefined;
  }

  try {
    const data = JSON.parse(trimmed);

    // 标量不算结构化内容，避免把「{」开头的畸形文本当成 JSON 展示。
    return data && typeof data === 'object' ? data : undefined;
  } catch {
    return undefined;
  }
}

// 仅格式化完整独立的 JSON 行，保留原始消息与已有 Markdown 代码块。
export function readableText(value: string) {
  // 工具结果常是多行 JSON，必须整体识别，否则会被 Markdown 当作普通段落。
  const whole = wholeJson(value);

  if (whole !== undefined) {
    return `\n\`\`\`json\n${JSON.stringify(whole, null, 2)}\n\`\`\`\n`;
  }

  let fenced = false;

  return value
    .split('\n')
    .map(line => {
      if (line.trimStart().startsWith('```')) {
        fenced = !fenced;

        return line;
      }

      if (fenced) {
        return line;
      }

      const data = wholeJson(line);

      if (data === undefined) {
        return line;
      }

      return `\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`;
    })
    .join('\n');
}

/** 调试数据可能含 BigInt 或循环引用，先转成能安全序列化的副本。 */
export function jsonSafe(value: unknown): unknown {
  const seen = new WeakSet<object>();

  return JSON.parse(
    JSON.stringify(value ?? null, (_key, item) => {
      if (typeof item === 'bigint') {
        return String(item);
      }

      if (item && typeof item === 'object') {
        if (seen.has(item)) {
          return '[Circular]';
        }

        seen.add(item);
      }

      return item;
    }),
  );
}

/** 缩进后的 JSON 文本：JSON 树视图与 Markdown 代码块共用同一份转义与缩进。 */
export function jsonText(value: unknown): string {
  return JSON.stringify(jsonSafe(value), null, 2);
}

/** 结构化值统一转成 ```json 代码块：文本型载荷走同一条 Markdown 路径，外观一致。 */
export function jsonMarkdown(value: unknown): string {
  return `\`\`\`json\n${jsonText(value)}\n\`\`\``;
}

export function imageSource(block: Record<string, unknown>) {
  if (
    typeof block.mimeType !== 'string' ||
    !/^image\/(png|jpeg|webp|gif)$/.test(block.mimeType) ||
    typeof block.data !== 'string'
  ) {
    return undefined;
  }

  return `data:${block.mimeType};base64,${block.data}`;
}
