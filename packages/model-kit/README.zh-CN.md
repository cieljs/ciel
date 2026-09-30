<h1 align="center">@cieljs/model-kit</h1>

<p align="center">模型能力契约：Embedding Provider、向量校验，以及独立的模型注册入口。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概念">概念</a> ·
  <a href="#embedding-契约">Embedding 契约</a> ·
  <a href="#查询与文档">查询与文档</a> ·
  <a href="#模型注册表">模型注册表</a> ·
  <a href="#api-参考">API 参考</a>
</p>

`@cieljs/model-kit` 描述一个模型必须具备什么能力，而不依赖 Agent、存储或具体推理运行时。当前它提供 Embedding 类型、默认值与向量校验；后续 TTS 等能力可以在此按独立模块定义，不提前约束具体供应商。

Qwen 的推理实现仍位于 [`@cieljs/embed`](../embed/README.zh-CN.md)，相关资源由应用创建与释放。

Embedding 契约从 `@cieljs/agent-kit` 迁移到这里：请更新 import 并添加 workspace 依赖。

## 概念

| 概念               | 导出                        | 职责                                                 |
| ------------------ | --------------------------- | ---------------------------------------------------- |
| Embedding Provider | `EmbeddingProvider`         | Adapter 必须提供的能力：模型标识、维数与批量向量     |
| 已解析 Provider    | `ResolvedEmbeddingProvider` | 校验之后的 Provider，`batchSize` 与 `embed` 都有保证 |
| 用途               | `EmbeddingOptions.purpose`  | `'query'` 或 `'document'`，供模型选择前缀或任务类型  |
| 模型注册表         | `@cieljs/model-kit/models`  | 基于 `@earendil-works/pi-ai` 构建的供应商与模型目录  |

## 安装

`@cieljs/model-kit` 属于 Ciel monorepo，通过 workspace 使用：

```bash
pnpm add @cieljs/model-kit
```

[`@cieljs/embed`](../embed/README.zh-CN.md) 是满足该契约的推理实现。[`@cieljs/vector`](../vector/README.md)、[`@cieljs/memory`](../memory/README.md) 和 [`@cieljs/session`](../session/README.zh-CN.md) 都以这套契约作为输入。

## 快速开始

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
    // 返回顺序必须与输入文本一致。
    return texts.map(text => [text.length, purpose === 'query' ? 1 : 0, 0.5]);
  },
};

// 校验在这里发生；返回结果一定有 batchSize 与 embed。
const embedding = resolveEmbeddingProvider(provider)!;

const query = await embedding.embed('怎么保存长期记忆？', { purpose: 'query' });
const documents = await embedding.embedBatch(['长期记忆按空间隔离。'], {
  purpose: 'document',
});

assertEmbeddingVectors(documents, 1, embedding.dimensions);
```

## Embedding 契约

```ts
interface EmbeddingOptions {
  /** 区分检索查询与待索引文档，供模型选择前缀或任务类型。 */
  purpose: 'query' | 'document';
  signal?: AbortSignal;
}

interface EmbeddingProvider {
  /** 模型标识；更换模型或版本时必须同步更新。 */
  readonly model: string;
  /** 输出向量维数。 */
  readonly dimensions: number;
  /** 单次索引请求的最大文本数，默认 32。 */
  readonly batchSize?: number;
  /** 生成单个文本的向量；省略时由 `embedBatch` 自动实现。 */
  embed?(text: string, options: EmbeddingOptions): Promise<number[]>;
  /** 返回顺序必须与输入一致；查询也使用单元素数组。 */
  embedBatch(texts: string[], options: EmbeddingOptions): Promise<number[][]>;
}

