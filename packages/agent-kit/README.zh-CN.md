<h1 align="center">@cieljs/agent-kit</h1>

<p align="center">Prompt 模板工具、基于 TypeBox 的工具定义，以及运行时事件协议。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概念">概念</a> ·
  <a href="#prompt-模板">Prompt 模板</a> ·
  <a href="#定义工具">定义工具</a> ·
  <a href="#运行时协议">运行时协议</a> ·
  <a href="#api-参考">API 参考</a>
</p>

`@cieljs/agent-kit` 是每个 Ciel Agent 之下的那层共享基础设施：它负责生成不受模板缩进干扰的提示词字符串，把 TypeBox 参数 Schema 与工具工厂绑定，并为工具作者提供一个整理好的执行上下文，而不是 Pi Agent 原始的多个位置参数。

第二个入口 `@cieljs/agent-kit/protocol` 承载运行时、存储与 Trace 之间交换的词汇：Agent 事件、运行时记录信封，以及读写端口。

> [!NOTE]
> Embedding 契约与向量校验已迁移到 [`@cieljs/model-kit`](../model-kit/README.zh-CN.md)。仍从本包导入 `EmbeddingProvider`、`resolveEmbeddingProvider` 或 `assertEmbeddingVectors` 的调用方应更新 import 与 workspace 依赖。

## 概念

| 概念        | 导出                         | 职责                                             |
| ----------- | ---------------------------- | ------------------------------------------------ |
| Prompt 模板 | `prompt`                     | 保留转义并整理缩进的标签模板                     |
| 工具定义    | `defineTool()`               | 把 TypeBox Schema 与工具工厂绑定                 |
| 执行上下文  | `ToolExecuteContext`         | 统一的 `toolCallId` / `signal` / `onUpdate` 交接 |
| 运行时协议  | `@cieljs/agent-kit/protocol` | 运行时、存储与 Trace 共用的事件与记录类型        |

## 安装

`@cieljs/agent-kit` 属于 Ciel monorepo，通过 workspace 使用：

```bash
pnpm add @cieljs/agent-kit
```

工具 Schema 使用 TypeBox 编写，因此 `typebox` 是本包的直接依赖。`defineTool()` 产出的工具就是普通的 Pi Agent 工具，由 [`@cieljs/runtime`](../runtime/README.zh-CN.md)、[`@cieljs/session`](../session/README.zh-CN.md) 和 [`@cieljs/memory`](../memory/README.zh-CN.md) 消费。

## 快速开始

```ts
import { defineTool, prompt } from '@cieljs/agent-kit';
import { Type } from 'typebox';

const systemPrompt = prompt.dedent`
  You are Ciel, a patient assistant.
  Answer briefly and accurately.
`;

const searchMemory = defineTool(
  Type.Object({ query: Type.String({ minLength: 1 }) }),
  (search: (query: string) => Promise<string>) => ({
    name: 'search_memory',
    label: 'Search memory',
    description: prompt.inline`
      Search long-term memory
      for facts that answer the query.
    `,
    async execute({ query }, { toolCallId, signal, onUpdate }) {
      signal?.throwIfAborted();

      onUpdate?.({
        content: [{ type: 'text', text: `searching for "${query}" (${toolCallId})` }],
        details: { query },
      });

      return {
        content: [{ type: 'text', text: await search(query) }],
        details: { query },
      };
    },
  }),
);

// 调用工厂得到普通的 AgentTool。
const tools = [searchMemory(async query => `no hits for ${query}`)];
```

## Prompt 模板

`prompt` 基于 `String.raw`，是可调用的标签模板，因此模板里的转义序列会原样保留。它另外提供三个标签，对应三种常见的提示词整理方式：

