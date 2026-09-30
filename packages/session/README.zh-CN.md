<h1 align="center">@cieljs/session</h1>

<p align="center">让 Agent 记得聊过什么，上下文装不下时能压缩，也始终能找回当时的原话。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概念">概念</a> ·
  <a href="#上下文与压缩">上下文与压缩</a> ·
  <a href="#检索">检索</a> ·
  <a href="#agent-tools">Agent Tools</a> ·
  <a href="#api-参考">API 参考</a>
</p>

一段对话聊久了，会留下许多值得记住的东西：最初的目标、几次讨论后的决定，还有那些说好稍后再做的事。下一次打开会话时，我们希望能接着聊；上下文装不下时，也希望重要的信息能留下来。

`@cieljs/session` 为这些内容提供一个本地的存放处。它用 PGlite 保存完整消息，用递归摘要整理较早的对话，再通过历史检索把需要的细节找回来。

一个 `spaceId` 表示稳定的业务空间，例如某个直播间；同一空间可以包含多段 Session。`sources` 保存主播昵称、房间标题和其他可检索来源，不参与空间隔离。

## 概念

| 概念     | 存放位置                  | 职责                                   |
| -------- | ------------------------- | -------------------------------------- |
| Session  | 数据库中的消息记录        | 对话的事实流水，重新打开即可恢复上下文 |
| Space    | `spaceId` 命名空间        | 隔离边界，一个空间包含多段 Session     |
| Sources  | 每段 Session 的可检索标签 | 用于发现会话的业务标识，不参与隔离     |
| 压缩     | `session_compaction` 记录 | 累计摘要及其覆盖到的边界               |
| 检索索引 | 派生的切块与向量          | 对消息正文和来源做全文、模糊与向量检索 |

> [!NOTE]
> 压缩整理的是送给模型的上下文。原始消息仍留在数据库里，随时可以搜索和读取。

## 安装

`@cieljs/session` 属于 Ciel monorepo，通过 workspace 使用：

```bash
vp install
```

一段 Session 需要 `Storage` 实例；需要向量检索时，还要一个 [`@cieljs/vector`](../vector/README.zh-CN.md) 的 `VectorService`，并由 [`@cieljs/model-kit`](../model-kit/README.zh-CN.md) 定义的 `EmbeddingProvider` 提供向量。

## 快速开始

打开一个空间和一段 Session，写入消息，再取回它的当前上下文：

```ts
import { Storage } from '@cieljs/storage';
import { SessionManager, sessionStorage } from '@cieljs/session';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage],
});
const manager = await SessionManager.open({ storage, namespace: 'session' });
const space = manager.space('blive:room:21452505');

try {
  // ID 已存在时复用已有 Session，重新打开就是继续这段历史。
  const session = await space.session({
    id: 'conversation-1',
    sources: ['project:ciel', 'user:alice'],
  });

  await session.appendMessage({
    role: 'user',
    content: '我们决定用本地数据库保存会话。',
    timestamp: Date.now(),
  });

  const messages = await session.context();
  console.log(messages);
} finally {
  await manager.close();
}
```

`context()` 返回可直接交给 Agent 的 `AgentMessage[]`。存在累计摘要时，摘要会作为第一条历史消息，后面是它尚未覆盖的原文。再次使用相同的数据目录、空间 ID 和会话 ID，就可以继续读取这段历史。

消息完成后等待 `appendMessage()`；使用结束、停止提交新任务后再关闭存储。`close()` 会等待已排队的压缩和索引任务。

## 上下文与压缩

我们沿用 Pi 的方式判断上下文用量：优先读取最近有效的模型 usage，再估算后续新增消息。满足下面的条件时尝试压缩：

```text
contextTokens > contextWindow - reserveTokens
```

恰好等于阈值不触发压缩。

| 选项                 | 说明                                   | 默认值  |
| -------------------- | -------------------------------------- | ------- |
| `contextWindow`      | **对话模型**的上下文窗口，单位为 token | 必填    |
| `reserveTokens`      | 为后续生成预留的 token，必须小于窗口   | 16,384  |
| `keepRecentMessages` | 至少保留的最近原始消息条数             | 10      |
| `force`              | 跳过阈值检查，但仍遵守完整轮次边界     | `false` |
| `signal`             | 取消或超时信号                         | —       |

token 的计算方式是：

