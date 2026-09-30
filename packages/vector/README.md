<h1 align="center">@cieljs/vector</h1>

<p align="center">Shared embedding computation, one persistent cross-instance cache, and a per-feature vector index.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#overview">Overview</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#cache-identity">Cache identity</a> ·
  <a href="#shared-computation">Shared computation</a> ·
  <a href="#business-indexes">Indexes</a> ·
  <a href="#lifecycle">Lifecycle</a> ·
  <a href="#api-reference">API</a>
</p>

## Overview

`@cieljs/vector` has two jobs. `VectorService` turns text into embedding vectors and shares the result: it consults a persistent cache, coalesces concurrent requests for the same text, and calls the embedding provider only for what is actually missing. `VectorIndex` maintains the per-feature index tables that make a feature's own chunks searchable.

The embedding provider protocol (`EmbeddingProvider`, `EmbeddingOptions`, `assertEmbeddingVectors`) is defined by [@cieljs/model-kit](../model-kit/README.md); this package only consumes it. Storage comes from [@cieljs/storage](../storage/README.md) and is never opened here.

```text
text ──▶ VectorService ──▶ vector.cache     (shared, cross-instance)
             └──▶ provider ──▶ VectorIndex ──▶ vector.entries   (per namespace × chunk × identity)
```

## Concepts

| Concept            | Role                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `VectorService`    | Computes embeddings for arbitrary text: cache lookup, in-flight coalescing, provider batching, per-caller cancellation                |
| Embedding provider | The `EmbeddingProvider` contract from [@cieljs/model-kit](../model-kit/README.md): `model`, `dimensions`, `batchSize`, `embedBatch()` |
| `vector.cache`     | One persisted row per configuration identity × purpose × text                                                                         |
| `vector.entries`   | Per-feature index jobs: business namespace, chunk id, configuration identity and index status                                         |

## Install

```bash
pnpm add @cieljs/vector
```

The package is ESM-only, exposes a single entry point (`"."` → `dist/index.mjs`), and brings `@cieljs/storage` and `@cieljs/model-kit` with it. Inside this monorepo, dependants declare it with the `workspace:` protocol.

## Quick start

Register `vectorStorage` with the `Storage` that owns the database, then create one `VectorService` per process and reuse it:

```ts
import { Storage } from '@cieljs/storage';
import type { EmbeddingProvider } from '@cieljs/model-kit';
import { VectorService, vectorStorage } from '@cieljs/vector';

// Any `EmbeddingProvider` from @cieljs/model-kit; `embedBatch()` must keep the
// input order and return one vector per text.
declare const provider: EmbeddingProvider;

await using storage = await Storage.open({ dataDir: '.ciel/storage', modules: [vectorStorage] });
await using vectors = new VectorService({
  storage,
  provider,
  providerId: 'provider/deployment',
  revision: 'model-v1',
  granularity: 'chunk',
  inputConfig: 'prefix-and-truncation-v1',
});

const result = await vectors.embed('查询文本', { purpose: 'query' });

// Embedding many texts at once lets the service batch and deduplicate them.
const documents = await vectors.embedBatch(['第一段', '第二段'], { purpose: 'document' });
```