| 标签            | 行为                                           |
| --------------- | ---------------------------------------------- |
| `prompt`        | 返回原始模板字符串，保留转义                   |
| `prompt.trim`   | 在原始字符串上去除首尾空白                     |
| `prompt.dedent` | 先裁剪首尾空白，再移除所有非空行共有的最小缩进 |
| `prompt.inline` | 先裁剪首尾空白，再把连续空白折叠为单个空格     |

```ts
import { prompt } from '@cieljs/agent-kit';

const systemPrompt = prompt.dedent`
  You are a patient assistant.
  Answer briefly and accurately.
`;

const description = prompt.inline`
  Search the history of the current session
  for messages related to the query.
`;

// Windows 路径与正则表达式不会被吞掉，因为转义是原样保留的。
const paths = prompt`C:\ciel\storage`;
```

`dedent` 按字符数计算缩进：它收集每个非空行开头的 `[ \t]*`，取其中最小的长度，再从每一行切掉这么多字符。只有空白字符的行不参与这个最小值的计算。

## 定义工具

`defineTool()` 接收参数 Schema 与工厂函数，返回一个形状相同的工厂，调用后得到完整的 `AgentTool`。

```ts
import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

const createSearchTool = defineTool(
  Type.Object({ query: Type.String() }),
  (search: (query: string) => Promise<string>) => ({
    name: 'search',
    label: 'Search',
    description: 'Search related content',
    async execute({ query }, { signal }) {
      signal?.throwIfAborted();

      return {
        content: [{ type: 'text', text: await search(query) }],
        details: { query },
      };
    },
  }),
);
```

签名如下：

```ts
function defineTool<
  TDetails = unknown,
  TArgs extends unknown[] = unknown[],
  TParameters extends TSchema = TSchema,
>(
  parameters: TParameters,
  factory: (...args: TArgs) => ToolDefinition<TParameters, TDetails>,
): (...args: TArgs) => AgentTool<TParameters, TDetails>;
```

- `TParameters` 从 Schema 参数推导，`execute` 因此直接拿到 `Static<TParameters>`，工厂里不必重复写 Schema。
- `TDetails` 决定工具结果中结构化 `details` 字段的类型，`onUpdate` 的类型是 `AgentToolUpdateCallback<TDetails>`。
- `TArgs` 从工厂参数推导，需要宿主依赖的工具通过调用返回的工厂获取依赖：`createSearchTool(search)`。

`ToolDefinition` 是工厂的契约：除 `parameters` 与 `execute` 之外的 `AgentTool` 全部字段，加上一个已经接收到整理后上下文的 `execute`。

## 工具执行上下文

Pi Agent 以 `execute(toolCallId, params, signal, onUpdate)` 调用工具，`defineTool()` 把它整理成一个对象：

```ts
interface ToolExecuteContext<TDetails = unknown> {
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<TDetails>;
}
```

| 字段         | 用途                                                              |
| ------------ | ----------------------------------------------------------------- |
| `toolCallId` | 当前工具调用的标识，用于日志、Trace 以及关联流式更新              |
| `signal`     | 当前运行的取消信号，异步工作中可以调用 `signal?.throwIfAborted()` |
| `onUpdate`   | 为本次调用推送部分结果，Promise 结束后的调用会被忽略              |

失败时直接抛出异常——Agent 运行时会把它转成给模型的错误输出，因此不要把错误手工编码进 `content`。

## 运行时协议

`@cieljs/agent-kit/protocol` 重新导出 Pi Agent 的 `AgentEvent` 与 `AgentMessage` 类型，并补充宿主自己的记录信封。

```ts
import type {
  RuntimeEvent,
  RuntimeReader,
  RuntimeRecord,
  RuntimeWriter,
  SessionCompactionEvent,
} from '@cieljs/agent-kit/protocol';
```

