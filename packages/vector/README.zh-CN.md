<h1 align="center">@cieljs/vector</h1>

<p align="center">共享的向量计算、一份跨实例持久缓存，以及每个业务自己的向量索引。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概览">概览</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#缓存标识">缓存标识</a> ·
  <a href="#共享计算">共享计算</a> ·
  <a href="#业务索引">业务索引</a> ·
  <a href="#生命周期">生命周期</a> ·
  <a href="#api-参考">API</a>
</p>

## 概览

`@cieljs/vector` 做两件事。`VectorService` 把文本变成向量并共享结果：先查持久缓存，合并同一文本的并发请求，只对真正缺失的部分调用 Embedding Provider。`VectorIndex` 维护各业务自己的索引表，让业务的分块结果可以被检索。

Embedding Provider 协议（`EmbeddingProvider`、`EmbeddingOptions`、`assertEmbeddingVectors`）由 [@cieljs/model-kit](../model-kit/README.zh-CN.md) 定义，本包只是使用它。数据库来自 [@cieljs/storage](../storage/README.zh-CN.md)，本包不会自己打开数据库。

```text
文本 ──▶ VectorService ──▶ vector.cache     （共享，跨实例持久化）
             └──▶ Provider ──▶ VectorIndex ──▶ vector.entries   （按 namespace × chunk × 标识）
```

## 概念

| 概念               | 作用                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `VectorService`    | 为任意文本计算向量：查询缓存、合并进行中的请求、按 batch 调用 Provider、按调用者各自取消                                          |
| Embedding Provider | [@cieljs/model-kit](../model-kit/README.zh-CN.md) 的 `EmbeddingProvider` 契约：`model`、`dimensions`、`batchSize`、`embedBatch()` |
| `vector.cache`     | 每个「配置标识 × 用途 × 文本」一行，持久保存计算结果                                                                              |
| `vector.entries`   | 各业务的索引任务：业务 namespace、chunk ID、配置标识与索引状态                                                                    |

## 安装

```bash
pnpm add @cieljs/vector
```

本包是纯 ESM，只有一个入口（`"."` → `dist/index.mjs`），并会带上 `@cieljs/storage` 与 `@cieljs/model-kit`。在本仓库内，依赖方使用 `workspace:` 协议声明它。

## 快速开始

先把 `vectorStorage` 注册到拥有数据库的 `Storage` 上，然后每个进程创建一个 `VectorService` 并复用：

```ts
import { Storage } from '@cieljs/storage';
import type { EmbeddingProvider } from '@cieljs/model-kit';
import { VectorService, vectorStorage } from '@cieljs/vector';

// 任意 @cieljs/model-kit 的 `EmbeddingProvider`；
// `embedBatch()` 必须保持输入顺序，并为每个文本返回一个向量。
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

// 一次传入多个文本，服务会自行合并与去重。
const documents = await vectors.embedBatch(['第一段', '第二段'], { purpose: 'document' });
```

`dimensions` 与 `batchSize` 取自 Provider（`batchSize` 缺省时使用 model-kit 的默认值 32）。`embedBatch()` 的返回顺序始终与输入一致。

## 缓存标识

是否复用向量由两个键决定，它们都是 JSON 元组的 SHA-256 结果，并且都对外暴露：

```ts
vectors.model; // 产出配置的标识
vectors.key('查询文本', 'query'); // 标识 + 用途 + 实际文本
```

标识哈希按顺序覆盖以下字段：

| 字段             | 含义                                            | 何时更新                                 |
| ---------------- | ----------------------------------------------- | ---------------------------------------- |
| `providerId`     | 服务商、部署或端点身份——**绝不能是密钥**        | 切换到另一个部署或端点时                 |
| `provider.model` | Provider 自己的模型名称                         | 由 Provider 提供；更换模型时标识自动改变 |
| `revision`       | 你给当前部署版本打的标记                        | 发布新版本时                             |
| `dimensions`     | 输出向量维数                                    | Provider 的维数变化时                    |
| `granularity`    | 输入粒度，例如 `message`、`chunk` 或 `sentence` | 改变切分方式时                           |
| `inputConfig`    | 分词、截断、前缀或归一化配置                    | 其中任何一项变化时                       |