interface ResolvedEmbeddingProvider extends EmbeddingProvider {
  readonly batchSize: number;
  embed(text: string, options: EmbeddingOptions): Promise<number[]>;
}
```

`resolveEmbeddingProvider(provider)` 是不可信 Adapter 与 Ciel 其余部分之间的边界：

- 传入 `undefined` 就返回 `undefined`，可选配置可以原样透传。
- 配置由 `assertEmbeddingProvider()` 校验，因此非法 Provider 在这里就抛错，而不是等到第一次索引请求。
- `batchSize` 缺省时补成 `DEFAULT_EMBEDDING_BATCH_SIZE`。
- `embed` 一定有：优先使用 Provider 自己的 `embed` 并校验它只返回一个向量；否则调用 `embedBatch([text])` 取其第一个向量。
- `embedBatch` 通过 Provider 本身调用，因此依赖 `this` 的 Adapter 仍然可用。

## 校验与默认值

| 导出                           | 值      | 含义                                   |
| ------------------------------ | ------- | -------------------------------------- |
| `DEFAULT_EMBEDDING_BATCH_SIZE` | `32`    | Provider 未提供 `batchSize` 时的默认值 |
| `MAX_EMBEDDING_BATCH_SIZE`     | `1000`  | `batchSize` 的上限                     |
| `MAX_EMBEDDING_DIMENSIONS`     | `16000` | `dimensions` 的上限                    |

`assertEmbeddingProvider(provider)` 会拒绝空的或只有空白的 `model`、不是 `1` 到 `16000` 之间安全整数的 `dimensions`，以及不是 `1` 到 `1000` 之间安全整数的 `batchSize`。这些都抛出 `TypeError`。

`assertEmbeddingVectors(vectors, expectedCount, dimensions)` 是一个断言函数（`asserts vectors is number[][]`），用于检查模型实际返回的形状：

| 检查项   | 在什么情况下被拒绝                           |
| -------- | -------------------------------------------- |
| 数量     | 不是数组，或长度与 `expectedCount` 不一致    |
| 维数     | 某一项不是数组，或长度与 `dimensions` 不一致 |
| 有限数值 | 某一项包含非数值或非有限数值                 |
| 非零向量 | 某一项的全部数值都是 0                       |

错误信息为中文，例如 `Embedding 模型标识不能为空`、`Embedding 维数必须是 1 到 16000 的整数` 和 `Embedding 向量必须是非零向量`。

## 查询与文档

每次 Embedding 调用都必须给出 `purpose`，两个取值含义不同：

| `purpose`    | 含义             | Adapter 的典型处理                 |
| ------------ | ---------------- | ---------------------------------- |
| `'query'`    | 检索时发出的查询 | 可以加上任务说明或使用查询专用提示 |
| `'document'` | 即将被索引的文档 | 通常原样编码                       |

本包不会改写文本本身：把 `purpose` 映射为说明、前缀或任务类型是 Adapter 的职责——具体映射见 [`@cieljs/embed`](../embed/README.zh-CN.md)。

每次调用都适用两条规则：

- **顺序是契约的一部分。** `embedBatch()` 返回的向量顺序必须与输入文本一致，单条查询也以单元素数组传入，而不是特殊分支。
- **`model` 标识向量空间。** 不同模型或版本产生的向量即使维数相同也不能互相比较，因此模型变化时 `model` 必须同步变化。

## 模型注册表

`@cieljs/model-kit/models` 在 `@earendil-works/pi-ai` 之上构建供应商与模型目录：

```ts
import { models } from '@cieljs/model-kit/models';

const model = models.getModel('xiaomi', 'mimo-v2.5');
```

`getModel(provider, id)` 是对最近一次已知目录的同步查询；供应商或模型 ID 未知时返回 `undefined`。

导入该入口本身带副作用：它会创建集合并注册全部供应商。

| 注册项     | 内容                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Xiaomi     | id 为 `xiaomi`，Base URL 为 `https://api.xiaomimimo.com/v1`，API 为 `openai-completions`，凭据取自 `XIAOMI_API_KEY` 环境变量 |
| 内置供应商 | `@earendil-works/pi-ai` 的 `builtinProviders()` 返回的全部供应商                                                             |

Xiaomi 目录中包含 `mimo-v2.5`：

| 字段               | 值                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `name`             | `MiMo-V2.5`                                                                                                     |
| `input`            | `['text', 'image']`                                                                                             |
| `reasoning`        | `true`                                                                                                          |
| `contextWindow`    | `262144`                                                                                                        |
| `maxTokens`        | `131072`                                                                                                        |
| `cost`             | `{ input: 0.4, output: 2, cacheRead: 0, cacheWrite: 0 }`                                                        |
| `thinkingLevelMap` | `off: 'none'`、`minimal: null`、`low: 'low'`、`medium: 'medium'`、`high: 'high'`、`xhigh: 'xhigh'`、`max: null` |
| `compat`           | `{ supportsDeveloperRole: false }`                                                                              |

