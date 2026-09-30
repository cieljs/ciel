<h1 align="center">@cieljs/storage</h1>

<p align="center">One PGlite database for the whole process, with a schema and a migration ledger per feature.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#overview">Overview</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#modules-and-migrations">Modules</a> ·
  <a href="#the-runtime-journal">Journal</a> ·
  <a href="#borrowing-and-lifecycle">Lifecycle</a> ·
  <a href="#checkpointing">Checkpointing</a> ·
  <a href="#api-reference">API</a>
</p>

## Overview

Everything in Ciel lives in one PGlite (in-process PostgreSQL) instance, and `@cieljs/storage` is what owns it. No other part of the project opens a database: Session, Memory, Vector and Trace each register a **module**, and a module keeps its tables in a PostgreSQL schema of its own.

That same instance also carries the runtime journal. `storage.events` is an append-only table of Pi `AgentEvent`s plus host events such as session compaction, and a feature can write its own read model in the same transaction as the event that produced it. What a feature reads therefore cannot drift away from what actually happened.

```text
Storage (one PGlite instance)
├── storage.events        runtime journal, correlation IDs, projections
├── session.*             module: @cieljs/session
├── memory.*              module: @cieljs/memory
├── vector.*              module: @cieljs/vector
└── trace.*               module: @cieljs/trace
```

Four names are worth having straight before the rest of this file. `Storage` is the instance: it opens the database, exposes `db` and `journal`, checkpoints it and closes it. A `StorageModule` is how a feature declares itself — an `id`, which doubles as its schema name, plus its ordered `migrations`. `storage.events` is the fact table. And `RuntimeJournal`, reached as `storage.journal`, is what writes into it: it accepts `RuntimeEvent`s, assigns correlation IDs, deduplicates repeats and wakes up subscribers.

## Install

```bash
pnpm add @cieljs/storage
```

Inside this monorepo the dependency is declared with the `workspace:` protocol, as in `packages/vector/package.json`:

```json
{
  "dependencies": {
    "@cieljs/storage": "workspace:*"
  }
}
```

The package is ESM-only and exposes a single entry point (`"."` → `dist/index.mjs`). PGlite runs inside the process, so there is no server to start, no connection string and no migration CLI to run; the workspace root asks for `node >= 24.11.1`.

## Quick start

```ts
import { Storage } from '@cieljs/storage';
import { SessionManager, sessionStorage } from '@cieljs/session';
import { MemoryManager, memoryStorage } from '@cieljs/memory';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage, memoryStorage],
});
await using sessions = await SessionManager.open({ storage, namespace: 'session' });
await using memory = await MemoryManager.open({ storage });
```

