import type { RuntimeRecord } from '@cieljs/agent-kit/protocol';
import { bigint, jsonb, pgSchema, text } from 'drizzle-orm/pg-core';

export const runtimeRecords = pgSchema('storage').table('events', {
  id: text('id').primaryKey(),
  sequence: bigint('sequence', { mode: 'number' }).notNull().unique(),
  sessionId: text('session_id').notNull(),
  messageId: text('message_id'),
  record: jsonb('record').$type<RuntimeRecord>().notNull(),
});