## API 参考

`@cieljs/model-kit`

| 导出                                                         | 种类      | 说明                                                                                    |
| ------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------- |
| `DEFAULT_EMBEDDING_BATCH_SIZE`                               | const     | `32`，Provider 未提供 `batchSize` 时使用                                                |
| `MAX_EMBEDDING_BATCH_SIZE`                                   | const     | `1000`                                                                                  |
| `MAX_EMBEDDING_DIMENSIONS`                                   | const     | `16000`                                                                                 |
| `EmbeddingOptions`                                           | interface | `{ purpose: 'query' \| 'document'; signal?: AbortSignal }`                              |
| `EmbeddingProvider`                                          | interface | Adapter 契约：`model`、`dimensions`、可选的 `batchSize` 与 `embed`、必需的 `embedBatch` |
| `ResolvedEmbeddingProvider`                                  | interface | 保证具备 `batchSize: number` 与 `embed` 的 Provider                                     |
| `resolveEmbeddingProvider(provider)`                         | function  | 校验、补齐默认值并保证 `embed`；`undefined` 仍返回 `undefined`                          |
| `assertEmbeddingProvider(provider)`                          | function  | 校验模型标识、维数与批量大小                                                            |
| `assertEmbeddingVectors(vectors, expectedCount, dimensions)` | function  | 校验数量、维数、有限数值与非零向量                                                      |

`@cieljs/model-kit/models`

该入口只导出一个值 `models`；下表中的是它提供的成员，来自 `@earendil-works/pi-ai` 的 `MutableModels` 集合。

| 导出                                                                                     | 种类   | 说明                                                        |
| ---------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `models`                                                                                 | const  | 已注册 Xiaomi 供应商与全部内置供应商的 `MutableModels` 集合 |
| `models.getModel(provider, id)`                                                          | method | 同步查询模型；返回 `Model<Api> \| undefined`                |
| `models.getProviders()` / `getProvider(id)` / `getModels(provider?)`                     | method | 查看已注册的供应商与模型                                    |
| `models.setProvider(provider)` / `deleteProvider(id)` / `clearProviders()`               | method | 修改集合                                                    |
| `models.stream()` / `complete()` / `streamSimple()` / `completeSimple()`                 | method | 通过拥有该模型的供应商发起请求，并自动应用鉴权              |
| `models.getAvailable()` / `checkAuth(id)` / `getAuth(...)` / `login(...)` / `logout(id)` | method | 结合凭据判断可用模型与登录流程                              |
| `models.refresh(options?)`                                                               | method | 刷新已配置的动态供应商目录                                  |

## 设计取舍

根入口在运行时什么都不依赖——不依赖 Agent，也不依赖数据库或推理栈——所以各层可以共享这些类型而不必拖入实现。`resolveEmbeddingProvider()` 接受可选的 Provider，`undefined` 进就 `undefined` 出，可选配置代码因此不必写空值判断。校验集中在一个边界上：Adapter 就是普通 JavaScript，可以返回任何东西，`assertEmbeddingVectors()` 是向量进入存储之前的唯一检查点，而配置与向量问题都会以 `TypeError` 离开，不会被悄悄修正。

注册表是刻意做成独立入口的。`src/index.ts` 只重新导出 Embedding 模块，`src/models/index.ts` 才创建注册表并注册 Xiaomi 供应商与全部内置供应商。两者分开意味着只需要 Embedding 契约的消费者（例如 [`@cieljs/vector`](../vector/README.zh-CN.md)）不必为初始化供应商目录和加载它的数据付出代价。

## 开发

在本包目录运行：

```bash
vp check
vp test --run
vp run build
```

`tests/embedding.test.ts` 使用替身 Provider 覆盖解析器、默认批量大小、`this` 保持、非法配置与向量校验，不需要模型服务。
