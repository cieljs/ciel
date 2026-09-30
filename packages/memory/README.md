<h1 align="center">@cieljs/memory</h1>

<p align="center">Layered long-term memory with revision history and source-aware search.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#overview">Overview</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#updating-and-forgetting">Updating and forgetting</a> ·
  <a href="#searching">Searching</a> ·
  <a href="#agent-tools">Agent tools</a> ·
  <a href="#api-reference">API reference</a> ·
  <a href="#behavior-notes-and-design-decisions">Design decisions</a> ·
  <a href="#development">Development</a>
</p>

## Overview

`@cieljs/memory` stores long-term agent memory on top of [`@cieljs/storage`](../storage/README.md) (PGlite + Drizzle + pgvector). It keeps three layers, saves a full snapshot for every update, and exposes content search and source search as two independent entry points.

Scope is bound to objects rather than passed in. `manager.global` is the global long-term layer and `manager.space(id)` returns a space-bound object, and space APIs never merge in global memories or memories from another space. Every update is a revision: `update()` inserts the next full snapshot and moves the logical memory's current revision forward, which keeps old content, old sources and every earlier revision readable. Sources are plain strings — `MemorySource` is `string`, and the package normalizes, exact-matches and full-text searches them without ever interpreting their business meaning. Cross-space access is explicit and read-only: whole-database reads live on `MemoryManager` and in a separate Agent tool set, while the normal write tools stay bound to one space. Indexing is asynchronous, so once a transaction commits the content is already visible to `get()`, `list()`, full-text and source search while embeddings catch up in the background.

| Entry                         | Target                   | Contents                              |
| ----------------------------- | ------------------------ | ------------------------------------- |
| `@cieljs/memory`              | `./dist/index.mjs`       | Storage, retrieval and lifecycle APIs |
| `@cieljs/memory/agent`        | `./dist/agent/index.mjs` | Agent tools and context preparation   |
| `@cieljs/memory/package.json` | `./package.json`         | Package metadata                      |

Schema, database connections, retrieval internals, index tasks and internal validators are not published as subpaths.

> [!NOTE]
> The first version has no automatic memory consolidation. The caller or the Agent must explicitly decide whether a new memory belongs to `space.daily`, `space.long_term` or `global.long_term`.

## Concepts

### The three layers

| Layer              | `spaceId` | `date` | Purpose                                               |
| ------------------ | --------- | ------ | ----------------------------------------------------- |
| `global.long_term` | `null`    | `null` | Stable facts and preferences that hold across spaces  |
| `space.long_term`  | non-empty | `null` | Facts that hold only inside one space                 |
| `space.daily`      | non-empty | set    | Events and short-lived state for one space on one day |

Those combinations are the only legal ones; they are enforced by database `CHECK` constraints. `spaceId` is an opaque, business-defined string: the package only requires it to be non-empty and does not parse it.

```ts
type MemoryLayer = 'global.long_term' | 'space.long_term' | 'space.daily';
type SpaceMemoryLayer = 'space.long_term' | 'space.daily';
type MemoryKind = 'event' | 'fact' | 'preference' | 'summary';
type MemoryStatus = 'active' | 'archived';
type MemorySource = string;
```

A `MemoryEntry` is the current revision of one logical memory:

```ts
interface MemoryEntryFields {
  id: string;
  revision: number;

  kind: MemoryKind;
  content: string;
  sources: MemorySource[];

  status: MemoryStatus;

  occurredAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

`MemoryEntry` is discriminated by `layer`, so `spaceId` is `null` only for the global layer and `date` is non-null only for `space.daily`. `MemoryEntryFor<Layer>` narrows the entry to one layer, and `SpaceMemoryEntry` is the union of the two space layers.

When `kind` is omitted, `space.daily` defaults to `'event'` and both long-term layers default to `'fact'`.

### Sources

Sources only participate in traceability and retrieval:

```ts
await space.daily.remember({
  content: '今天讨论了新的游戏模式',
  sources: ['bilibili:room:21452505', '主播昵称', '主播旧昵称', '今晚第一次挑战新模式'],
});
```

Businesses are expected to namespace stable identifiers themselves, for example `session:conversation-1`, `message:message-42`, `bilibili:room:21452505` or `event:agreement-42`. The package does not interpret prefixes; it treats the whole string as an exact-matchable, full-text-searchable source. Human-readable names, titles and aliases are equally valid sources.

On every write, the package:

1. normalizes each source with Unicode `NFKC`;
2. trims surrounding whitespace;
3. drops empty strings;
4. deduplicates by normalized value while keeping the first occurrence's order and display text;
5. validates per-item length, array size and total size.

| Limit                      | Value  |
| -------------------------- | ------ |
| Sources per memory         | 32     |
| Characters per source      | 512    |
| Total bytes of all sources | 32 KiB |

### Revisions

A logical memory has a stable `id` and a monotonically increasing `revision`. `remember()` always creates a new logical memory with revision `1`; it never merges with existing content or sources. `update()` never overwrites the previous body — it appends a new full snapshot and repoints the memory:

```text
memory-1 / revision 1 / old content
memory-1 / revision 2 / new content
```

The update transaction runs in a fixed order: lock the logical memory, validate scope/status/`currentRevision`, read the current full revision, merge the patch, insert the next revision, update `currentRevision` and `updatedAt`, rebuild the retrieval index for the new revision, commit.

`id`, `layer`, `spaceId`, `date`, `occurredAt` and `createdAt` are identity fields and can never be changed by `update()`. If one of them must change, create a new memory and forget the old one.

### Spaces

`manager.space(spaceId)` returns a bound object; an empty (or whitespace-only) `spaceId` throws `MemoryValidationError`. Space-level `get()`, `list()`, `search()`, `update()`, `forget()`, `history()` and `getRevision()` are strictly limited to that space and never fall back to global or whole-database reads.

Memory does not maintain a separate space registry. A space that owns no memory simply does not exist for discovery, and every `manager.space(id)` call returns a fresh bound object rather than a cached one.

### Daily dates

`space.daily` accepts an explicit `YYYY-MM-DD` `date`. When it is omitted, the package uses `occurredAt`, or the current time when that is omitted too, and formats it in the manager's `timeZone` (`Asia/Shanghai` by default). Long-term layers reject a `date` with `MemoryValidationError`.

## Install

```bash
pnpm add @cieljs/memory @cieljs/storage
```

Vector search additionally needs a vector service:

```bash
pnpm add @cieljs/vector
```

`MemoryManager.open()` calls `storage.require(memoryStorage)`, so `memoryStorage` must be registered through `Storage.open({ modules: [...] })`. `EmbeddingProvider` and `EmbeddingOptions` are re-exported from `@cieljs/model-kit`, so you do not need to import that package for the types.

> [!NOTE]
> The workspace requires Node `>= 24.11.1`. Timestamps are stored as `timestamp with time zone` and dates as PostgreSQL `date`; the package reads and writes them through PGlite.

## Quick start

```ts
import { Storage } from '@cieljs/storage';
import { MemoryManager, memoryStorage } from '@cieljs/memory';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [memoryStorage],
});
await using memories = await MemoryManager.open({
  storage,
  timeZone: 'Asia/Shanghai',
});

const space = memories.space('blive:room:21452505');

// Global long-term: stable facts and preferences across spaces.
await memories.global.remember({
  content: '用户偏好简洁且自然的表达',
  sources: ['session:conversation-1'],
});

// Space long-term: knowledge that only holds inside this space.
await space.longTerm.remember({
  content: '这个直播间经常讨论独立游戏',
  sources: ['bilibili:room:21452505', '主播昵称'],
});

// Space daily: events and short-lived state.
await space.daily.remember({
  content: '今天主播开始体验新的独立游戏',
  sources: ['bilibili:room:21452505', '今晚第一次挑战新模式'],
});
```

`MemoryManagerOptions`:

| Option         | Default              | Notes                                                                        |
| -------------- | -------------------- | ---------------------------------------------------------------------------- |
| `storage`      | —                    | Required. Must have registered `memoryStorage`.                              |
| `timeZone`     | `'Asia/Shanghai'`    | IANA time zone used for daily dates. Invalid values throw.                   |
| `vectors`      | —                    | A `VectorService` enables vector indexing and `mode: 'vector'`.              |
| `tokenize`     | `tokenizeSearchText` | Shared tokenizer for indexed text and queries.                               |
| `onIndexError` | —                    | Receives index errors; without it failures are reported with `console.warn`. |

Note the asymmetry between the layers: the global object _is_ the long-term layer (`memories.global.remember(...)`, not `memories.global.longTerm`), while a space exposes `longTerm` and `daily` explicitly, so the target layer is always fixed by the object you call.

Reads start from the same bound objects:

```ts
const memory = await space.get(memoryId);

const recent = await space.list({
  layers: ['space.daily'],
  dateFrom: '2024-05-01',
  dateTo: '2024-05-31',
  limit: 50,
});
```

`list()` orders by `occurredAt DESC, id ASC`, defaults to `limit: 50, offset: 0`, and supports `kind`, `dateFrom`, `dateTo`, `layers`, `includeArchived` and `includeExpired`.

## Updating and forgetting

Updates submit only the changed fields plus the revision the caller based its decision on. The database creates the next full snapshot, so old content stays readable through the history APIs.

```ts
const current = await space.get(memoryId);

