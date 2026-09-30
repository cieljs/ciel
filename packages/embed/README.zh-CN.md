<h1 align="center">@cieljs/embed</h1>

<p align="center">在 Node.js 中运行 Qwen3 Embedding，为检索查询与文档生成本地向量。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概念">概念</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#选项">选项</a> ·
  <a href="#模型下载与缓存">下载与缓存</a> ·
  <a href="#api-参考">API 参考</a>
</p>

`@cieljs/embed` 基于 Transformers.js 加载 `onnx-community/Qwen3-Embedding-0.6B-ONNX`，并实现 [`@cieljs/model-kit`](../model-kit/README.zh-CN.md) 的 `ResolvedEmbeddingProvider` 契约。模型按需加载，同一个 Provider 会复用已经创建的推理管线。模型文件默认从 ModelScope 的同名仓库下载，沿用原有本地缓存；下载失败后，下次调用会重新尝试加载。

## 概念

| 概念               | 含义                                                                           |
| ------------------ | ------------------------------------------------------------------------------ |
| Embedding Provider | `qwen()` 返回的对象：`model`、`dimensions`、`batchSize`、`embed`、`embedBatch` |
| 用途               | `'query'` 会加上检索任务说明，`'document'` 按原文编码                          |
| Pooling            | 由 Transformers.js 管线完成的 last-token pooling 与归一化                      |
| MRL 截断           | 把 1024 维输出截断到 `dimensions`，然后重新归一化                              |

## 安装

`@cieljs/embed` 属于 Ciel monorepo，通过 workspace 使用：

```bash
pnpm add @cieljs/embed
```

它依赖 `@huggingface/transformers` 做推理，依赖 [`@cieljs/model-kit`](../model-kit/README.zh-CN.md) 提供 Embedding 契约与校验。这里产出的向量可以交给 [`@cieljs/vector`](../vector/README.md)，再由它服务于 [`@cieljs/memory`](../memory/README.md) 或 [`@cieljs/session`](../session/README.zh-CN.md) 的索引。

## 快速开始

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

查询文本会自动加入检索任务说明，文档文本保持原样。输出使用 last-token pooling 并进行归一化，可以直接交给 `@cieljs/memory` 或 `@cieljs/session`。

## 选项

`qwen(options)` 必须传入配置对象：

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

| 选项          | 类型                       | 默认值                           | 说明                                                     |
| ------------- | -------------------------- | -------------------------------- | -------------------------------------------------------- |
| `cacheDir`    | `string`                   | 必填，无默认值                   | Transformers.js 模型缓存目录；相对路径相对于当前工作目录 |
| `dimensions`  | `number`                   | `1024`                           | 输出维数，支持 1 到 1024 维的 MRL 截断                   |
| `batchSize`   | `number`                   | `32`                             | 单次推理允许的最大文本数量，校验范围 `1`–`1000`          |
| `dtype`       | `'fp32' \| 'fp16' \| 'q8'` | `'q8'`                           | ONNX 权重精度                                            |
| `device`      | `'wasm' \| 'webgpu'`       | Transformers.js 默认值           | 推理设备，省略时由运行时决定                             |
| `instruction` | `string`                   | `DEFAULT_QWEN_QUERY_INSTRUCTION` | 检索任务说明，仅用于 `purpose: 'query'`                  |

非法配置在调用 `qwen()` 时就失败，而不是等到第一次生成向量：

- `dimensions` 必须是 `1` 到 `1024` 之间的安全整数，否则抛出 `TypeError: Qwen Embedding dimensions 必须是 1 到 1024 的整数`。
- `batchSize` 由 `resolveEmbeddingProvider()` 校验，超出 `1`–`1000` 会被拒绝。

## 模型下载与缓存

模型文件来自 ModelScope。包在导入时会重定向且仅重定向一个 URL 前缀：

```text
https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/main/…
→ https://modelscope.cn/models/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/master/…
```

- 只有这个模型的请求会被重定向；其他下载保持 Transformers.js 的原有行为。
- 重定向请求会去掉 `authorization` 头，Hugging Face 凭据不会被转发；其他请求头原样保留。
- 请求路径没有变化，因此 Transformers.js 计算出的缓存键不变，原有的本地缓存可以继续沿用。
- 推理管线在第一次非空 `embedBatch()` 调用时创建，并缓存在 Provider 内部。加载失败会清掉缓存的 Promise，因此下次调用会重试，而一次成功的加载会被并发的调用方共享。
- `embedBatch([])` 直接返回 `[]`，完全不会加载模型。
- Provider 没有提供释放接口：已加载的 ONNX 会话随 Provider 实例保留以便复用。

