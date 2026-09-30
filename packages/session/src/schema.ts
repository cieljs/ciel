import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type { SessionSource } from './types.ts';

/**
 * Session 本身。
 *
 * nextMessageSeq 只给 session_messages 使用。
 * Compaction 不参与 Message seq。
 */
export const sessions = pgSchema('session').table(
  'sessions',
  {
    id: text('id').primaryKey(),

    spaceId: text('space_id').notNull(),
    namespace: text('namespace').notNull(),

    title: text('title'),

    nextMessageSeq: bigint('next_message_seq', {
      mode: 'number',
    })
      .notNull()
      .default(1),

    sources: text('sources')
      .array()
      .$type<SessionSource>()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    sourceSearchText: text('source_search_text').notNull().default(''),
    sourceTokenText: text('source_token_text').notNull().default(''),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  table => [
    check('sessions_space_id_check', sql`length(trim(${table.spaceId})) > 0`),
    index('sessions_space_updated_idx').on(table.spaceId, table.updatedAt),
    index('sessions_sources_idx').using('gin', table.sources),
    index('sessions_source_fts_idx').using(
      'gin',
      sql`to_tsvector('simple', ${table.sourceTokenText})`,
    ),
    index('sessions_source_trgm_idx').using('gin', sql`${table.sourceSearchText} gin_trgm_ops`),
  ],
);

/**
 * Agent Message 是 Session 唯一真实时间线。
 */
export const sessionMessages = pgSchema('session')
  .view('session_messages', {
    id: text('id').notNull(),
    sessionId: text('session_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    message: jsonb('message').$type<AgentMessage>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  })
  .existing();

export const sessionMessageLinks = pgSchema('session').table(
  'message_links',
  {
    id: text('id').primaryKey(),

    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, {
        onDelete: 'cascade',
      }),

    seq: bigint('seq', {
      mode: 'number',
    }).notNull(),

    eventId: text('event_id').notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  table => [uniqueIndex('session_messages_session_seq_unique').on(table.sessionId, table.seq)],
);

/**
 * Compaction 是对 Message Log 的 Snapshot。
 *
 * throughSeq = 10
 *
 * 表示 summary 已经包含 message 1 ~ 10。
 */
export const sessionCompactions = pgSchema('session').table(
  'session_compactions',
  {
    id: text('id').primaryKey(),

    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, {
        onDelete: 'cascade',
      }),

    throughSeq: bigint('through_seq', {
      mode: 'number',
    }).notNull(),

    summary: text('summary').notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex('session_compactions_session_through_unique').on(table.sessionId, table.throughSeq),
  ],
);

/**
 * 可检索 Chunk。
 *
 * 当前来源只有 Session Message，
 * 以后 ASR / Percept / Memory 可以继续扩。
 */
export const retrievalChunks = pgSchema('session').table(
  'retrieval_chunks',
  {
    id: text('id').primaryKey(),

    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, {
        onDelete: 'cascade',
      }),

    messageId: text('message_id')
      .notNull()
      .references(() => sessionMessageLinks.id, {
        onDelete: 'cascade',
      }),

    messageSeq: bigint('message_seq', {
      mode: 'number',
    }).notNull(),

    chunkIndex: integer('chunk_index').notNull().default(0),

    /**
     * 原始文本。
     */
    content: text('content').notNull(),

    /**
     * 给 FTS / trigram 使用的文本。
     *
     * 以后你想接中文 tokenizer，
     * 改生成这个字段的 normalizer 即可。
     */
    searchText: text('search_text').notNull(),

    /** 分词后的全文检索文本。 */
    tokenText: text('token_text').notNull().default(''),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  table => [
    uniqueIndex('retrieval_chunks_message_chunk_unique').on(table.messageId, table.chunkIndex),

    index('retrieval_chunks_session_seq_idx').on(table.sessionId, table.messageSeq),

    /**
     * PostgreSQL FTS。
     */
    index('retrieval_chunks_fts_idx').using('gin', sql`to_tsvector('simple', ${table.tokenText})`),

    /**
     * pg_trgm。
     *
     * 用于：
     * - 包名
     * - symbol
     * - typo
     * - 中文 substring
     */
    index('retrieval_chunks_trgm_idx').using('gin', sql`${table.searchText} gin_trgm_ops`),
  ],
);

/**
 * Embedding 独立存。
 *
 * Vector 是派生数据，可以随时重新生成。
 */