1. 从后向前找到最近一条有效 assistant usage，跳过错误、取消和全零用量。
2. 优先读取 `usage.totalTokens`；总量为零时使用 `input + output + cacheRead + cacheWrite`。
3. 只估算该消息之后新增的内容，再加到 usage 上。有效 usage 已覆盖的历史和摘要不会重复累计。
4. 没有有效 usage 时，估算最新摘要和全部未压缩消息。文本按每条消息的字符数除以 4 向上取整；thinking、工具名与 JSON 参数也计入；每张图片按 1,200 tokens 计入。

这与 Pi 一样，是「真实 usage + 尾部估算」，不是精确 tokenizer。字符估算在中文等内容上可能偏低；没有 usage 时也不包含存储层无法得知的系统提示和工具定义开销，应留出合适余量。

压缩后，保留消息中的 usage 可能仍反映压缩前的大上下文。Session 根据数据库写入时间排除这些旧 usage，先估算新摘要与保留消息，等压缩后产生新的有效 assistant usage 再使用真实用量。

### 递归摘要

```text
旧消息 A                  → 摘要 S1
S1 + 新增旧消息 B         → 摘要 S2
S2 + 新增旧消息 C         → 摘要 S3

当前上下文                = S3 + 最近保留的原文
```

每次只读取尚未被摘要覆盖的旧消息，并把上一份摘要传给模型，因此摘要是累积的，而不是每次重来。数据库保留历史摘要以便检查，`session.context()` 始终只包含最新摘要对应的历史消息。

摘要函数由调用方直接实现。服务地址、鉴权、模型、消息序列化和输出上限都由外部管理，Session 不调用模型，也不自动注入提示词。包导出 `DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT` 作为可选默认值。

```ts
import { DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT, type SessionSummarizer } from '@cieljs/session';

const summarize: SessionSummarizer = async ({ summary, messages, signal }) => {
  const response = await models.completeSimple(
    summaryModel,
    {
      systemPrompt: DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ summary, messages }),
          timestamp: Date.now(),
        },
      ],
    },
    { maxTokens: 2048, signal },
  );

  // 不使用失败或被截断的摘要替换历史。
  if (response.stopReason !== 'stop') {
    throw new Error(response.errorMessage ?? `摘要未完整生成：${response.stopReason}`);
  }

  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
};
```

在完整消息写入后调用 `session.compact()`：可以在开始下一个用户请求前，或一组工具结果写入完成、准备请求模型之前。SessionManager 不自行监听 Agent 事件；上层负责决定何时检查，以及如何把更新后的上下文交给模型。

```ts
const result = await session.compact({
  summarize,
  contextWindow: 128_000,
  reserveTokens: 16_384,
  keepRecentMessages: 10,
  signal: AbortSignal.timeout(60_000),
});

if (result) {
  console.log(await session.context());
}
```

返回 `null` 表示未超出预算或没有可以安全压缩的旧轮次。保留边界向前对齐到用户消息，避免拆开工具调用与结果，所以实际保留条数可能超过配置。单个超长轮次不会被截断，压缩也不保证结果一定低于预算。

一直没有触发时，先检查 `contextWindow`、`reserveTokens`，以及是否存在有效 usage——也可能全部消息本来就落在保留范围或同一轮次里。压缩后仍然接近上限，就看摘要长度和保留消息的大小，再调低摘要输出上限或 `keepRecentMessages`，并重新评估上层实际请求的预算。摘要模型报上下文过长是另一条独立的限制：它自身也要容纳旧摘要和本次待压缩的消息，主对话的预算并不保证它能接收同样内容。生成失败、摘要为空或被取消时，本次不会推进压缩边界，调用方收到错误、可以重试，原始历史仍然完整。同一会话的并发调用在同一个 Manager 内串行处理，写入前还会再检查一次摘要边界，因此生成期间被外部更新的摘要不会被覆盖。

每次压缩成功后都会向 `storage.events` 追加一条 `session_compaction` 事件，记录累计摘要与压缩边界；[`@cieljs/trace`](../trace/README.zh-CN.md) 等消费者重放流水就能看到这一步。

## 检索

`session.search(query, options)` 查询当前会话，`manager.searchAll(query, options)` 查询该 Manager 下的全部会话。两者都会融合全文与模糊匹配和向量匹配。

| 模式        | 行为                                 |
| ----------- | ------------------------------------ |
| `hybrid`    | 默认，融合所有可用检索方式           |
| `full_text` | 对消息正文做分词全文检索             |
| `trigram`   | 模糊子串匹配，对手写差错的措辞更宽容 |
| `vector`    | 语义检索，需要配置 `VectorService`   |