## 向量后处理

推理之前会按用途格式化文本：

| `purpose`    | 送给模型的文本                                  |
| ------------ | ----------------------------------------------- |
| `'document'` | 原文不变                                        |
| `'query'`    | `` `Instruct: ${instruction}\nQuery:${text}` `` |

推理使用 `pooling: 'last_token'` 与 `normalize: true`，因此返回的向量已经归一化。

当 `dimensions` 等于 `QWEN_EMBEDDING_DIMENSIONS`（1024）时直接返回输出。否则每个向量会被截断到前 `dimensions` 个数值并重新归一化，使较短的向量仍然可以做余弦相似度比较；范数为 0 时保持原样，不会产生 `NaN`。

> [!NOTE]
> 在当前版本中，截断分支在返回之前还会用 `console.log` 打印截断后的向量。

## 取消

每次生成向量都可以在配置对象里传入 `signal`，Provider 会在三个位置检查它：加载模型之前、模型就绪之后，以及推理产出结果之后。

```ts
const controller = new AbortController();

const vectors = await embedding.embedBatch(['要索引的文档'], {
  purpose: 'document',
  signal: controller.signal,
});
```

> [!WARNING]
> 已经开始的模型加载不会被强制中断：信号没有传给 Transformers.js，检查发生在加载结束之后。`embedBatch([])` 也会在第一次检查之前就返回。

## API 参考

`@cieljs/embed`

| 导出                                | 种类     | 说明                                                                            |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `qwen(options)`                     | function | 创建基于本地 Transformers.js 管线的 `ResolvedEmbeddingProvider`                 |
| `QWEN_EMBEDDING_MODEL`              | const    | `'Qwen3-Embedding-0.6B'`，作为 Provider 的 `model` 上报                         |
| `QWEN_EMBEDDING_SOURCE`             | const    | `'onnx-community/Qwen3-Embedding-0.6B-ONNX'`                                    |
| `QWEN_EMBEDDING_DIMENSIONS`         | const    | `1024`，模型的原始输出维数                                                      |
| `DEFAULT_QWEN_EMBEDDING_BATCH_SIZE` | const    | `32`                                                                            |
| `DEFAULT_QWEN_QUERY_INSTRUCTION`    | const    | `'Given a retrieval query, retrieve relevant documents that answer the query.'` |
| `QwenEmbeddingOptions`              | type     | `{ cacheDir, dimensions?, batchSize?, dtype?, device?, instruction? }`          |
| `QwenEmbeddingDType`                | type     | `'fp32' \| 'fp16' \| 'q8'`                                                      |
| `QwenEmbeddingDevice`               | type     | `'wasm' \| 'webgpu'`                                                            |

返回的 Provider 同时带有 [`@cieljs/model-kit`](../model-kit/README.zh-CN.md) 契约中的成员：

| 成员           | 说明                                                   |
| -------------- | ------------------------------------------------------ |
| `model`        | `QWEN_EMBEDDING_MODEL`                                 |
| `dimensions`   | 解析后的 `dimensions` 选项                             |
| `batchSize`    | 解析后的 `batchSize` 选项                              |
| `embed()`      | 由 `resolveEmbeddingProvider()` 基于 `embedBatch` 实现 |
| `embedBatch()` | 格式化文本、执行一次推理，并按输入顺序返回向量         |

## 设计取舍

推理是本地完成的：模型通过 Transformers.js 在进程内运行，缓存之后既不需要 Embedding API Key，也没有额外的网络往返。管线 Promise 缓存在闭包里，反复调用 `embed()` 代价很低，并发调用者也共享同一次加载；加载被拒绝时会清掉这个缓存的 Promise，而不是让 Provider 永久失效，网络或缓存恢复后下一次调用就能成功。

下载默认走 ModelScope。两个站点的仓库路径完全一致，所以只重定向这一个前缀，既保持缓存键稳定，又能使用本包目标地区可达的下载源。

用途是显式的：Adapter 把 `purpose: 'query'` 映射为 Qwen 的说明格式，文档保持原样，与 [`@cieljs/model-kit`](../model-kit/README.zh-CN.md) 契约的要求一致。截断发生在归一化之前，因为截断会改变向量长度，而未归一化的短向量之间无法比较。

## 开发

在本包目录运行：

```bash
vp check
vp test --run
vp run build
```

单元测试用推理管线替身替换真实管线，并 mock 下载使用的 fetch，因此不会下载模型，也不需要网络。测试覆盖默认值、MRL 输出维数、ModelScope 重定向、凭据剥离、加载重试、缓存目录透传与维数校验。
