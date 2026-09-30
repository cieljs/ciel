import { integerOption } from '../validation.ts';
import type { SessionToolLimits } from './types.ts';

export function resolveToolOptions(options: SessionToolLimits) {
  return {
    searchLimit: integerOption(options.searchLimit ?? 8, 'searchLimit', 1, 20),
    maxReadMessages: integerOption(options.maxReadMessages ?? 10, 'maxReadMessages', 0, 20),
  };
}

export function sessionResult(details: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}