| 选项                  | 说明                         | 默认值 |
| --------------------- | ---------------------------- | ------ |
| `limit` / `offset`    | 分页读取结果                 | —      |
| `candidateLimit`      | 融合前每种模式取回的候选数量 | —      |
| `minVectorSimilarity` | 向量命中的最低余弦相似度     | 0.35   |
| `signal`              | 取消信号                     | —      |

命中结果包含 `spaceId`、匹配到的 `SessionMessage`、`excerpt`、`score` 以及产生它的 `matches`，宿主可以据此说明「为什么返回了这条」。

来源发现与来源全文检索使用同一个 tokenizer，支持中文多关键词查询。`manager.findSessionsBySource(query, options)` 把业务标识解析成会话，`mode` 可以是 `auto`、`exact` 或 `text`。更换 tokenizer 后需要重建索引，`rebuildIndexes()` 会同时重建正文与来源索引。

```ts
const hits = await manager.searchAll('会话保存在哪里', { mode: 'hybrid' });
const related = await manager.findSessionsBySource('主播昵称');
```

> [!TIP]
> 可以先从全文和模糊检索开始。确认需要语义检索时，再接入一个提供 `embedBatch()` 的 Embedding Provider。

### 向量与索引

Embedding Provider 由模型标识、输出维数和批量函数描述。模型标识应能区分服务商与版本：即使维数相同，不同模型生成的向量也不能混用。

| 配置         | 说明                         | 默认值 |
| ------------ | ---------------------------- | ------ |
| `model`      | 向量空间的唯一标识           | 必填   |
| `dimensions` | 输出维数，1 到 16,000 的整数 | 必填   |
| `batchSize`  | 单次索引请求的最大文本数     | 32     |
| `embed`      | 可选的单文本向量接口         | —      |
| `embedBatch` | 返回与输入顺序一致的向量数组 | 必填   |

```ts
import { Storage } from '@cieljs/storage';
import { VectorService, vectorStorage } from '@cieljs/vector';
import { SessionManager, sessionStorage } from '@cieljs/session';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage, vectorStorage],
});
await using vectors = new VectorService({
  storage,
  provider: embedding,
  providerId: 'provider',
  revision: '1',
  granularity: 'chunk',
  inputConfig: 'raw',
});
const manager = await SessionManager.open({
  storage,
  namespace: 'session',
  vectors,
  onIndexError: error => console.error('向量索引失败', error),
});

await manager
  .space('blive:room:21452505')
  .session()
  .then(session =>
    session.appendMessage({
      role: 'user',
      content: '本次决定采用本地数据库保存会话。',
      timestamp: Date.now(),
    }),
  );

// 索引在消息写入后排队执行；检索刚写入的内容前先 flush。
await manager.flushIndexes();
const hits = await session.search('会话保存在哪里', { mode: 'vector' });
```

`options.purpose` 在索引时是 `document`，查询时是 `query`；若模型要求不同的任务类型或文本前缀，由适配层完成映射。查询会传递 `signal`，调用函数应把它转交给 SDK 或 `fetch`。返回的向量必须匹配配置维数、仅包含有限数值，且不能为零向量。

索引属于派生数据，不会阻塞写入。查询没有命中，可能是索引还没跑完、模型标识或维数对不上，也可能只是 `minVectorSimilarity` 太高。向量服务暂时不可用时消息照样保存：混合 `search()` 报告向量错误后继续全文和模糊检索，而显式 `{ mode: "vector" }` 会把错误交给调用方。更换模型或 tokenizer 之后，用新配置重新打开存储并调用 `session.rebuildIndexes()`；要重建所有会话就调用 `manager.rebuildIndexes()`，失败的任务可以用 `manager.retryIndexes()` 重试，`manager.getIndexStatus()` 返回 `pending`、`ready`、`failed` 数量。另外要注意检索没有近似索引——它按模型与维数筛选后做精确余弦计算——性能需要按自己的数据规模评估。

未配置 `onIndexError` 时会打印警告；索引任务失败不会撤销任何消息。

## Agent Tools

Agent Tool 从独立入口导入。通过 `sessionTools({ session, space })`，可以同时获得当前会话和当前空间的历史工具：

