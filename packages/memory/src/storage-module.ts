import type { StorageModule } from '@cieljs/storage';
export const memoryStorage: StorageModule = {
  id: 'memory',
  migrations: [
    {
      id: '0001',
      sql: `
CREATE TABLE "memory"."memories" (
  "id" text PRIMARY KEY,
  "layer" text NOT NULL,
  "space_id" text,
  "date" date,
  "status" text DEFAULT 'active' NOT NULL,
  "current_revision" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "memories_layer_space_check" CHECK (("layer" = 'global.long_term' AND "space_id" IS NULL) OR ("layer" IN ('space.long_term', 'space.daily') AND length(trim("space_id")) > 0)),
  CONSTRAINT "memories_layer_date_check" CHECK (("layer" = 'space.daily' AND "date" IS NOT NULL) OR ("layer" IN ('global.long_term', 'space.long_term') AND "date" IS NULL)),
  CONSTRAINT "memories_revision_check" CHECK ("current_revision" > 0),
  CONSTRAINT "memories_status_check" CHECK ("status" IN ('active', 'archived'))
);

CREATE TABLE "memory"."memory_chunks" (
  "id" text PRIMARY KEY,
  "memory_id" text NOT NULL,
  "revision" integer NOT NULL,
  "position" integer NOT NULL,
  "content" text NOT NULL,
  "search_text" text NOT NULL,
  "token_text" text NOT NULL
);

CREATE TABLE "memory"."memory_revisions" (
  "memory_id" text,
  "revision" integer,
  "kind" text NOT NULL,
  "content" text NOT NULL,
  "sources" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "source_search_text" text DEFAULT '' NOT NULL,
  "source_token_text" text DEFAULT '' NOT NULL,
  "metadata" jsonb DEFAULT '{}' NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "memory_revisions_pkey" PRIMARY KEY("memory_id","revision"),
  CONSTRAINT "memory_revisions_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "memory_revisions_kind_check" CHECK ("kind" IN ('event', 'fact', 'preference', 'summary')),
  CONSTRAINT "memory_revisions_content_check" CHECK (length(trim("content")) > 0)
);

CREATE INDEX "memories_space_layer_date_idx" ON "memory"."memories" ("space_id","layer","date");

CREATE UNIQUE INDEX "memory_chunks_revision_position_idx" ON "memory"."memory_chunks" ("memory_id","revision","position");

CREATE INDEX "memory_chunks_fts_idx" ON "memory"."memory_chunks" USING gin (to_tsvector('simple', "token_text"));

CREATE INDEX "memory_chunks_trgm_idx" ON "memory"."memory_chunks" USING gin ("search_text" gin_trgm_ops);

CREATE INDEX "memory_revisions_sources_idx" ON "memory"."memory_revisions" USING gin ("sources");

CREATE INDEX "memory_revisions_source_fts_idx" ON "memory"."memory_revisions" USING gin (to_tsvector('simple', "source_token_text"));

CREATE INDEX "memory_revisions_source_trgm_idx" ON "memory"."memory_revisions" USING gin ("source_search_text" gin_trgm_ops);

ALTER TABLE "memory"."memory_chunks" ADD CONSTRAINT "memory_chunks_memory_id_memories_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memory"."memories"("id") ON DELETE CASCADE;

ALTER TABLE "memory"."memory_revisions" ADD CONSTRAINT "memory_revisions_memory_id_memories_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memory"."memories"("id") ON DELETE CASCADE;
ALTER TABLE "memory"."memory_revisions" DROP COLUMN "metadata";
;
`,
    },
  ],
};