| 类型                     | 形状                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RuntimeMetadata`        | `{ tools?, model?, parentRunId? }`，记录生成时生效的工具与模型                                                                                 |
| `SessionCompactionEvent` | `{ type: 'session_compaction', summary, throughSeq, createdAt, contextTokens? }`                                                               |
| `RuntimeEvent`           | `AgentEvent \| SessionCompactionEvent`                                                                                                         |
| `RuntimeRecord`          | `version: 1`、`id`、`sequence`、`sessionId`、`runId`、`turnId?`、`messageId?`、`toolCallId?`、`parentRunId?`、`timestamp`、`event`、`metadata` |
| `RuntimeReader`          | `read(after?, limit?)` 与 `subscribe(listener)`                                                                                                |
| `RuntimeWriter`          | `record(sessionId, event, metadata?)` 与 `flush()`                                                                                             |

`.contextTokens` 是压缩后的上下文估算（摘要加保留的原文），供 [`@cieljs/trace`](../trace/README.md) 等消费者立即更新「当前上下文」；旧记录可能没有这个字段。它不含系统提示与工具定义开销。

> [!NOTE]
> `RuntimeReader.subscribe()` 只是唤醒信号。消费者应按持久化游标读取事件，而不是把通知本身当作事件内容，这样断线也不会丢事件。

## API 参考

`@cieljs/agent-kit`

| 导出                              | 种类      | 说明                                                   |
| --------------------------------- | --------- | ------------------------------------------------------ |
| `prompt`                          | const     | 可调用的标签模板，带 `trim`、`dedent`、`inline` 方法   |
| `prompt.trim`                     | 模板      | 去除首尾空白后的原始字符串                             |
| `prompt.dedent`                   | 模板      | 裁剪首尾空白并移除公共最小缩进                         |
| `prompt.inline`                   | 模板      | 裁剪首尾空白并把连续空白折叠为单个空格                 |
| `defineTool(parameters, factory)` | function  | 绑定 TypeBox Schema 与工具工厂，返回 `AgentTool` 工厂  |
| `ToolExecuteContext<TDetails>`    | interface | 传给 `execute` 的 `{ toolCallId, signal?, onUpdate? }` |

`@cieljs/agent-kit/protocol`

| 导出                         | 种类      | 说明                                        |
| ---------------------------- | --------- | ------------------------------------------- |
| `AgentEvent`、`AgentMessage` | type      | 从 `@earendil-works/pi-agent-core` 重新导出 |
| `RuntimeMetadata`            | interface | 附加在记录上的工具、模型与父运行信息        |
| `SessionCompactionEvent`     | interface | 与 Agent 事件共用同一条事实流水的压缩事件   |
| `RuntimeEvent`               | type      | `AgentEvent \| SessionCompactionEvent`      |
| `RuntimeRecord`              | interface | 由 `RuntimeWriter` 写入的持久化记录         |
| `RuntimeReader`              | interface | 按游标读取，外加唤醒式订阅                  |
| `RuntimeWriter`              | interface | 追加记录并刷新                              |

## 设计取舍

转义保持原样：`prompt` 建立在 `String.raw` 之上，因为提示词里经常出现反斜杠和类似模板的文本，它们必须原封不动地送到模型。整理是显式选择的，三个小标签覆盖全部需求：`dedent` 用于多行系统提示，`inline` 用于模型当作元数据阅读的单行工具描述。

Schema 只有一处：`defineTool()` 以 `parameters` 作为第一个参数并覆写定义中的 `parameters`，工厂不可能与校验它的 Schema 产生偏离。工具作者拿到的是一个上下文对象，不必记住 Pi Agent `execute` 参数的位置顺序，工具也可以先于承载它的运行时写好。`./protocol` 入口只有类型、没有运行时代码，因此存储与 Trace 可以依赖这套词汇，而不必引入 Agent 执行逻辑。

## 开发

在本包目录运行：

```bash
vp check
vp run build
```

本包当前没有测试文件，因此它的 `test` 任务配置为 `vp test --passWithNoTests`。这里构建的工具由 [`@cieljs/runtime`](../runtime/README.zh-CN.md) 的测试覆盖。