- `search_current_session_messages`：找到当前 Session 的相关历史片段。
- `read_current_session_messages`：读取当前 Session 中某条消息附近的上下文。
- `find_sessions_by_source`：在当前空间中根据业务 ID、名称、昵称、标题或别名等 `sources` 发现相关会话。
- `search_discovered_session_messages`：搜索已经发现的会话。
- `read_discovered_session_messages`：读取已经发现的会话中某条消息附近的上下文。

默认不开放跨空间访问。当前会话正文直接搜索，同空间的其他会话先按来源发现，再逐个搜索；没有直接搜索当前空间全部会话正文的工具。

| 配置                | 来源发现范围            | 正文搜索与读取范围                                          |
| ------------------- | ----------------------- | ----------------------------------------------------------- |
| 不传 `crossSpace`   | 当前 Space              | 当前 Session，以及已发现的同空间 Session                    |
| `access: "related"` | 所传 Manager 的全部空间 | 当前 Session，以及按来源发现的 Session                      |
| `access: "all"`     | 所传 Manager 的全部空间 | 额外允许直接搜索、读取该 Manager 中全部 Session，无需先发现 |

```ts
import { sessionTools } from '@cieljs/session/agent';

// 默认：仅在当前空间内找回历史。
const localTools = sessionTools({ session, space });

// 跨空间：先按来源发现会话，再搜索、读取。
const relatedTools = sessionTools({
  session,
  space,
  crossSpace: { manager, access: 'related' },
});

// 跨空间：也允许直接搜索全部会话正文。
const allTools = sessionTools({
  session,
  space,
  crossSpace: { manager, access: 'all' },
});
```

| Tool name                            | 可用配置               | 行为                                                       |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------- |
| `search_current_session_messages`    | 默认、`related`、`all` | 始终只搜索当前 Session 正文                                |
| `read_current_session_messages`      | 默认、`related`、`all` | 始终只读取当前 Session 的消息前后文                        |
| `find_sessions_by_source`            | 默认、`related`、`all` | 只匹配 `sources`，按上表范围发现会话，不搜索正文           |
| `search_discovered_session_messages` | 默认、`related`、`all` | 按 `sessionId` 搜索已发现会话的正文                        |
| `read_discovered_session_messages`   | 默认、`related`、`all` | 按 `sessionId`、`messageId` 读取已发现会话的消息前后文     |
| `search_all_session_messages`        | 仅 `all`               | 跨全部空间搜索消息正文，不搜索 `sources`                   |
| `read_any_session_messages`          | 仅 `all`               | 按 `sessionId`、`messageId` 直接读取消息前后文，无需先发现 |

`related` 的调用顺序是 `find_sessions_by_source` → `search_discovered_session_messages` → `read_discovered_session_messages`。发现结果包含 `session.id`、`session.spaceId` 和 `matchedSources`；用 `session.id` 作为后续的 `sessionId`，用正文搜索结果的 `message.id` 作为 `messageId`。发现记录在这组工具实例存续期间有效，重新创建工具后需要重新发现。

`all` 可以直接调用 `search_all_session_messages`，再将结果的 `message.sessionId` 和 `message.id` 交给 `read_any_session_messages`。读取工具返回目标消息及 `before`、`after` 指定的相邻消息，不会返回整段会话。

这些工具全部只读。`all` 只覆盖所传 Manager 的会话库，不会搜索其他独立数据库。Agent Tool 不提供 `list_sessions`；宿主若需要管理列表，可以调用 `space.list()` 或 `manager.list()`。

独立全局问答 Agent 可以用另一个数据目录保存自身 Session，再把普通空间的 Manager 只作为跨会话查询来源。这样问答历史不会混入普通空间数据。

## API 参考

`@cieljs/session`

