<h1 align="center">@cieljs/model-kit</h1>

<p align="center">Model capability contracts: embedding providers, vector validation, and a separate model registry.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#embedding-contracts">Embedding contracts</a> ·
  <a href="#query-and-document">Query and document</a> ·
  <a href="#model-registry">Model registry</a> ·
  <a href="#api-reference">API reference</a>
</p>

`@cieljs/model-kit` describes what a model must be able to do, without depending on an agent, a store or a particular inference runtime. Today it provides the embedding types, their defaults and vector validation; later capabilities such as TTS can be added as independent modules without committing to a vendor in advance.

The Qwen inference implementation stays in [`@cieljs/embed`](../embed/README.md), and the application creates and releases those resources.

Embedding contracts moved here from `@cieljs/agent-kit`: update the imports and add the workspace dependency.

## Concepts

| Concept            | Export                      | Role                                                                       |
| ------------------ | --------------------------- | -------------------------------------------------------------------------- |
| Embedding provider | `EmbeddingProvider`         | What an adapter must expose: model id, dimensions, batch embedding         |
| Resolved provider  | `ResolvedEmbeddingProvider` | A provider after validation, with `batchSize` and `embed` guaranteed       |
| Purpose            | `EmbeddingOptions.purpose`  | `'query'` or `'document'`, so an adapter can choose prefixes or task types |
| Model registry     | `@cieljs/model-kit/models`  | Provider and model catalog built on `@earendil-works/pi-ai`                |

## Install

`@cieljs/model-kit` is part of the Ciel monorepo and is consumed through the workspace:

```bash
pnpm add @cieljs/model-kit
```

[`@cieljs/embed`](../embed/README.md) is the inference implementation that satisfies the contract. [`@cieljs/vector`](../vector/README.md), [`@cieljs/memory`](../memory/README.md) and [`@cieljs/session`](../session/README.md) accept this contract as their input.

## Quick start

```ts
import {
  assertEmbeddingVectors,
  resolveEmbeddingProvider,
  type EmbeddingProvider,
} from '@cieljs/model-kit';

const provider: EmbeddingProvider = {
  model: 'local/demo-embedding',
  dimensions: 3,
  async embedBatch(texts, { purpose }) {
    // Vectors must come back in the same order as the input texts.
    return texts.map(text => [text.length, purpose === 'query' ? 1 : 0, 0.5]);
  },
};

// Validation happens here; the result always has batchSize and embed.
const embedding = resolveEmbeddingProvider(provider)!;

const query = await embedding.embed('how are memories stored?', { purpose: 'query' });
const documents = await embedding.embedBatch(['memories are grouped by space'], {
  purpose: 'document',
});

assertEmbeddingVectors(documents, 1, embedding.dimensions);
```

## Embedding contracts

```ts
interface EmbeddingOptions {
  /** Distinguishes a retrieval query from a document to be indexed. */
  purpose: 'query' | 'document';
  signal?: AbortSignal;
}

interface EmbeddingProvider {
  /** Model identity; must be updated together with the model or its version. */
  readonly model: string;
  /** Output vector dimensions. */
  readonly dimensions: number;
  /** Maximum texts per indexing request, 32 by default. */
  readonly batchSize?: number;
  /** Vector for a single text; when omitted it is derived from `embedBatch`. */
  embed?(text: string, options: EmbeddingOptions): Promise<number[]>;
  /** The order of the result must match the input; queries use a one-element array too. */
  embedBatch(texts: string[], options: EmbeddingOptions): Promise<number[][]>;
}

interface ResolvedEmbeddingProvider extends EmbeddingProvider {
  readonly batchSize: number;
  embed(text: string, options: EmbeddingOptions): Promise<number[]>;
}
```

`resolveEmbeddingProvider(provider)` is the boundary between an untrusted adapter and the rest of Ciel:

- `undefined` in, `undefined` out — an optional configuration value can be passed straight through.
- The configuration is validated with `assertEmbeddingProvider()`, so an invalid provider throws here rather than on the first indexing request.
- `batchSize` falls back to `DEFAULT_EMBEDDING_BATCH_SIZE`.
- `embed` is guaranteed: the provider's own `embed` is preferred, and it is asserted to return one vector; otherwise `embedBatch([text])` is called and its first vector is used.
- `embedBatch` is called on the provider itself, so an adapter that reads `this` keeps working.

## Validation and defaults

| Export                         | Value   | Meaning                                     |
| ------------------------------ | ------- | ------------------------------------------- |
| `DEFAULT_EMBEDDING_BATCH_SIZE` | `32`    | Batch size used when the provider omits one |
| `MAX_EMBEDDING_BATCH_SIZE`     | `1000`  | Largest accepted `batchSize`                |
| `MAX_EMBEDDING_DIMENSIONS`     | `16000` | Largest accepted `dimensions`               |

`assertEmbeddingProvider(provider)` rejects an empty or whitespace-only `model`, a `dimensions` that is not a safe integer between `1` and `16000`, and a `batchSize` that is not a safe integer between `1` and `1000`. All of these throw `TypeError`.

`assertEmbeddingVectors(vectors, expectedCount, dimensions)` is an assertion function (`asserts vectors is number[][]`) that checks the shape of what a model returned:

| Check           | Rejected when                                                         |
| --------------- | --------------------------------------------------------------------- |
| Count           | The value is not an array, or its length differs from `expectedCount` |
| Dimensions      | An entry is not an array, or its length differs from `dimensions`     |
| Finite values   | Any entry contains a non-number or a non-finite number                |
| Non-zero vector | An entry contains only zeros                                          |

Error messages are written in Chinese, for example `Embedding 模型标识不能为空`, `Embedding 维数必须是 1 到 16000 的整数` and `Embedding 向量必须是非零向量`.

## Query and document

`purpose` is required on every embedding call, and the values mean different things:

| `purpose`    | Meaning                                           | Adapter behaviour                                    |
| ------------ | ------------------------------------------------- | ---------------------------------------------------- |
| `'query'`    | A retrieval query sent while looking something up | May prepend a task instruction or use a query prompt |
| `'document'` | Text that is about to be indexed                  | Usually embedded as-is                               |

This package never rewrites the text itself: mapping `purpose` onto an instruction, prefix or task type is the adapter's job — see [`@cieljs/embed`](../embed/README.md) for a concrete mapping.

Two rules apply to every call:

- **Order is part of the contract.** `embedBatch()` must return vectors in the same order as the input texts, and a single query is passed as a one-element array rather than as a special case.
- **`model` identifies the vector space.** Vectors produced by different models or versions must never be compared, even when their dimensions match, so `model` has to change whenever the model does.

## Model registry

`@cieljs/model-kit/models` builds the provider and model catalog on top of `@earendil-works/pi-ai`:

```ts
import { models } from '@cieljs/model-kit/models';

const model = models.getModel('xiaomi', 'mimo-v2.5');
```

`getModel(provider, id)` is a synchronous lookup against the last known catalog; it returns `undefined` when the provider or the model id is unknown.

Importing the entry has side effects: it creates the collection and registers every provider.

| Registration | Value                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Xiaomi       | id `xiaomi`, base URL `https://api.xiaomimimo.com/v1`, API `openai-completions`, credential from the `XIAOMI_API_KEY` environment variable |
| Built-ins    | Every provider returned by `builtinProviders()` from `@earendil-works/pi-ai`                                                               |

The Xiaomi catalog contains `mimo-v2.5`:

| Field              | Value                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `name`             | `MiMo-V2.5`                                                                                                     |
| `input`            | `['text', 'image']`                                                                                             |
| `reasoning`        | `true`                                                                                                          |
| `contextWindow`    | `262144`                                                                                                        |
| `maxTokens`        | `131072`                                                                                                        |
| `cost`             | `{ input: 0.4, output: 2, cacheRead: 0, cacheWrite: 0 }`                                                        |
| `thinkingLevelMap` | `off: 'none'`, `minimal: null`, `low: 'low'`, `medium: 'medium'`, `high: 'high'`, `xhigh: 'xhigh'`, `max: null` |
| `compat`           | `{ supportsDeveloperRole: false }`                                                                              |

## API reference

`@cieljs/model-kit`

| Export                                                       | Kind      | Description                                                                                          |
| ------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------- |
| `DEFAULT_EMBEDDING_BATCH_SIZE`                               | const     | `32`, used when a provider omits `batchSize`                                                         |
| `MAX_EMBEDDING_BATCH_SIZE`                                   | const     | `1000`                                                                                               |
| `MAX_EMBEDDING_DIMENSIONS`                                   | const     | `16000`                                                                                              |
| `EmbeddingOptions`                                           | interface | `{ purpose: 'query' \| 'document'; signal?: AbortSignal }`                                           |
| `EmbeddingProvider`                                          | interface | The adapter contract: `model`, `dimensions`, optional `batchSize` and `embed`, required `embedBatch` |
| `ResolvedEmbeddingProvider`                                  | interface | A provider with `batchSize: number` and `embed` guaranteed                                           |
| `resolveEmbeddingProvider(provider)`                         | function  | Validate, fill defaults and guarantee `embed`; `undefined` stays `undefined`                         |
| `assertEmbeddingProvider(provider)`                          | function  | Validate model id, dimensions and batch size                                                         |
| `assertEmbeddingVectors(vectors, expectedCount, dimensions)` | function  | Assert count, dimensions, finite values and non-zero vectors                                         |

`@cieljs/model-kit/models`

The entry point exports exactly one value, `models`; the rows below are the members it exposes, which come from the `MutableModels` collection of `@earendil-works/pi-ai`.

| Export                                                                                   | Kind   | Description                                                                    |
| ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `models`                                                                                 | const  | A `MutableModels` collection with the Xiaomi provider and built-ins registered |
| `models.getModel(provider, id)`                                                          | method | Synchronous model lookup; `Model<Api> \| undefined`                            |
| `models.getProviders()` / `getProvider(id)` / `getModels(provider?)`                     | method | Inspect the registered providers and models                                    |
| `models.setProvider(provider)` / `deleteProvider(id)` / `clearProviders()`               | method | Mutate the collection                                                          |
| `models.stream()` / `complete()` / `streamSimple()` / `completeSimple()`                 | method | Run a request through the provider that owns the model, with auth applied      |
| `models.getAvailable()` / `checkAuth(id)` / `getAuth(...)` / `login(...)` / `logout(id)` | method | Credential-aware model availability and login flows                            |
| `models.refresh(options?)`                                                               | method | Refresh the catalogs of configured dynamic providers                           |

## Design decisions

The root entry point depends on nothing at runtime — no agent, no database, no inference stack — so every layer can share these types without dragging an implementation along. `resolveEmbeddingProvider()` accepts an optional provider and returns `undefined` for `undefined`, which keeps optional configuration code free of null checks. Validation sits on a single boundary: adapters are ordinary JavaScript and can return anything, so `assertEmbeddingVectors()` is the one checkpoint before vectors reach storage, and configuration or vector problems leave as `TypeError`s instead of silently repaired values.

The registry is deliberately a separate entry point. `src/index.ts` only re-exports the embedding module, while `src/models/index.ts` creates a registry and registers the Xiaomi provider plus every built-in. Keeping them apart means a consumer that only needs the embedding contract — [`@cieljs/vector`](../vector/README.md), for example — never pays for initializing the provider catalog or loading its data.

## Development

Run these commands in this package:

```bash
vp check
vp test --run
vp run build
```

`tests/embedding.test.ts` exercises the resolver, the default batch size, `this` preservation, invalid configuration and vector validation with a stub provider, so no model service is required.
