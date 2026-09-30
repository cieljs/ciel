<h1 align="center">@cieljs/embed</h1>

<p align="center">Run Qwen3 Embedding locally in Node.js and turn queries and documents into vectors.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#options">Options</a> ·
  <a href="#model-download-and-cache">Download and cache</a> ·
  <a href="#api-reference">API reference</a>
</p>

`@cieljs/embed` loads `onnx-community/Qwen3-Embedding-0.6B-ONNX` through Transformers.js and implements the `ResolvedEmbeddingProvider` contract from [`@cieljs/model-kit`](../model-kit/README.md). The model is loaded on demand and one provider reuses the inference pipeline it has already created. Model files are downloaded from the same-named repository on ModelScope and reuse the existing local cache; after a failed download the next call tries to load again.

## Concepts

| Concept            | Meaning                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| Embedding provider | The object `qwen()` returns: `model`, `dimensions`, `batchSize`, `embed`, `embedBatch` |
| Purpose            | `'query'` gets an instruction prefix, `'document'` is embedded as-is                   |
| Pooling            | Last-token pooling plus normalization, done by the Transformers.js pipeline            |
| MRL truncation     | Shortening 1024-dimension output to `dimensions`, then normalizing again               |

## Install

`@cieljs/embed` is part of the Ciel monorepo and is consumed through the workspace:

```bash
pnpm add @cieljs/embed
```

It depends on `@huggingface/transformers` for inference and on [`@cieljs/model-kit`](../model-kit/README.md) for the embedding contract and its validation. Vectors produced here can be handed to [`@cieljs/vector`](../vector/README.md), and from there to [`@cieljs/memory`](../memory/README.md) or [`@cieljs/session`](../session/README.md) indexing.

## Quick start

```ts
import { qwen } from '@cieljs/embed';

const embedding = qwen({ cacheDir: '.cache' });

const query = await embedding.embed('怎么保存长期记忆？', {
  purpose: 'query',
});

const documents = await embedding.embedBatch(
  ['长期记忆按空间隔离。', '会话历史保存在本地数据库中。'],
  { purpose: 'document' },
);
```

Query text automatically receives the retrieval instruction; document text is embedded unchanged. Output uses last-token pooling and is normalized, so it can go straight to `@cieljs/memory` or `@cieljs/session`.

## Options

`qwen(options)` takes a required options object:

```ts
const embedding = qwen({
  cacheDir: '.cache',
  dimensions: 512,
  batchSize: 16,
  dtype: 'q8',
  device: 'wasm',
  instruction: '根据查询找出相关文档。',
});
```

| Option        | Type                       | Default                          | Meaning                                                                                               |
| ------------- | -------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `cacheDir`    | `string`                   | required — there is no default   | Transformers.js model cache directory; a relative path resolves against the current working directory |
| `dimensions`  | `number`                   | `1024`                           | Output dimensions; `1` to `1024` via MRL truncation                                                   |
| `batchSize`   | `number`                   | `32`                             | Maximum texts per inference call, validated to `1`–`1000`                                             |
| `dtype`       | `'fp32' \| 'fp16' \| 'q8'` | `'q8'`                           | ONNX weight precision                                                                                 |
| `device`      | `'wasm' \| 'webgpu'`       | Transformers.js default          | Inference device; omit to let the runtime choose                                                      |
| `instruction` | `string`                   | `DEFAULT_QWEN_QUERY_INSTRUCTION` | Retrieval instruction, used only for `purpose: 'query'`                                               |

Invalid options fail when `qwen()` is called, not on the first embedding:

- `dimensions` must be a safe integer between `1` and `1024`, otherwise `TypeError: Qwen Embedding dimensions 必须是 1 到 1024 的整数`.
- `batchSize` is validated by `resolveEmbeddingProvider()`, which rejects anything outside `1`–`1000`.

## Model download and cache

Model files come from ModelScope. At import time the package redirects exactly one URL prefix:

```text
https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/main/…
→ https://modelscope.cn/models/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/master/…
```

- Only requests for this model are redirected; every other download keeps Transformers.js's normal behaviour.
- The `authorization` header is dropped on the redirected request, so a Hugging Face credential is never forwarded; other headers are kept.
- Because the request path is unchanged, Transformers.js computes the same cache key and an existing local cache is reused as it is.
- The pipeline is created on the first non-empty `embedBatch()` call and cached inside the provider. A failed load clears the cached promise, so the next call retries and one successful load is shared by concurrent callers.
- `embedBatch([])` returns `[]` without loading the model at all.
- The provider exposes no teardown API: the loaded ONNX session stays with the provider instance for reuse.

