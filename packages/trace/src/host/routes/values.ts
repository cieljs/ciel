import { os, ORPCError } from '@orpc/server';
import * as z from 'zod';

import type { TraceHost } from '../host.ts';

const valueReferenceSchema = z.object({
  id: z.string().min(1).max(200),
  path: z
    .array(
      z
        .string()
        .max(1024)
        .refine(key => !['__proto__', 'constructor', 'prototype'].includes(key)),
    )
    .max(32)
    .optional(),
});

export function createValueRoutes(host: TraceHost) {
  return { get: os.input(valueReferenceSchema).handler(({ input }) => readValue(host, input)) };
}

/** 检查器只能访问快照自有的数据属性，不能借路径触发 getter 或进入原型链。 */
async function readValue(host: TraceHost, reference: z.infer<typeof valueReferenceSchema>) {
  let value = await host.store.get<unknown>(reference.id);

  for (const key of reference.path ?? []) {
    if (!value || typeof value !== 'object') {
      throw new ORPCError('NOT_FOUND');
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);

    if (!descriptor || !('value' in descriptor)) {
      throw new ORPCError('NOT_FOUND');
    }

    value = descriptor.value;
  }

  return value;
}
