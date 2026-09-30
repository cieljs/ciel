export function biliResult(details: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

/** 搜索结果标题会用 <em> 标注关键词，返回前需要去掉标签。 */
export function stripHtmlTags(text: string) {
  return text.replace(/<[^>]*>/g, '');
}

/** B 站接口常返回 //i0.hdslb.com/... 这样的协议相对地址。 */
export function normalizeUrl(url: string | null | undefined) {
  if (!url) {
    return undefined;
  }

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  return url;
}

export function compactStrings(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value));
}