## Vector post-processing

Text is formatted per purpose before inference:

| `purpose`    | Text sent to the model                          |
| ------------ | ----------------------------------------------- |
| `'document'` | the text unchanged                              |
| `'query'`    | `` `Instruct: ${instruction}\nQuery:${text}` `` |

Inference runs with `pooling: 'last_token'` and `normalize: true`, so the returned vectors are already normalized.

When `dimensions` equals `QWEN_EMBEDDING_DIMENSIONS` (1024) the output is returned as-is. Otherwise every vector is truncated to the first `dimensions` values and normalized again, which keeps cosine similarity meaningful for the shorter vectors; a zero-length norm is left untouched instead of producing `NaN`.

> [!NOTE]
> As of this version the truncation path also calls `console.log` with the truncated vectors before returning them.

## Cancellation

Every embedding call accepts `signal` in its options object, and the provider checks it at three points: before the model is loaded, after the model is ready, and after inference has produced output.

```ts
const controller = new AbortController();

const vectors = await embedding.embedBatch(['要索引的文档'], {
  purpose: 'document',
  signal: controller.signal,
});
```

> [!WARNING]
> A model load that has already started is not force-interrupted: the signal is not passed to Transformers.js, so the check happens once the load settles. `embedBatch([])` also returns before the first check.

## API reference

`@cieljs/embed`

| Export                              | Kind     | Description                                                                      |
| ----------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `qwen(options)`                     | function | Creates a `ResolvedEmbeddingProvider` backed by a local Transformers.js pipeline |
| `QWEN_EMBEDDING_MODEL`              | const    | `'Qwen3-Embedding-0.6B'`, reported as the provider's `model`                     |
| `QWEN_EMBEDDING_SOURCE`             | const    | `'onnx-community/Qwen3-Embedding-0.6B-ONNX'`                                     |
| `QWEN_EMBEDDING_DIMENSIONS`         | const    | `1024`, the model's native output size                                           |
| `DEFAULT_QWEN_EMBEDDING_BATCH_SIZE` | const    | `32`                                                                             |
| `DEFAULT_QWEN_QUERY_INSTRUCTION`    | const    | `'Given a retrieval query, retrieve relevant documents that answer the query.'`  |
| `QwenEmbeddingOptions`              | type     | `{ cacheDir, dimensions?, batchSize?, dtype?, device?, instruction? }`           |
| `QwenEmbeddingDType`                | type     | `'fp32' \| 'fp16' \| 'q8'`                                                       |
| `QwenEmbeddingDevice`               | type     | `'wasm' \| 'webgpu'`                                                             |

The returned provider also carries the contract members from [`@cieljs/model-kit`](../model-kit/README.md):

| Member         | Description                                                                   |
| -------------- | ----------------------------------------------------------------------------- |
| `model`        | `QWEN_EMBEDDING_MODEL`                                                        |
| `dimensions`   | The resolved `dimensions` option                                              |
| `batchSize`    | The resolved `batchSize` option                                               |
| `embed()`      | Implemented by `resolveEmbeddingProvider()` over `embedBatch`                 |
| `embedBatch()` | Formats the texts, runs one inference call and returns vectors in input order |

## Design decisions

Inference is local: the model runs in-process through Transformers.js, so once it is cached there is no embedding API key and no network round trip. The pipeline promise is cached in the closure, which makes repeated `embed()` calls cheap and lets concurrent callers share a single load; when a load is rejected that cached promise is cleared instead of poisoning the provider, so a later call can succeed once the network or the cache is healthy again.

Downloads default to ModelScope. The repository path is identical on both hosts, so redirecting that one prefix keeps the cache key stable while using a source that is reachable in the regions this package targets.

Purpose is explicit: the adapter maps `purpose: 'query'` onto Qwen's instruction format and leaves documents untouched, exactly as the [`@cieljs/model-kit`](../model-kit/README.md) contract asks. Truncation happens before normalization, because cutting dimensions changes a vector's length and unnormalized truncated vectors would not be comparable.

## Development

Run these commands in this package:

```bash
vp check
vp test --run
vp run build
```

The unit tests replace the inference pipeline with a stub and mock the fetch used for downloads, so they neither download the model nor need a network connection. They cover the defaults, MRL output dimensions, the ModelScope redirect, credential stripping, load retry, cache directory pass-through and dimension validation.
