import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type { MemoryKind, MemoryLayer, MemoryStatus } from './types.ts';

export const memories = pgSchema('memory').table(
  'memories',
  {
    id: text('id').primaryKey(),
    layer: text('layer').$type<MemoryLayer>().notNull(),
    spaceId: text('space_id'),
    date: date('date'),
    status: text('status').$type<MemoryStatus>().notNull().default('active'),
    currentRevision: integer('current_revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  table => [
    check(
      'memories_layer_space_check',
      sql`(${table.layer} = 'global.long_term' AND ${table.spaceId} IS NULL) OR (${table.layer} IN ('space.long_term', 'space.daily') AND length(trim(${table.spaceId})) > 0)`,
    ),
    check(
      'memories_layer_date_check',
      sql`(${table.layer} = 'space.daily' AND ${table.date} IS NOT NULL) OR (${table.layer} IN ('global.long_term', 'space.long_term') AND ${table.date} IS NULL)`,
    ),
    check('memories_revision_check', sql`${table.currentRevision} > 0`),
    check('memories_status_check', sql`${table.status} IN ('active', 'archived')`),
    index('memories_space_layer_date_idx').on(table.spaceId, table.layer, table.date),
  ],
);

export const memoryRevisions = pgSchema('memory').table(
  'memory_revisions',
  {
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    kind: text('kind').$type<MemoryKind>().notNull(),
    content: text('content').notNull(),
    sources: text('sources')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    sourceSearchText: text('source_search_text').notNull().default(''),
    sourceTokenText: text('source_token_text').notNull().default(''),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.memoryId, table.revision] }),
    check('memory_revisions_revision_check', sql`${table.revision} > 0`),
    check(
      'memory_revisions_kind_check',
      sql`${table.kind} IN ('event', 'fact', 'preference', 'summary')`,
    ),
    check('memory_revisions_content_check', sql`length(trim(${table.content})) > 0`),
    index('memory_revisions_sources_idx').using('gin', table.sources),
    index('memory_revisions_source_fts_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.sourceTokenText})`,
    ),
    index('memory_revisions_source_trgm_idx').using(
      'gin',
      sql`${table.sourceSearchText} gin_trgm_ops`,
    ),
  ],
);

export const memoryChunks = pgSchema('memory').table(
  'memory_chunks',
  {
    id: text('id').primaryKey(),
    memoryId: text('memory_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    position: integer('position').notNull(),
    content: text('content').notNull(),
    searchText: text('search_text').notNull(),
    tokenText: text('token_text').notNull(),
  },
  table => [
    uniqueIndex('memory_chunks_revision_position_idx').on(
      table.memoryId,
      table.revision,
      table.position,
    ),
    index('memory_chunks_fts_idx').using('gin', sql`to_tsvector('simple', ${table.tokenText})`),
    index('memory_chunks_trgm_idx').using('gin', sql`${table.searchText} gin_trgm_ops`),
  ],
);