`dimensions` and `batchSize` are read from the provider (`batchSize` falls back to model-kit's default of 32). `embedBatch()` order always matches the input order.

## Cache identity

Two keys decide whether a vector can be reused. Both are SHA-256 hashes of a JSON tuple, and both are exposed:

```ts
vectors.model; // identity of the producing configuration
vectors.key('查询文本', 'query'); // identity + purpose + the actual text
```

The identity hash covers, in this order:

| Part             | Meaning                                                         | Update it when                                                          |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `providerId`     | Provider, deployment or endpoint identity — **never a secret**  | You point at another deployment or endpoint                             |
| `provider.model` | The provider's own model name                                   | Taken from the provider; changing it changes the identity automatically |
| `revision`       | Your label for the deployed version                             | You roll out a new revision                                             |
| `dimensions`     | Output vector width                                             | The provider's dimensions change                                        |
| `granularity`    | Input granularity, for example `message`, `chunk` or `sentence` | You change how text is split before embedding                           |
| `inputConfig`    | Tokenization, truncation, prefix or normalization config        | Any of those changes                                                    |

The per-text key additionally covers `purpose` (`'query' | 'document'`) and the exact text.

> [!WARNING]
> Whenever something that affects the output vector changes, update the matching identity field. Otherwise new and old vectors share a cache key and retrieval silently mixes two embedding spaces.

> [!NOTE]
> The identity is a hash of the configuration tuple, not a secret: **API keys are deliberately excluded**, so rotating a key never invalidates the cache. The constructor rejects blank `providerId`, `revision`, `granularity` or `inputConfig` values.

## Shared computation

### Caching and coalescing

| Situation                                          | Behaviour                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Same text twice inside one `embedBatch()` call     | One provider call; both positions resolve from the same result                                           |
| Two concurrent calls with the same key             | One in-flight promise, shared by both callers                                                            |
| Same key in a later call, same instance            | Cache hit in `vector.cache`, no provider call                                                            |
| Same key from **another** `VectorService` instance | Cache hit as well — `vector.cache` lives in the database, not in memory                                  |
| Different `purpose` for the same text              | Different key, so `query` and `document` are embedded separately when the model needs different prefixes |

Missing texts are grouped into batches of `batchSize` and inserted with `onConflictDoNothing()`, so a racing writer cannot fail the batch. Every batch is dimension-checked with `assertEmbeddingVectors` before it is stored. Results are copied per caller, so mutating the returned array never corrupts the shared value.

### Cancellation and failures

```ts
const controller = new AbortController();
const pending = vectors.embedBatch(texts, { purpose: 'document', signal: controller.signal });

controller.abort(); // only this caller fails; the shared computation keeps running
await pending; // rejects with the abort reason
```

- The signal is checked before any work (`throwIfAborted()`), so an already-aborted call never touches the cache or the provider.
- Aborting one waiter rejects only that waiter, with `signal.reason`. Other waiters for the same key still receive their vector — the shared computation is not interrupted by one caller.
- **Failures are not cached.** A rejected provider call rejects every waiter for those texts and stores nothing, so the same text can simply be retried.

## Business indexes

`VectorIndex` keeps one feature's `vector.entries` rows in sync with that feature's own table. Each feature owns its chunking, its full-text search and its result aggregation; this class only tracks which chunks have a usable vector.

```ts
import { VectorIndex } from '@cieljs/vector';

// `chunks` belongs to the feature — this package never creates it.
const index = new VectorIndex(storage.db, vectors, {
  namespace: 'notes',
  table: chunks,
  id: chunks.id,
  content: chunks.body,
  // Optional: `condition(sessionId?)` returns the SQL that narrows the rows
  // this index manages, or `undefined` for all of them.
});

await index.rebuild(); // re-index everything in scope
await index.flush(); // wait for the background indexing queue

console.log(await index.status()); // { pending, ready, failed }
const queryVector = await index.embedQuery('how do we store notes?');
```

| Method                               | Description                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare(reset = false, sessionId?)` | Insert missing chunk ids as `pending`, reset `failed` rows to `pending` (every row in scope when `reset` is `true`), and delete entries whose chunk id no longer exists in the source table |
| `addPending(tx, ids)`                | Register chunk ids inside a caller-provided transaction                                                                                                                                     |
| `enqueue()`                          | Start (or continue) background indexing; calls are serialized                                                                                                                               |
| `rebuild(sessionId?)`                | `prepare(true, sessionId)` followed by `enqueue()`                                                                                                                                          |
| `retry()`                            | `prepare()` followed by `enqueue()` — picks up only failed rows                                                                                                                             |
| `flush()`                            | Wait until the indexing queue is drained                                                                                                                                                    |
| `status()`                           | Counts `pending`, `ready` and `failed` rows in this namespace and identity                                                                                                                  |
| `embedQuery(query, signal?)`         | Embed a search query with `purpose: 'query'`                                                                                                                                                |
| `reportError(error)`                 | Report an indexing or retrieval failure through `onError`, or `console.warn` when no callback was given                                                                                     |
| `model`                              | Getter returning `{ model, dimensions, namespace }`, or `undefined` without a provider                                                                                                      |

Without a provider (`new VectorIndex(db, undefined, source)`) every database-touching method becomes a no-op — `status()` reports zeros, `embedQuery()` returns `null`, and no index rows are created or updated — which is how a feature runs with full-text search only. Document indexing always uses `purpose: 'document'`; a failed batch marks exactly those rows `failed` with the error text and reports it through `onError` (or `console.warn`).

### `vector.cache` vs `vector.entries`

| Table            | Holds                                                                                   | Key                           |
| ---------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| `vector.cache`   | `key`, `profile` (identity), `purpose`, `content`, `embedding`                          | `key`                         |
| `vector.entries` | `namespace`, `chunkId`, `model` (identity), `dimensions`, `cacheKey`, `status`, `error` | `(namespace, chunkId, model)` |

`vector.entries.cacheKey` references `vector.cache.key`, and a check constraint enforces that only `ready` rows carry a cache key. Sharing one cache across features never widens a feature's query scope: every index query is filtered by that index's own `namespace` and identity, so features reuse the vectors but never each other's index rows. `prepare()` deletes only out-of-scope index rows — cache rows another feature still needs stay.

## Lifecycle

- The constructor calls `storage.require(vectorStorage)`, so creating a `VectorService` against a `Storage` that never registered the module fails immediately.
- `close()` marks the service closed and then waits for the in-flight computation it started (`Promise.allSettled` over the pending promises). Later calls reject with `VectorService 已关闭`.
- **Closing the service never closes `Storage`.** Storage is borrowed and the host closes it last; see [Borrowing and lifecycle](../storage/README.md#borrowing-and-lifecycle).

## API reference

| Export          | Kind            | Description                                                                                                                                                           |
| --------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VectorService` | class           | Constructor takes `VectorOptions`; fields `model`, `dimensions`, `batchSize`, `options`; methods `key()`, `embed()`, `embedBatch()`, `close()`, `Symbol.asyncDispose` |
| `VectorOptions` | type            | `{ storage, provider, providerId, revision, granularity, inputConfig }`                                                                                               |
| `VectorIndex`   | class           | Constructor `(db, provider \| undefined, source, onError?)`; see the method table above                                                                               |
| `VectorSource`  | type            | `{ namespace, table, id, content, condition? }`                                                                                                                       |
| `vectorCache`   | Drizzle table   | `vector.cache`                                                                                                                                                        |
| `vectorEntries` | Drizzle table   | `vector.entries`                                                                                                                                                      |
| `vectorStorage` | `StorageModule` | `id: 'vector'`, migration `0001`, which creates both tables, the check constraint and the `entries_jobs` index                                                        |

## Design notes

`VectorService.model` and `vector.entries.model` store the SHA-256 identity hash rather than the provider's model name, so the stored configuration stays verifiable without leaking endpoint details. `purpose` keeps the two retrieval sides apart: the same text embedded as a query and as a document can be two different vectors, and only the one that was actually computed ends up in the cache.

The cache is the coordination point. In-process coalescing avoids duplicate work inside one instance, while the database table lets a result survive a restart and be shared between instances. Cancellation is per waiter — a shared computation has no single owner, so an abort detaches one waiter instead of tearing down work that others are still waiting for. Index rows and cache rows are scoped differently: index state belongs to a namespace and an identity, so switching model or dimensions simply creates a new set of pending rows.

## Development

```bash
vp install      # after pulling changes
vp check        # format, lint and type check
vp test --run   # unit tests
vp run build    # build the package
```

Tests live in `src/service.test.ts` and cover cache isolation across provider, revision, granularity, input config, model name and dimensions; concurrent and intra-batch deduplication; cross-instance reuse; cancellation of a single waiter; and retry after a failure. `packages/vector/package.json` has no `scripts`; the `build` (`vp pack`) and `test` tasks come from the `run.tasks` block in `vite.config.ts`, which is why they are invoked with `vp run`.
