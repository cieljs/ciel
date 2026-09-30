import { SessionValidationError } from './errors.ts';
import { normalizeSearchText } from './search.ts';
import type { SessionSource } from './types.ts';

export const MAX_SESSION_SOURCES = 32;
export const MAX_SESSION_SOURCE_LENGTH = 512;
export const MAX_SESSION_SOURCES_BYTES = 32 * 1024;

export function normalizeSources(sources: SessionSource[]): SessionSource[] {
  if (!Array.isArray(sources)) {
    throw new SessionValidationError('sources 必须是字符串数组');
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    if (typeof source !== 'string') {
      throw new SessionValidationError('source 必须是字符串');
    }

    const value = source.normalize('NFKC').trim();

    if (!value) {
      continue;
    }

    if (Array.from(value).length > MAX_SESSION_SOURCE_LENGTH) {
      throw new SessionValidationError(`单个 source 不能超过 ${MAX_SESSION_SOURCE_LENGTH} 个字符`);
    }

    const key = normalizeSearchText(value).toLocaleLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(value);
    }
  }

  if (normalized.length > MAX_SESSION_SOURCES) {
    throw new SessionValidationError(`sources 不能超过 ${MAX_SESSION_SOURCES} 项`);
  }

  if (new TextEncoder().encode(normalized.join('\n')).length > MAX_SESSION_SOURCES_BYTES) {
    throw new SessionValidationError(`sources 总大小不能超过 ${MAX_SESSION_SOURCES_BYTES} 字节`);
  }

  return normalized;
}

export function integerOption(value: number, name: string, min = 1, max = 1000): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new SessionValidationError(`${name} 必须为 ${min} 到 ${max} 的整数`);
  }

  return value;
}
