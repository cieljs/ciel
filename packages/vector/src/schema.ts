import type { StorageModule } from '@cieljs/storage';
import { customType, integer, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: value => JSON.stringify(value),
  fromDriver: value => JSON.parse(value) as number[],
});

const schema = pgSchema('vector');
export const vectorCache = schema.table('cache', {
  key: text('key').primaryKey(),
  profile: text('profile').notNull(),
  purpose: text('purpose').notNull(),
  content: text('content').notNull(),
  embedding: vector('embedding').notNull(),
});
export const vectorEntries = schema.table(
  'entries',
  {
    namespace: text('namespace').notNull(),
    chunkId: text('chunk_id').notNull(),
    model: text('model').notNull(),
    dimensions: integer('dimensions').notNull(),
    cacheKey: text('cache_key').references(() => vectorCache.key),
    status: text('status').$type<'pending' | 'ready' | 'failed'>().notNull().default('pending'),
    error: text('error'),
  },
  table => [primaryKey({ columns: [table.namespace, table.chunkId, table.model] })],
);

export const vectorStorage: StorageModule = {
  id: 'vector',
  migrations: [
    {
      id: '0001',
      sql: `
    CREATE TABLE vector.cache (
      key text PRIMARY KEY,
      profile text NOT NULL,
      purpose text NOT NULL,
      content text NOT NULL,
      embedding public.vector NOT NULL
    );
    CREATE TABLE vector.entries (
      namespace text NOT NULL,
      chunk_id text NOT NULL,
      model text NOT NULL,
      dimensions integer NOT NULL,
      cache_key text REFERENCES vector.cache(key),
      status text NOT NULL DEFAULT 'pending',
      error text,
      PRIMARY KEY(namespace, chunk_id, model),
      CHECK ((status = 'ready' AND cache_key IS NOT NULL) OR (status IN ('pending', 'failed') AND cache_key IS NULL))
    );
    CREATE INDEX entries_jobs ON vector.entries(namespace, model, status);
  `,
    },
  ],
};