逐文本的键还额外覆盖 `purpose`（`'query' | 'document'`）与实际文本。

> [!WARNING]
> 任何影响输出向量的变化都必须同步更新对应的标识字段。否则新旧向量会共用同一个缓存键，检索结果会悄悄混入两套向量空间。

> [!NOTE]
> 标识是配置元组的哈希，不是凭据：**不包含 API key**，因此轮换密钥不会让缓存失效。构造函数会拒绝空的 `providerId`、`revision`、`granularity` 或 `inputConfig`。

## 共享计算

### 缓存与请求合并

| 场景                                      | 行为                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| 同一次 `embedBatch()` 中出现重复文本      | 只调用一次 Provider，两个位置共用同一结果                  |
| 同一键的两个并发调用                      | 共用一个进行中的 Promise                                   |
| 同一实例、稍后再次请求同一键              | 命中 `vector.cache`，不调用 Provider                       |
| **另一个** `VectorService` 实例请求同一键 | 同样命中缓存——`vector.cache` 存在数据库里，不在内存里      |
| 同一文本使用不同 `purpose`                | 键不同；当模型需要不同前缀时，query 与 document 会分别计算 |

缺失的文本按 `batchSize` 分组，并以 `onConflictDoNothing()` 写入，因此并发写入不会让整批失败。每批结果入库前都会用 `assertEmbeddingVectors` 校验维数。返回值按调用者复制一份，修改返回的数组不会污染共享结果。

### 取消与失败

```ts
const controller = new AbortController();
const pending = vectors.embedBatch(texts, { purpose: 'document', signal: controller.signal });

controller.abort(); // 只有本次调用失败，共享计算继续
await pending; // 以取消原因拒绝
```

- 开始任何工作前先检查信号（`throwIfAborted()`），已经取消的调用不会触碰缓存或 Provider。
- 取消只让该等待者以 `signal.reason` 失败。同一键的其他等待者仍会拿到向量——共享计算不会被其中一个调用者中断。
- **失败结果不进入缓存。** Provider 调用失败会让这些文本的所有等待者一起失败，且不写入任何内容，因此同一文本可以直接重试。

## 业务索引

`VectorIndex` 让某个业务的 `vector.entries` 与该业务自己的表保持一致。切块、全文检索与结果聚合仍由业务自己负责，这个类只跟踪「哪些 chunk 已经有可用向量」。

```ts
import { VectorIndex } from '@cieljs/vector';

// `chunks` 属于业务自己，本包不会创建它。
const index = new VectorIndex(storage.db, vectors, {
  namespace: 'notes',
  table: chunks,
  id: chunks.id,
  content: chunks.body,
  // 可选：`condition(sessionId?)` 返回缩小本次管理范围的 SQL，
  // 返回 `undefined` 表示全部行。
});

await index.rebuild(); // 重建范围内的全部索引
await index.flush(); // 等待后台索引队列排空

console.log(await index.status()); // { pending, ready, failed }
const queryVector = await index.embedQuery('笔记是怎么存的？');
```