if (current) {
  await space.update(current.id, {
    expectedRevision: current.revision,
    content: '修正后的完整内容',
  });

  const history = await space.history(current.id, { limit: 20 });
  const firstRevision = await space.getRevision(current.id, 1);
}
```

- `content` is the complete replacement body, not a diff. Fields that are not submitted keep the current revision's value.
- `sources`, when submitted, replace the entire array — there is no implicit merge.
- At least one of `content`, `kind`, `expiresAt` or `sources` must be present, otherwise `MemoryValidationError` is thrown.
- `expiresAt: null` clears the expiry.
- `expectedRevision` must be the revision you actually read. If it is stale, the update fails with `MemoryConflictError`; re-read the memory and decide again. The package never merges two conflicting bodies automatically.
- `history(id, { limit = 20, beforeRevision })` returns revisions newest first. `getRevision(id, revision)` returns one exact snapshot or `null`. Both work for archived memories too.

Forgetting is a soft archive:

```ts
await space.forget(current.id, { expectedRevision: current.revision });
```

`forget()` flips `status` to `'archived'` and records `archivedAt`. The memory disappears from default reads and from default content/source search, but all revisions, sources, chunks and vectors are kept. Hosts that really want archived records can opt in per read with `includeArchived: true`; the Agent tools never do. There is no `purge()` and no restore API in the first version.

> [!WARNING]
> `update()` and `forget()` both require `expectedRevision` and both reject archived memories with `MemoryArchivedError`. Passing a guessed revision is not a shortcut — it either conflicts or silently targets the wrong state.

## Searching

Content search and source search are separate entry points: `search()` matches the body `content`, `searchBySource()` matches the `sources` array. Both only ever look at the current revision unless source search is explicitly asked for history, and both exclude archived and expired records by default.

### Content search

```ts
const hits = await space.search('独立游戏', {
  mode: 'hybrid',
  limit: 8,
});
```

| `mode`             | Behavior                                                                   | Use for                                        |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `hybrid` (default) | Runs `full_text`, `trigram` and `vector`, then merges the routes           | General recall                                 |
| `full_text`        | PostgreSQL full-text search over tokenized chunks                          | Explicit keywords                              |
| `trigram`          | pg_trgm similarity plus `LIKE` containment                                 | Short text, partial matches, small differences |
| `vector`           | Cosine similarity against ready embeddings, gated by `minVectorSimilarity` | Semantic matches (needs `vectors`)             |

| Option                | Default    | Notes                                                                   |
| --------------------- | ---------- | ----------------------------------------------------------------------- |
| `mode`                | `'hybrid'` | One of the four modes above.                                            |
| `kind`                | —          | Filter by `MemoryKind`.                                                 |
| `limit`               | `10`       | 1–1000 hits after merging.                                              |
| `offset`              | `0`        | Applied after merging.                                                  |
| `candidateLimit`      | `50`       | Per-route candidate cap before merging.                                 |
| `minVectorSimilarity` | `0.35`     | Must be within `-1..1`, otherwise a `TypeError` is thrown.              |
| `layers`              | all layers | `space.search()` defaults to its own two layers and only accepts those. |
| `dateFrom` / `dateTo` | —          | `YYYY-MM-DD`, compared against the stored `date`.                       |
| `includeArchived`     | `false`    | Include archived memories.                                              |
| `includeExpired`      | `false`    | Include memories whose `expiresAt` has passed.                          |
| `signal`              | —          | `AbortSignal`, checked before each route.                               |

Hybrid scoring is rank-based, not probabilistic: the n-th hit of a route contributes `1 / (60 + n)`, and `trigram` contributes `0.7 / (60 + n)`; scores of routes that hit the same memory are summed and the matching routes are reported in `matches`. `score` is only meant for ordering, and ties break by `occurredAt DESC, id ASC`.

History is deliberately excluded from semantic search: old revisions are never returned by `search()`, so a model cannot recall two conflicting versions of the same fact at once.

### Vector search setup

```ts
import { Storage } from '@cieljs/storage';
import { MemoryManager, memoryStorage } from '@cieljs/memory';
import { VectorService, vectorStorage } from '@cieljs/vector';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [memoryStorage, vectorStorage],
});
await using vectors = new VectorService({
  storage,
  provider: { model: 'text-embedding-model', dimensions: 1024, embedBatch },
  providerId: 'provider',
  revision: '1',
  granularity: 'chunk',
  inputConfig: 'raw',
});
await using manager = await MemoryManager.open({ storage, vectors });
```

Writes are visible to normal reads, full-text search and source search as soon as the transaction commits; embeddings are asynchronous. Without a `VectorService`, `mode: 'vector'` returns an empty result set while `hybrid` still uses full-text and trigram, and a failing vector route inside `hybrid` is reported through `onIndexError` instead of failing the whole search.

### Source search

```ts
const exact = await manager.searchBySource('bilibili:room:21452505', { mode: 'exact' });
const text = await manager.searchBySource('主播昵称', { mode: 'text' });
```

| `mode`           | Behavior                                                                    |
| ---------------- | --------------------------------------------------------------------------- |
| `auto` (default) | Exact match first, then text search; the higher score per memory wins       |
| `exact`          | Full source element match, for stable business identifiers                  |
| `text`           | Full-text and trigram search over the joined sources, for names and aliases |

Options: `includeHistory` (default `false`; when enabled, results carry accurate `revision` values and you read the body with `getRevision()`), `layers`, `limit` (default `10`), `offset` (default `0`), `includeArchived`, `includeExpired` and `signal`. Each hit carries `memoryId`, `revision`, `spaceId`, `layer`, `date`, `matchedSources`, an `excerpt` of up to 400 characters and a `score`.

The result gives you `spaceId + memoryId + revision`, so you can read the exact memory without first aggregating spaces:

```ts
const hits = await manager.searchBySource('主播昵称', { mode: 'text' });
const hit = hits[0];

if (hit?.spaceId) {
  const memory = await manager.space(hit.spaceId).get(hit.memoryId);
}
```

### Discovering related spaces

`findSpacesBySource()` reuses source search and aggregates by `spaceId`:

```ts
const relatedSpaces = await memories.findSpacesBySource('主播昵称');

