import { and, eq, inArray, sql } from 'drizzle-orm';

import { memories, memoryRevisions } from './schema.ts';
import type {
  MemoryLayer,
  MemoryListOptions,
  MemoryReadOptions,
  MemorySearchOptions,
} from './types.ts';
import { assertDate, assertKind, assertLayers } from './validation.ts';

export interface MemorySelector {
  layers: MemoryLayer[];
  spaceId?: string;
}

export interface MemoryQueryFilter extends MemoryReadOptions {
  kind?: MemoryListOptions['kind'];
  dateFrom?: string;
  dateTo?: string;
}

export function selectorCondition(selector: MemorySelector) {
  assertLayers(selector.layers);

  const layerCondition = selector.layers.length
    ? inArray(memories.layer, selector.layers)
    : sql`false`;

  const spaceCondition =
    selector.spaceId === undefined ? undefined : eq(memories.spaceId, selector.spaceId);

  return and(layerCondition, spaceCondition)!;
}

export function filterCondition(selector: MemorySelector, options: MemoryQueryFilter) {
  if (options.kind !== undefined) {
    assertKind(options.kind);
  }

  if (options.dateFrom !== undefined) {
    assertDate(options.dateFrom);
  }

  if (options.dateTo !== undefined) {
    assertDate(options.dateTo);
  }

  if (options.dateFrom && options.dateTo && options.dateFrom > options.dateTo) {
    throw new TypeError('日期范围起点不能晚于终点');
  }

  return and(
    selectorCondition(selector),
    options.includeArchived ? undefined : eq(memories.status, 'active'),
    options.includeExpired
      ? undefined
      : sql`(${memoryRevisions.expiresAt} IS NULL OR ${memoryRevisions.expiresAt} > now())`,
    options.kind ? eq(memoryRevisions.kind, options.kind) : undefined,
    options.dateFrom ? sql`${memories.date} >= ${options.dateFrom}::date` : undefined,
    options.dateTo ? sql`${memories.date} <= ${options.dateTo}::date` : undefined,
  )!;
}

export function searchFilter(
  selector: MemorySelector,
  options: MemorySearchOptions & { dateFrom?: string; dateTo?: string },
) {
  return filterCondition(selector, options);
}