| 导出                                                                                      | 类型     | 说明                                                                                                                           |
| ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SessionManager`                                                                          | class    | 在一个存储命名空间中打开会话，包的入口                                                                                         |
| `SessionManager.open(options)`                                                            | method   | `{ storage, namespace, vectors?, tokenize?, onIndexError? }`                                                                   |
| `sessionStorage`                                                                          | const    | 注册 session schema 与迁移的存储模块                                                                                           |
| `DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT`                                                   | const    | 摘要模型的可选默认系统提示词                                                                                                   |
| `tokenizeSearchText`                                                                      | function | 全文与来源检索共用的 tokenizer                                                                                                 |
| `estimateContextTokens`                                                                   | function | 估算一组消息的上下文用量                                                                                                       |
| `estimateAgentMessageTokens`                                                              | function | 估算单条消息的 token 数                                                                                                        |
| `SessionError` 及其子类                                                                   | class    | `SessionNotFoundError`、`SessionAccessError`、`SessionCompactionConflictError`、`SessionClosedError`、`SessionValidationError` |
| `Session`、`SessionSpace`、`SessionInfo`                                                  | type     | 会话句柄及其元信息                                                                                                             |
| `SessionMessage`、`SessionCompaction`                                                     | type     | 已保存的消息与摘要记录                                                                                                         |
| `SessionOptions`、`SessionListOptions`、`SessionMessageListOptions`、`UpdateSessionInput` | type     | 会话级输入                                                                                                                     |
| `CompactionOptions`、`SessionSummarizer`、`SummarizeInput`、`AppendCompactionInput`       | type     | 压缩输入与摘要函数契约                                                                                                         |
| `SessionSearchOptions`、`SessionSearchMode`、`SessionSearchMatch`、`SessionSearchHit`     | type     | 检索输入与结果                                                                                                                 |
| `FindSessionsBySourceOptions`、`SessionSourceHit`、`SessionSourceSearchMode`              | type     | 来源发现的输入与结果                                                                                                           |
| `SessionIndexStatus`、`SessionContext`、`SessionManagerOptions`、`SessionSource`          | type     | 索引状态、上下文与 Manager 选项                                                                                                |

`SessionManager`

| 成员                                                     | 说明                               |
| -------------------------------------------------------- | ---------------------------------- |
| `space(spaceId)`                                         | 返回 `SessionSpace` 句柄           |
| `getAnySession(id)`                                      | 跨空间查找一段 Session             |
| `list(options)`                                          | 列出会话元信息                     |
| `searchAll(query, options)`                              | 融合检索该 Manager 下的全部会话    |
| `findSessionsBySource(query, options)`                   | 把业务标识解析成会话               |
| `getIndexStatus()`                                       | `{ pending, ready, failed }`       |
| `flushIndexes()` / `retryIndexes()` / `rebuildIndexes()` | 排空、重试或重建派生索引           |
| `close()`                                                | 等待已排队任务；不关闭底层 Storage |

`Session`

| 成员                                                                                        | 说明                                       |
| ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `appendMessage(message)` / `getMessages(options)`                                           | 追加 `AgentMessage`，分页读取已存消息      |
| `getMessagesAfter(afterSeq)` / `getMessagesRange(fromSeq, toSeq)` / `getMessage(messageId)` | 读取流水的指定部分                         |
| `context()`                                                                                 | 最新摘要加上它尚未覆盖的原文               |
| `compact(options)`                                                                          | 执行一轮压缩；没有可压缩内容时返回 `null`  |
| `search(query, options)`                                                                    | 仅在该会话内检索                           |
| `record(event, metadata?)` / `appendCompaction(input)`                                      | 追加运行时事件，或带乐观边界检查地写入摘要 |
| `getLatestCompaction()` / `getLastMessage()` / `getActiveMessageRows()`                     | 检查当前摘要、末尾消息与生效行             |
| `getInfo()` / `update(input)` / `delete()`                                                  | 会话元信息与生命周期                       |
| `rebuildIndexes()`                                                                          | 重建该会话的文本与向量投影                 |

`@cieljs/session/agent`

| 导出                                       | 类型     | 说明                             |
| ------------------------------------------ | -------- | -------------------------------- |
| `sessionTools(options)`                    | function | 为 Agent 构建只读的会话工具      |
| `CrossSpaceAccess`、`CrossSpaceOptions`    | type     | `"related"` / `"all"` 跨空间授权 |
| `SessionToolsOptions`、`SessionToolLimits` | type     | 工具选项与结果数量限制           |

## 行为约定

- **写入与错误。** 消息是事实，索引是派生数据。索引失败通过 `onIndexError` 报告，绝不取消写入。
- **并发。** 压缩在同一 Manager 内串行执行；`appendCompaction()` 拒绝覆盖在生成期间被外部更新的摘要。
- **归属。** Manager 借用 Storage 与向量服务，关闭它不会释放这两者；Manager 仍在使用时关闭 Storage 属于误用。
- **隔离。** 空间之间不会隐式合并；跨空间读取只发生在显式授权的工具，或宿主主动交出的 Manager 中。

## 开发

```bash
vp check
vp test --run
vp run build
```

测试使用本地数据库和模型替身，无需 API Key。你可以直接验证会话恢复、递归压缩、token 判断与历史检索，再接入自己的模型服务。