for (const related of relatedSpaces) {
  const hits = await memories.space(related.spaceId).search('之前对这个游戏有什么看法');
}
```

| Option   | Default           | Notes                                    |
| -------- | ----------------- | ---------------------------------------- |
| `mode`   | `'auto'`          | Same modes as source search.             |
| `layers` | both space layers | `space.long_term` and `space.daily`.     |
| `limit`  | `10`              | Number of spaces returned, not memories. |
| `signal` | —                 | `AbortSignal`.                           |

Discovery scans up to 1000 source hits, keeps one entry per space with the highest score, deduplicates the matched sources, attaches the memory references (`id`, `revision`, `layer`, `excerpt`) harvested from those hits and sorts by score descending, then `spaceId`. Global-layer hits are skipped and spaces without memories never appear. Discovery always excludes archived and expired memories.

### Whole-database reads

`MemoryManager` additionally exposes admin-side reads that are never reached implicitly from a space object:

| Method                                | Scope                                   |
| ------------------------------------- | --------------------------------------- |
| `getAny(id, options?)`                | Any layer, any space.                   |
| `searchAll(query, options?)`          | All three layers; narrow with `layers`. |
| `searchBySource(query, options?)`     | All three layers by default.            |
| `findSpacesBySource(query, options?)` | Space discovery across the whole store. |

## Agent tools

Agent-facing APIs live behind a second entry point:

```ts
import { globalMemoryTools, loadMemoryContext, memoryTools } from '@cieljs/memory/agent';
```

### Current-space tools

```ts
const tools = memoryTools({
  space,
  sources: ['session:conversation-1', 'bilibili:room:21452505'],
});
```

`memoryTools()` binds a `SpaceMemory` supplied by the host, so tool parameters never contain a `spaceId`. Daily and long-term creation stay separate tools, so the Agent never has to pass a database layer string.

| Tool                                      | Behavior                                                           |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `search_current_space_memory`             | Content search inside the bound space's daily and long-term layers |
| `search_current_space_memory_by_source`   | Matches `sources` of the bound space only                          |
| `read_current_space_memory`               | Paginated read of one memory by id                                 |
| `remember_current_space_daily_memory`     | Creates a `space.daily` memory in the bound space                  |
| `remember_current_space_long_term_memory` | Creates a `space.long_term` memory in the bound space              |
| `update_current_space_memory`             | Revision-checked update (`expectedRevision` required)              |
| `archive_current_space_memory`            | Soft archive; returns `{ id, archived: true }` and keeps history   |

The last four are created unless they are explicitly disabled. Tool names describe their own scope: `current_space` means the bound space, `discovered_space` means a space that was discovered read-only, `global` means the global long-term layer only, `all` includes the global layer plus every space, and `by_source` matches sources where plain `search` matches content.

### Options

| Option             | Default    | Notes                                                                  |
| ------------------ | ---------- | ---------------------------------------------------------------------- |
| `space`            | —          | Required. The bound `SpaceMemory`.                                     |
| `sources`          | —          | Static `string[]` or a `MemorySourceProvider`.                         |
| `sourcesMode`      | `'append'` | `'replace'` swaps the whole array on update.                           |
| `rememberDaily`    | enabled    | Set `false` to omit the daily write tool.                              |
| `rememberLongTerm` | enabled    | Set `false` to omit the space long-term write tool.                    |
| `update`           | enabled    | Set `false` to omit the update tool.                                   |
| `forget`           | enabled    | Set `false` to omit the archive tool.                                  |
| `searchLimit`      | `8`        | 1–20, the default `limit` for search tools.                            |
| `maxReadChars`     | `12000`    | 1–100000; the page size of reads and the truncation limit of previews. |
| `crossSpace`       | —          | `{ manager, access }`, opt-in cross-space search.                      |

### Write tool parameters

```ts
// remember_current_space_daily_memory
{ content: string; kind?: MemoryKind; date?: string; occurredAt?: string; expiresAt?: string }

// remember_current_space_long_term_memory
{ content: string; kind?: MemoryKind; occurredAt?: string; expiresAt?: string }

// update_current_space_memory
{ id: string; expectedRevision: number; content?: string; kind?: MemoryKind; expiresAt?: string | null }

// archive_current_space_memory
{ id: string; expectedRevision: number }
```

`content` is limited to 16000 characters, `date` must match `YYYY-MM-DD`, and `expiresAt: null` clears the expiry. The Agent cannot submit `sources`; the host injects them, either as a static array or per call:

```ts
const tools = memoryTools({
  space,
  sources: ({ toolCallId, action }) => [
    `session:${sessionId}`,
    `tool-call:${toolCallId}`,
    `action:${action}`,
  ],
});
```

The provider receives `{ toolCallId, action: 'remember' | 'update', signal }`. With `sourcesMode: 'append'` (the default) the injected sources are appended to the current ones, and an empty injected array changes nothing. With `sourcesMode: 'replace'` the returned array replaces the old sources completely, so an empty array clears them.

Read tools page the body: start at `offset: 0` and keep passing the returned `nextOffset` until it is `null`. Content search results expose `memory.id`, source search results expose `memoryId`; both are valid `id` arguments for the read tools. Before updating, read the full body with the matching read tool and use its newest `revision` as `expectedRevision` — a search excerpt must never overwrite the body.

### Cross-space read access

Cross-space access is opt-in and read-only. Without `crossSpace`, every tool — search, read and write — is limited to the bound space; there is no whole-database fallback.

| Configuration       | Cross-space capability                               | Includes the global layer                     |
| ------------------- | ---------------------------------------------------- | --------------------------------------------- |
| no `crossSpace`     | None; current space only                             | No                                            |
| `access: 'related'` | Discover spaces by source, then search and read them | No                                            |
| `access: 'all'`     | Adds direct search and read of everything            | Yes, via `search_all_*` and `read_any_memory` |

```ts
import { memoryTools } from '@cieljs/memory/agent';