`await using` disposes in reverse declaration order, so the borrowers go first and `Storage` goes last — see [Borrowing and lifecycle](#borrowing-and-lifecycle).

Opening a database creates the `vector` and `pg_trgm` extensions, the `storage` schema with the `storage.events` table, and then one schema per module. Pass `dataDir: 'memory://'` for a throwaway in-memory database, which is what the tests use.

## Modules and migrations

A module is `{ id, migrations }` and nothing more. The `id` doubles as the PostgreSQL schema name, so it has to match `^[a-z][a-z0-9_]*$`, be unique across `modules`, and not be `storage` — that name belongs to the journal. `Storage.open()` throws a `TypeError` for a blank `dataDir`, or for a module id that is invalid, duplicated or reserved.

```ts
import type { StorageModule } from '@cieljs/storage';

export const notesStorage: StorageModule = {
  id: 'notes',
  migrations: [
    {
      id: '0001',
      sql: 'CREATE TABLE notes.items (id text PRIMARY KEY, body text NOT NULL)',
    },
  ],
};
```

Each module is migrated in one transaction. It creates `"<id>"` together with `"<id>".__migrations (id text PRIMARY KEY, sql text NOT NULL)`, then walks `migrations` in declaration order: a migration already recorded with the same `sql` is skipped, a recorded `sql` that differs throws `迁移内容已修改: <module>/<migration>`, and anything else is executed and recorded.

> [!WARNING]
> Applied migrations are immutable. The recorded SQL is compared byte for byte, so editing a migration that has already run makes the next `Storage.open()` fail. Add a new migration instead.

Modules stay out of each other's way. Every module owns a `__migrations` table inside its own schema, the order in which `modules` are declared does not change what a later `open()` finds, and reopening the same `dataDir` is idempotent.

### A baseline, not an import path

`open()` only creates what is missing. A new database starts directly at the current baseline — there is no path that replays or copies the contents of an older database.

### What happens when a migration fails

The whole open sequence runs inside an `AsyncDisposableStack` that is committed with `move()` only once every module has succeeded. If a migration throws, that module's transaction is rolled back (the test asserts the half-created schema is gone) and the PGlite client opened for this attempt is closed.

## The runtime journal

`storage.journal` is a `RuntimeJournal`, and it is the single append-only stream of facts. Hand it a `RuntimeEvent` — a Pi `AgentEvent` or a host event such as `session_compaction` — and it hands back a `RuntimeRecord`.

```ts
import { Storage } from '@cieljs/storage';

await using storage = await Storage.open({ dataDir: '.ciel/storage' });

const record = await storage.journal.record('session-1', {
  type: 'message_end',
  message: { role: 'user', content: 'hello', timestamp: Date.now() },
});

console.log(record.sequence, record.runId, record.messageId);
```

### Correlation IDs

IDs are assigned when the message is generated, not when it is stored:

| Event             | Effect                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `agent_start`     | Opens a new `runId`; clears `turnId`, `messageId` and the tool-call map                                     |
| `turn_start`      | Opens a new `turnId`                                                                                        |
| `message_start`   | Opens a new `messageId` — any first `message_*` event does the same                                         |
| assistant message | Maps every `toolCall` block id to the current `messageId`, so later tool events resolve to the same message |
| `message_end`     | Clears `messageId`                                                                                          |
| tool events       | Carry the `messageId` behind their `toolCallId`, when one was seen                                          |

The event is snapshotted with `structuredClone()` before it is queued, because streaming events are mutated in place while the model is still generating.

### Projections share the transaction

`record()` takes an optional fourth argument: a projection callback that runs **inside the same transaction** as the insert into `storage.events`.

```ts
import { sql } from '@cieljs/storage';

await storage.journal.record('session-1', event, {}, async (transaction, record) => {
  await transaction.execute(
    sql`INSERT INTO session.message_links (id, event_id) VALUES (${id}, ${record.id})`,
  );
});
```

Both writes land or neither does, so a read model can never disagree with the event log. If the projection throws, the event insert is rolled back with it, and `journal.flush()` rethrows the failure of the first failed write.

Reading message bodies back works this way: a feature projects what it needs in the same transaction and reads it through its own view. `session.session_messages` is one such view — it joins the session's link table to `storage.events` and pulls out `record->'event'->'message'`.

### The same event submitted twice

The journal keeps the promise of the first write for a given event object and session in a `WeakMap`. Submitting the same object again returns the original record instead of appending a second row. A `project` passed along with the repeat still runs, in its own transaction against the already stored record, so a second observer can add its own projection without the event being duplicated.

### Reading and subscribing

```ts
const records = await storage.journal.read(after, 100); // sequence > after, ordered by sequence
const unsubscribe = storage.journal.subscribe(() => {
  // wake up and read from your own persisted cursor
});
```

- `read(after = 0, limit = 100)` orders by `sequence` ascending.
- `subscribe(listener)` is a wake-up signal, not a delivery guarantee, and it returns an unsubscribe function. Consumers are expected to read from their own persisted cursor so nothing is lost while they are disconnected — that is the `RuntimeReader` contract in [@cieljs/agent-kit](../agent-kit/README.md).
- `flush()` drains the write queue and rethrows the first failure.
- `close()` marks the journal closed, flushes and clears listeners. Anything recorded afterwards rejects with `RuntimeJournal 已关闭`.

## Borrowing and lifecycle

One `Storage` per process tree, borrowed by everything that needs it.

Every borrower closes first: managers and `TraceHost` hold a reference to the storage and must be closed before it, and closing a manager never closes the database. The host closes `Storage` last.

A borrower checks that it is still welcome with `storage.require(module)`. That throws `Storage 已关闭` once `close()` has started, and `Storage 未注册模块: <id>` when the module was never passed to `Storage.open()`.

`Storage.close()` is idempotent — repeated calls and `Symbol.asyncDispose` all share one promise. It closes the journal (waiting for queued writes), runs a final `CHECKPOINT` for file-backed databases, and closes the PGlite client. While that is in flight, `journal.record()` rejects, so a late producer fails loudly rather than writing into a closing database.

## Checkpointing

PGlite has no background checkpointer. Kill the process during a dev restart or with Ctrl+C and the next start replays every WAL record written since the last checkpoint. `storage.checkpoint()` runs `CHECKPOINT` on demand, so a host that calls it on a timer bounds the recovery window to one period instead of the whole run.

After `close()`, `checkpoint()` is a no-op: a timer that races with shutdown must neither throw nor bring the connection back. When `dataDir` starts with `memory://`, `Storage.open()` skips the final checkpoint.

## API reference

| Export           | Kind          | Description                                                                                                                            |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Storage`        | class         | `Storage.open({ dataDir, modules })`; fields `db` and `journal`; methods `require()`, `checkpoint()`, `close()`, `Symbol.asyncDispose` |
| `StorageModule`  | type          | `{ id: string; migrations: readonly { id: string; sql: string }[] }`                                                                   |
| `StorageOptions` | type          | `{ dataDir: string; modules?: readonly StorageModule[] }`                                                                              |
| `Database`       | type          | The Drizzle database type built from the PGlite client                                                                                 |
| `Transaction`    | type          | The transaction handle passed to `db.transaction()` callbacks and to journal projections                                               |
| `RuntimeJournal` | class         | Constructor takes a `Database`; exposes `record()`, `read()`, `subscribe()`, `flush()`, `close()`                                      |
| `runtimeRecords` | Drizzle table | `storage.events`, for queries written with Drizzle instead of raw SQL                                                                  |
| `sql`            | re-export     | The `sql` helper from `drizzle-orm`, re-exported so dependants need not import it themselves                                           |

`RuntimeJournal` implements `RuntimeReader` and `RuntimeWriter` from [@cieljs/agent-kit](../agent-kit/README.md) `/protocol`, with the projection callback as an addition of its own.

## Behavior and design notes

- **One database, one schema per feature.** Isolation comes from the schema plus an independent `__migrations` ledger, so a feature can be added, removed or reordered without touching the others.
- **Writes are serialized.** `record()` chains onto a single pending promise, so events reach the table in submission order. Each takes its `sequence` from `nextval(pg_get_serial_sequence('storage.events', 'sequence'))` inside its own transaction, which keeps the value unique; `storage.events` carries a `(session_id, sequence)` index for per-session reads.
- **Snapshots, not references.** The journal stores Pi's event snapshots and never regenerates content. Full streaming events are kept, and no retention policy or compaction is enabled yet.
- **A failing projection fails the write.** The event row and the projection share one transaction, which is what lets a replay-based consumer trust a single cursor.
- **`storage` stays reserved.** The journal's schema cannot be claimed as a module id, so no feature can accidentally migrate over the fact log.

## Development

```bash
vp install      # after pulling changes
vp check        # format, lint and type check
vp test --run   # unit tests
vp run build    # build the package
```

The tests in `src/storage.test.ts` run against real temporary directories and cover migration isolation and idempotent re-open, rollback and cleanup of a failed migration, on-demand checkpoints, atomic event and projection commits, sequence persistence, duplicate submissions and shutdown ordering.

`packages/storage/package.json` has no `scripts`. The `build` (`vp pack`) and `test` tasks come from the `run.tasks` block in `vite.config.ts`, which is why they are invoked through `vp run`.