| 方法                                 | 说明                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare(reset = false, sessionId?)` | 把缺失的 chunk ID 插入为 `pending`，把 `failed` 重置为 `pending`（`reset` 为 `true` 时重置范围内全部行），并删除源表中已不存在的 chunk 关联 |
| `addPending(tx, ids)`                | 在调用方给定的事务中登记 chunk ID                                                                                                           |
| `enqueue()`                          | 启动（或继续）后台索引；多次调用串行执行                                                                                                    |
| `rebuild(sessionId?)`                | 先 `prepare(true, sessionId)`，再 `enqueue()`                                                                                               |
| `retry()`                            | 先 `prepare()`，再 `enqueue()`——只处理失败行                                                                                                |
| `flush()`                            | 等待索引队列排空                                                                                                                            |
| `status()`                           | 统计本 namespace 与本标识下 `pending`、`ready`、`failed` 的行数                                                                             |
| `embedQuery(query, signal?)`         | 以 `purpose: 'query'` 计算检索向量                                                                                                          |
| `reportError(error)`                 | 通过 `onError` 上报索引或检索失败；没有回调时退回 `console.warn`                                                                            |
| `model`                              | getter，返回 `{ model, dimensions, namespace }`；没有 Provider 时返回 `undefined`                                                           |

不传 Provider（`new VectorIndex(db, undefined, source)`）时，所有会访问数据库的方法都退化为空操作——`status()` 返回全零、`embedQuery()` 返回 `null`，也不会创建或更新任何索引行——业务因此可以只使用全文检索。文档索引始终使用 `purpose: 'document'`；某批失败时，只把这些行标记为 `failed` 并记录错误文本，同时通过 `onError`（或 `console.warn`）上报。

### `vector.cache` 与 `vector.entries`

| 表               | 保存内容                                                                             | 主键                          |
| ---------------- | ------------------------------------------------------------------------------------ | ----------------------------- |
| `vector.cache`   | `key`、`profile`（标识）、`purpose`、`content`、`embedding`                          | `key`                         |
| `vector.entries` | `namespace`、`chunkId`、`model`（标识）、`dimensions`、`cacheKey`、`status`、`error` | `(namespace, chunkId, model)` |

`vector.entries.cacheKey` 外键指向 `vector.cache.key`，并有检查约束保证只有 `ready` 的行才带缓存键。共用一份缓存不会扩大业务的查询权限：每次索引查询都按该索引自己的 `namespace` 与标识过滤，业务之间复用向量，但不会读到对方的索引行。`prepare()` 只删除自己范围内的索引行——其他业务仍可复用的缓存行会保留。

## 生命周期

- 构造函数会调用 `storage.require(vectorStorage)`，因此对着未注册该模块的 `Storage` 创建 `VectorService` 会立即失败。
- `close()` 标记服务已关闭，然后等待它启动的进行中计算（对 pending Promise 执行 `Promise.allSettled`）。之后的调用会以 `VectorService 已关闭` 拒绝。
- **关闭服务不会关闭 `Storage`。** 数据库是借来的，由宿主最后关闭，详见 [@cieljs/storage](../storage/README.zh-CN.md#借用与生命周期)。

## API 参考

| 导出            | 类型            | 说明                                                                                                                                                        |
| --------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VectorService` | class           | 构造函数接收 `VectorOptions`；字段 `model`、`dimensions`、`batchSize`、`options`；方法 `key()`、`embed()`、`embedBatch()`、`close()`、`Symbol.asyncDispose` |
| `VectorOptions` | type            | `{ storage, provider, providerId, revision, granularity, inputConfig }`                                                                                     |
| `VectorIndex`   | class           | 构造函数 `(db, provider \| undefined, source, onError?)`；方法见上表                                                                                        |
| `VectorSource`  | type            | `{ namespace, table, id, content, condition? }`                                                                                                             |
| `vectorCache`   | Drizzle table   | `vector.cache`                                                                                                                                              |
| `vectorEntries` | Drizzle table   | `vector.entries`                                                                                                                                            |
| `vectorStorage` | `StorageModule` | `id: 'vector'`，迁移 `0001`，创建两张表、检查约束与 `entries_jobs` 索引                                                                                     |

## 设计取舍

`VectorService.model` 与 `vector.entries.model` 保存的是标识的 SHA-256，而不是 Provider 的模型名，这样配置可校验，又不会泄露端点细节。`purpose` 把检索的两侧分开：同一文本作为 query 与作为 document 可以是两个不同的向量，而只有实际计算过的那一个才进缓存。

缓存是协作点。进程内的合并避免同一实例重复计算，数据库表则让结果跨重启存活、并在多个实例之间共享。取消是按等待者来的——共享计算没有唯一归属，中断一个等待者不应该拆掉其他人正在等的计算。索引行与缓存行的归属不同：索引状态按 namespace 与标识划分，所以换模型或换维数只会产生一批新的 pending 行。

## 开发

```bash
vp install      # 拉取代码后执行
vp check        # 格式化、lint 与类型检查
vp test --run   # 单元测试
vp run build    # 构建本包
```

测试位于 `src/service.test.ts`，覆盖缓存对 provider、revision、granularity、inputConfig、模型名与维数的隔离，并发与批内去重，跨实例复用，单个等待者取消，以及失败后的重试。`packages/vector/package.json` 没有 `scripts`，`build`（`vp pack`）与 `test` 任务来自 `vite.config.ts` 的 `run.tasks`，因此需要用 `vp run` 调用。