const localTools = memoryTools({ space });

const relatedTools = memoryTools({
  space,
  crossSpace: { manager, access: 'related' },
});

const allTools = memoryTools({
  space,
  crossSpace: { manager, access: 'all' },
});
```

The seven current-space tools keep their original scope. Cross-space configuration adds these tools on top:

| Tool                                       | Available with   | Behavior                                                                                                      |
| ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `find_memory_spaces_by_source`             | `related`, `all` | Discovers spaces by memory `sources`; does not search content or the global layer, does not list empty spaces |
| `search_discovered_space_memory`           | `related`, `all` | Content search inside one discovered `spaceId`                                                                |
| `search_discovered_space_memory_by_source` | `related`, `all` | Matches the `sources` of one discovered `spaceId`                                                             |
| `read_discovered_space_memory`             | `related`, `all` | Paginated read inside one discovered `spaceId`                                                                |
| `search_all_memory`                        | `all` only       | Searches the global long-term layer plus every space, no discovery needed                                     |
| `search_all_memory_by_source`              | `all` only       | Matches `sources` across the global layer and every space, no discovery needed                                |
| `read_any_memory`                          | `all` only       | Reads any memory by id across the global layer and every space, no discovery needed                           |

With `related`, the intended order is `find_memory_spaces_by_source` → `search_discovered_space_memory` (or its `by_source` variant) → `read_discovered_space_memory`. Each discovery result carries `spaceId`, matched sources and memory references. The bound space is always callable; every other space must be discovered first, and the discovery record only lasts for the lifetime of that tool set — recreating the tools requires discovering again.

With `all`, you can call `search_all_memory` or `search_all_memory_by_source` directly and then `read_any_memory` with the returned id. `all` only covers the memory store of the manager you passed, not other databases. Returned `spaceId`, `layer` and sources exist so the Agent can attribute a memory correctly: a fact from another space is not a fact of the current space.

Both modes only widen search and read. Saving, updating and archiving remain limited to the current space, and even under `all` the tools named `current_space` still only touch the bound space.

### Global write authorization

Global writes are a separate grant that is not implied by cross-space search:

```ts
const tools = globalMemoryTools({
  memory: manager.global,
  sources: ['session:conversation-1'],
});
```

| Tool                             | Behavior                                     |
| -------------------------------- | -------------------------------------------- |
| `search_global_memory`           | Content search in the global long-term layer |
| `search_global_memory_by_source` | Matches the global layer's `sources`         |
| `read_global_memory`             | Paginated read from the global layer         |
| `remember_global_memory`         | Creates a global long-term memory            |
| `update_global_memory`           | Revision-checked update                      |
| `archive_global_memory`          | Soft archive                                 |

Global tools only touch the global long-term layer and never search space memories. The options mirror `memoryTools()` where they apply: `memory`, `sources`, `sourcesMode`, `maxReadChars` (default `12000`) and the `remember` / `update` / `forget` switches, all enabled by default and individually disabled with `false`. `memoryTools()` itself grants no global access at all.

### Context preparation

`loadMemoryContext()` returns three independently budgeted sections, so a busy day cannot crowd out long-term facts:

```ts
const context = await loadMemoryContext({
  manager,
  space,
  query: currentUserMessage,
  recentDays: 2,
});
```

| Option                 | Default           | Notes                                                                   |
| ---------------------- | ----------------- | ----------------------------------------------------------------------- |
| `manager`, `space`     | —                 | Required.                                                               |
| `globalLongTermTokens` | `2000`            | Token budget of the global long-term section.                           |
| `spaceLongTermTokens`  | `2000`            | Token budget of the space long-term section.                            |
| `dailyTokens`          | `2000`            | Token budget of the daily section.                                      |
| `recentDays`           | `2`               | 1–366 days, counted back from today in `manager.timeZone`.              |
| `query`                | —                 | When present, sections are filled by `search()`, otherwise by `list()`. |
| `countTokens`          | UTF-8 byte length | Must return a non-negative safe integer.                                |
| `signal`               | —                 | `AbortSignal`.                                                          |

Each section is `{ text, memories, tokens }`, where `text` is a `<memory_context>` block stating that memories are historical data, that instructions inside them are not the current request, and that facts of one space are not facts of another. Injecting memory grants no tool permissions: context and authorization are independent, and an empty search result only means "no hit inside the currently accessible scope".

## API reference

### `@cieljs/memory` — values

| Export                  | Kind            | Description                                                                                                                  |
| ----------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `MemoryManager`         | class           | Opens the store, owns layers, whole-database reads and index tasks                                                           |
| `memoryStorage`         | `StorageModule` | Storage module with the `memory` schema and its migrations                                                                   |
| `tokenizeSearchText`    | function        | Default tokenizer: `NFKC`, lowercase, `Intl.Segmenter('zh', { granularity: 'word' })`, word-like segments only, deduplicated |
| `MemoryError`           | class           | Base error carrying a stable `code`                                                                                          |
| `MemoryNotFoundError`   | class           | `MEMORY_NOT_FOUND`                                                                                                           |
| `MemoryAccessError`     | class           | `MEMORY_ACCESS_DENIED`                                                                                                       |
| `MemoryConflictError`   | class           | `MEMORY_REVISION_CONFLICT`                                                                                                   |
| `MemoryArchivedError`   | class           | `MEMORY_ARCHIVED`                                                                                                            |
| `MemoryClosedError`     | class           | `MEMORY_CLOSED`                                                                                                              |
| `MemoryValidationError` | class           | `MEMORY_VALIDATION_FAILED`                                                                                                   |

### `@cieljs/memory` — types

| Export                                   | Description                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `MemoryLayer`                            | `'global.long_term' \| 'space.long_term' \| 'space.daily'`                                                                   |
| `SpaceMemoryLayer`                       | The two space layers                                                                                                         |
| `MemoryKind`                             | `'event' \| 'fact' \| 'preference' \| 'summary'`                                                                             |
| `MemoryStatus`                           | `'active' \| 'archived'`                                                                                                     |
| `MemorySource`                           | `string`                                                                                                                     |
| `MemoryErrorCode`                        | Union of the six stable error codes                                                                                          |
| `MemoryEntry`                            | Current revision of one logical memory, discriminated by `layer`                                                             |
| `MemoryEntryFor<Layer>`                  | `MemoryEntry` narrowed to one layer                                                                                          |
| `SpaceMemoryEntry`                       | `MemoryEntry` narrowed to memories that belong to a space                                                                    |
| `MemoryRevision`                         | Full snapshot of one revision (`memoryId`, `revision`, `kind`, `content`, `sources`, `occurredAt`, `expiresAt`, `createdAt`) |
| `LongTermRememberInput`                  | `{ content, kind?, occurredAt?, expiresAt?, sources? }`                                                                      |
| `DailyRememberInput`                     | `LongTermRememberInput` plus `date?`                                                                                         |
| `UpdateMemoryInput`                      | `{ expectedRevision, content?, kind?, expiresAt?, sources? }`                                                                |
| `ForgetMemoryOptions`                    | `{ expectedRevision }`                                                                                                       |
| `MemoryReadOptions`                      | `{ includeArchived?, includeExpired? }`                                                                                      |
| `MemoryListOptions`                      | Read options plus `kind`, `limit`, `offset`                                                                                  |
| `SpaceMemoryListOptions`                 | List options plus `layers`, `dateFrom`, `dateTo`                                                                             |
| `MemoryHistoryOptions`                   | `{ limit?, beforeRevision? }`                                                                                                |
| `MemorySearchMode`                       | `'hybrid' \| 'full_text' \| 'trigram' \| 'vector'`                                                                           |
| `MemorySearchMatch`                      | `'full_text' \| 'trigram' \| 'vector'`                                                                                       |
| `MemorySearchOptions`                    | Content search options (see the Searching tables)                                                                            |
| `SpaceMemorySearchOptions`               | Content search options plus `layers`, `dateFrom`, `dateTo`                                                                   |
| `SearchAllMemoryOptions`                 | Content search options plus all-layer `layers`, `dateFrom`, `dateTo`                                                         |
| `MemorySearchHit<Layer>`                 | `{ memory, excerpt, score, matches }`                                                                                        |
| `MemorySourceSearchMode`                 | `'auto' \| 'exact' \| 'text'`                                                                                                |
| `MemorySourceSearchOptions`              | Source search options, including `includeHistory`                                                                            |
| `SpaceMemorySourceSearchOptions`         | Source search options restricted to the two space layers                                                                     |
| `MemorySourceSearchHit<Layer>`           | `{ memoryId, revision, spaceId, layer, date, matchedSources, excerpt, score }`                                               |
| `FindMemorySpacesOptions`                | `{ mode?, layers?, limit?, signal? }`                                                                                        |
| `MemorySpaceSourceHit`                   | `{ spaceId, score, matchedSources, memories }`                                                                               |
| `MemoryManagerOptions`                   | Options for `MemoryManager.open()`                                                                                           |
| `MemoryIndexStatus`                      | `{ pending, ready, failed }`                                                                                                 |
| `MemoryLayerStore<Layer, RememberInput>` | The per-layer store interface used by `global`, `longTerm` and `daily`                                                       |
| `GlobalLongTermMemory`                   | `MemoryLayerStore<'global.long_term', LongTermRememberInput>`                                                                |
| `SpaceMemory`                            | The space-bound API returned by `manager.space()`                                                                            |
| `EmbeddingProvider`                      | Re-exported from `@cieljs/model-kit`: the embedding backend contract                                                         |
| `EmbeddingOptions`                       | Re-exported from `@cieljs/model-kit`: `{ purpose, signal? }`                                                                 |

### Object members

`MemoryManager`:

| Member                                | Description                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `timeZone`                            | Resolved IANA time zone.                                                    |
| `global`                              | The global long-term layer store.                                           |
| `space(spaceId)`                      | Returns a space-bound `SpaceMemory`.                                        |
| `getAny(id, options?)`                | Reads one memory from any layer.                                            |
| `searchAll(query, options?)`          | Content search across the whole store.                                      |
| `searchBySource(query, options?)`     | Source search across the whole store.                                       |
| `findSpacesBySource(query, options?)` | Discovers spaces by source.                                                 |
| `getIndexStatus()`                    | `{ pending, ready, failed }`; all zeros without a `VectorService`.          |
| `flushIndexes()`                      | Waits for queued index work.                                                |
| `retryIndexes()`                      | Re-queues failed index tasks.                                               |
| `rebuildIndexes()`                    | Rebuilds current-revision chunks and re-tokenizes sources of all revisions. |
| `close()`                             | Closes the manager; repeated calls return the same promise.                 |
| `[Symbol.asyncDispose]()`             | Calls `close()`, so `await using` works.                                    |

`SpaceMemory`:

| Member                                               | Description                                                |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| `spaceId`                                            | The bound space.                                           |
| `longTerm`, `daily`                                  | Layer stores fixed to `space.long_term` and `space.daily`. |
| `get(id, options?)`, `list(options?)`                | Space-scoped reads (list defaults to both space layers).   |
| `search(query, options?)`                            | Space-scoped content search.                               |
| `searchBySource(query, options?)`                    | Space-scoped source search.                                |
| `update(id, input)`, `forget(id, options)`           | Space-scoped mutations; the layer is resolved internally.  |
| `history(id, options?)`, `getRevision(id, revision)` | Space-scoped revision history.                             |

`MemoryLayerStore<Layer, RememberInput>` (used by `manager.global`, `space.longTerm`, `space.daily`):

| Member                                               | Description                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `layer`                                              | The fixed layer of this store.                                              |
| `remember(input)`                                    | Creates a new logical memory in this layer.                                 |
| `get(id, options?)`, `list(options?)`                | Reads inside this layer.                                                    |
| `search(query, options?)`                            | Content search inside this layer.                                           |
| `searchBySource(query, options?)`                    | Source search inside this layer (`layers` is fixed, so it is not accepted). |
| `update(id, input)`, `forget(id, options)`           | Revision-checked mutation inside this layer.                                |
| `history(id, options?)`, `getRevision(id, revision)` | Revision history inside this layer.                                         |

### `@cieljs/memory/agent`

| Export                        | Kind     | Description                                                          |
| ----------------------------- | -------- | -------------------------------------------------------------------- |
| `memoryTools(options)`        | function | Builds the current-space tool set, optionally with cross-space reads |
| `globalMemoryTools(options)`  | function | Builds the separately authorized global write tool set               |
| `loadMemoryContext(options)`  | function | Returns the three budgeted context sections                          |
| `MemoryToolsOptions`          | type     | Options of `memoryTools()`                                           |
| `GlobalMemoryToolsOptions`    | type     | Options of `globalMemoryTools()`                                     |
| `CrossSpaceMemoryAccess`      | type     | `'related' \| 'all'`                                                 |
| `CrossSpaceMemoryOptions`     | type     | `{ manager, access }`                                                |
| `MemorySourceProvider`        | type     | `(context) => MemorySource[] \| Promise<MemorySource[]>`             |
| `MemorySourceProviderContext` | type     | `{ toolCallId, action: 'remember' \| 'update', signal? }`            |
| `LoadMemoryContextOptions`    | type     | Options of `loadMemoryContext()`                                     |
| `MemoryContextSection`        | type     | `{ text, memories, tokens }`                                         |
| `LoadedMemoryContext`         | type     | `{ globalLongTerm, spaceLongTerm, daily }`                           |

## Behavior notes and design decisions

### Isolation guarantees

- Layer stores carry a fixed selector (`layers` plus an optional `spaceId`), so a call can never reach a layer it was not created for; `remember()` additionally verifies that the requested layer belongs to the entry point.
- Space APIs never include global memories and never touch other spaces. There is no implicit fallback to the manager's whole-database methods.
- The manager's `getAny()`, `searchAll()` and whole-store source search are explicit host-side APIs.
- Agent tools take a bound `SpaceMemory` and their parameters contain no `spaceId`. Cross-space tools only accept the bound space or a space that the same tool set discovered, and every cross-space tool is read-only.
- Cross-space search and global writes are two independent authorizations. Neither one widens `remember`, `update` or `forget`.
- A mismatch between the requested scope and the stored memory surfaces as `MemoryAccessError` rather than a silent empty result.

### Soft-delete semantics

`forget()` only changes `memories.status` to `'archived'` and sets `archivedAt`. Bodies, sources, revisions, chunks and vectors all remain, so `history()` and `getRevision()` still work on archived memories and a host can search them with `includeArchived: true`. Default reads and default searches (including all Agent tools) hide them, and `update()` on an archived memory throws `MemoryArchivedError`. There is no physical delete and no Agent restore tool in the first version.

### Index maintenance

- `remember()` and `update()` replace all chunks of that memory inside the transaction and enqueue embeddings after the commit. Chunk ids are newly generated UUIDs, so an embedding task left over from an older revision cannot write its vector onto the new revision.
- Bodies are chunked at 1600 characters with 160 characters of overlap, and each chunk stores its normalized search text and its tokenized text.
- Full-text and source search read the same tokenizer output that indexing wrote, and source matching uses both a `text[]` containment index for exact identifiers and FTS/trigram indexes over the joined sources.
- Index state is observable: `getIndexStatus()` reports `pending`, `ready`, `failed`; `flushIndexes()` waits for queued work; `retryIndexes()` re-queues failed entries; `rebuildIndexes()` deletes and rebuilds current-revision chunks and re-tokenizes the sources of every revision, current and historical.
- Failures never break retrieval: inside `hybrid`, a failing vector route is reported through `onIndexError` and the route contributes no hits. Vector candidates are used only when their `model`, `dimensions` and `ready` status match the configured `VectorService`.
- `close()` rejects new operations with `MemoryClosedError`, waits for in-flight operations, flushes index work, and is idempotent — repeated calls return the same promise. Closing the manager does not close `Storage`; the host closes storage last, after every borrower.

### Tokenizer changes require `rebuildIndexes()`

The default tokenizer is a singleton `Intl.Segmenter('zh', { granularity: 'word' })` that keeps only word-like segments after `NFKC` normalization and lowercasing, deduplicated. Indexed text and queries must share one tokenizer, so replacing `tokenize` means calling `rebuildIndexes()` afterwards — otherwise stored token text no longer matches what queries produce, and full-text/source search silently stops matching. Custom tokenizers can be passed to `MemoryManager.open({ tokenize })`.

### Embedding provider contract

`MemoryManagerOptions.vectors` accepts a [`VectorService`](../vector/README.md), which receives a provider from `@cieljs/model-kit`:

| Field        | Required | Notes                                                                     |
| ------------ | -------- | ------------------------------------------------------------------------- |
| `model`      | yes      | Model identity; changing model or version must update it.                 |
| `dimensions` | yes      | 1–16000; must match every returned vector.                                |
| `batchSize`  | no       | Maximum texts per request, default `32`, maximum `1000`.                  |
| `embedBatch` | yes      | Must return vectors in input order; queries also use a one-element batch. |
| `embed`      | no       | Single-text variant; derived from `embedBatch` when omitted.              |

Calls carry `purpose: 'query' | 'document'` so a provider can apply prefixes or task types, plus an optional `signal`. `VectorService` derives its own model key from `providerId`, the provider model, `revision`, `granularity`, `dimensions` and `inputConfig`, and caches vectors by `(model key, purpose, text)`. Because retrieval only accepts rows whose model key, dimensions and status match the current service, switching embedding model, dimensions or input configuration requires a new `VectorService` and a re-index; documents indexed under another key are simply not candidates.

### Why the API looks like this

Scope lives on objects rather than in parameters: the host creates `manager.space(spaceId)` and hands the Agent bound tools, so the Agent can neither pass a `spaceId` nor forge one through a write parameter.

Daily and long-term remember calls are two separate tools because those layers have different lifecycles. Splitting them fixes the target layer inside the tool itself, instead of asking the Agent for a database layer string.

An update submits the new values plus `expectedRevision`. The caller has already read the old content in order to decide, but it never has to resend it: `expectedRevision` proves which version the decision was based on, and the transaction reads the current snapshot itself.

Keeping one full snapshot per revision makes history reads, rollback analysis and source auditing simple, and memory bodies are small enough that v1 does not need text diffs or event sourcing. `sources` stays a `string[]` because stable identifiers, names, titles and aliases are all the current requirement needs, and plain strings keep the package free of business field structures.

Content search and source search are separate entry points because "what does this memory say" and "where did it come from" are different questions; separating them also makes cross-space permissions easier to control. Cross-space access is read-only by default, since discovering a related space does not imply the right to modify it.

There is no automatic consolidation in v1. Consolidation brings model decisions, scheduling, batching, conflict retries and quality evaluation with it, and validating layered writes, revisions, source search and Agent permissions first yields real usage data inside a smaller boundary. An Organizer can later consume the existing daily and long-term records without these APIs changing.

### Not implemented in the first version

- Automatic promotion of `space.daily` to `space.long_term`, or of `space.long_term` to `global.long_term`.
- Organizer, consolidation checkpoints or model prompts.
- Scheduled or background maintenance tasks.
- Agent cross-space writes.
- Physical deletion (`purge()`) and restore APIs.
- Semantic search over historical revisions.

## Development

```bash
vp install    # install workspace dependencies
vp check      # format, lint and type check
vp run test   # runs `vp test`
vp run build  # runs `vp pack` for this package after its dependencies
```

`packages/memory/vite.config.ts` defines the `build` and `test` tasks, and the package's `check` script runs `vp check`. The test suite runs against an in-memory PGlite instance (`dataDir: 'memory://'`) and a stub embedding provider (`embedBatch` returning fixed vectors), so no API key or external service is required. Tests cover tokenization, layered writes, revision history, conflicts, soft archive, search modes, cross-space tools, context loading and manager lifecycle.
