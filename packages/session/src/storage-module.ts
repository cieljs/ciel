import type { StorageModule } from '@cieljs/storage';
export const sessionStorage: StorageModule = {
  id: 'session',
  migrations: [
    {
      id: '0001',
      sql: `
CREATE TABLE "session"."retrieval_chunks" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL,
  "message_id" text NOT NULL,
  "message_seq" bigint NOT NULL,
  "chunk_index" integer DEFAULT 0 NOT NULL,
  "content" text NOT NULL,
  "search_text" text NOT NULL,
  "token_text" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "session"."session_compactions" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL,
  "through_seq" bigint NOT NULL,
  "summary" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "session"."message_links" (
  "id" text PRIMARY KEY,
  "session_id" text NOT NULL,
  "seq" bigint NOT NULL,
  "event_id" text NOT NULL REFERENCES storage.events(id),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "session"."sessions" (
  "id" text PRIMARY KEY,
  "space_id" text NOT NULL,
 "namespace" text NOT NULL,
  "next_message_seq" bigint DEFAULT 1 NOT NULL,
  "sources" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "source_search_text" text DEFAULT '' NOT NULL,
  "source_token_text" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sessions_space_id_check" CHECK (length(trim("space_id")) > 0)
);

CREATE UNIQUE INDEX "retrieval_chunks_message_chunk_unique" ON "session"."retrieval_chunks" ("message_id","chunk_index");

CREATE INDEX "retrieval_chunks_session_seq_idx" ON "session"."retrieval_chunks" ("session_id","message_seq");

CREATE INDEX "retrieval_chunks_fts_idx" ON "session"."retrieval_chunks" USING gin (to_tsvector('simple', "token_text"));

CREATE INDEX "retrieval_chunks_trgm_idx" ON "session"."retrieval_chunks" USING gin ("search_text" gin_trgm_ops);

CREATE UNIQUE INDEX "session_compactions_session_through_unique" ON "session"."session_compactions" ("session_id","through_seq");

CREATE UNIQUE INDEX "session_messages_session_seq_unique" ON "session"."message_links" ("session_id","seq");

CREATE INDEX "sessions_space_updated_idx" ON "session"."sessions" ("space_id","updated_at");

CREATE INDEX "sessions_sources_idx" ON "session"."sessions" USING gin ("sources");

CREATE INDEX "sessions_source_fts_idx" ON "session"."sessions" USING gin (to_tsvector('simple', "source_token_text"));

CREATE INDEX "sessions_source_trgm_idx" ON "session"."sessions" USING gin ("source_search_text" gin_trgm_ops);

ALTER TABLE "session"."retrieval_chunks" ADD CONSTRAINT "retrieval_chunks_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"."sessions"("id") ON DELETE CASCADE;

ALTER TABLE "session"."retrieval_chunks" ADD CONSTRAINT "retrieval_chunks_message_id_session_messages_id_fkey" FOREIGN KEY ("message_id") REFERENCES "session"."message_links"("id") ON DELETE CASCADE;

ALTER TABLE "session"."session_compactions" ADD CONSTRAINT "session_compactions_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"."sessions"("id") ON DELETE CASCADE;

ALTER TABLE "session"."message_links" ADD CONSTRAINT "session_messages_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"."sessions"("id") ON DELETE CASCADE;
;
CREATE VIEW session.session_messages AS SELECT l.id, l.session_id, l.seq, e.record->'event'->'message' AS message, l.created_at FROM session.message_links l JOIN storage.events e ON e.id = l.event_id;
`,
    },
    {
      id: '0002',
      sql: `ALTER TABLE "session"."sessions" ADD COLUMN "title" text;`,
    },
  ],
};
