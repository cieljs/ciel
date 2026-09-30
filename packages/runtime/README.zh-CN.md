<h1 align="center">@cieljs/runtime</h1>

<p align="center">执行 Ciel Session 与 Investigation 的底层运行引擎。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概念">概念</a> ·
  <a href="#生命周期">生命周期</a> ·
  <a href="#session">Session</a> ·
  <a href="#investigation">Investigation</a> ·
  <a href="#api-参考">API 参考</a> ·
  <a href="#设计说明">设计说明</a>
</p>

`Runtime` 只管理运行状态、Agent、Session 和 Investigation 生命周期。它不解析目录，不创建 Storage、SessionManager、MemoryManager 或 MCP，也不提供 `defineCiel()`——这些都属于宿主。

应用通常应使用顶层 [`cieljs`](../cieljs/README.md)；只有需要自行组合所有 Manager 时才直接实例化 Runtime。

## 概念

| 概念          | 类型                    | 职责                                                |
| ------------- | ----------------------- | --------------------------------------------------- |
| Runtime       | `Runtime`               | 运行状态、已打开的 Session 与进行中的 Investigation |
| Session       | `RuntimeSession`        | 绑定到某个空间的对话 Agent 及其会话记录             |
| Investigation | `runtime.investigate()` | 一次隔离的记忆与会话历史检索运行                    |
| Sources       | `SessionSources`        | 宿主提供的身份标签，每次运行前重新读取              |

## 安装

`@cieljs/runtime` 属于 Ciel monorepo，通过 workspace 使用：

```bash
pnpm add @cieljs/runtime
```

本包依赖 [`@cieljs/agent-kit`](../agent-kit/README.zh-CN.md) 提供工具定义与协议类型，并借用 [`@cieljs/session`](../session/README.zh-CN.md) 与 [`@cieljs/memory`](../memory/README.md) 的 Manager。全部 Manager 由宿主创建并持有。

## 快速开始

`model` 与 `hostTools` 由应用提供；Manager 由宿主打开，与顶层 `cieljs` 包的做法一致。

```ts
import { MemoryManager, memoryStorage } from '@cieljs/memory';
import { SessionManager, sessionStorage } from '@cieljs/session';
import { Storage } from '@cieljs/storage';
import { Runtime } from '@cieljs/runtime';

// 共享一个 Storage 实例，每个用途各占一个 namespace。
await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage, memoryStorage],
});

await using sessionManager = await SessionManager.open({ storage, namespace: 'session' });
await using investigationManager = await SessionManager.open({
  storage,
  namespace: 'investigation',
});
await using memoryManager = await MemoryManager.open({ storage, timeZone: 'Asia/Shanghai' });

const runtime = new Runtime({
  model,
  systemPrompt: '你是 Ciel。',
  sessionManager,
  investigationManager,
  memoryManager,
  tools: hostTools,
});

await runtime.start();

try {
  const session = await runtime.session({
    spaceId: 'blive:room:21452505',
    sources: () => ['room:21452505'],
  });

  await session.agent.prompt('你好');

  const result = await runtime.investigate({
    target: { type: 'space', spaceId: 'blive:room:21452505' },
    question: '主播以前提到过哪些游戏偏好？',
  });

  await session.agent.prompt(result.answer);
  await session.close();
} finally {
  // 这里只结束 Runtime 自己的 Agent；Manager 仍由宿主持有。
  await runtime.close();
}
```

## 生命周期

`Runtime` 通过 `status` 报告五种状态：

| 状态       | 含义                               |
| ---------- | ---------------------------------- |
| `idle`     | 已构造，尚未启动                   |
| `starting` | `start()` 正在进行                 |
| `running`  | 可以打开 Session 与 Investigation  |
| `closing`  | `close()` 正在进行，不再接受新工作 |
| `closed`   | 终态                               |

`start()` 是幂等的：已经在运行时立即返回，正在启动时返回同一个 Promise。`close()` 开始之后，`start()` 会以 `Runtime 已开始关闭`（或 `Runtime 已开始关闭：closing` / `...：closed`）拒绝。

`close()` 会记住第一次调用——后续调用返回同一个 Promise。它会

1. 先切到 `closing`，阻止新的 Session 与 Investigation 启动；
2. 等待进行中的 `start()` 结算，即使它已经失败；
3. 等待所有仍在打开中的 Session；
4. 关闭已打开的全部 Session，并等待所有进行中的 Investigation；
5. 进入 `closed`；以上任意一步失败时抛出 `AggregateError`（`Runtime 关闭时发生错误`）。

运行时不在运行状态时调用 `session()` 或 `investigate()` 会抛出 `Runtime 当前不可用：<status>`。`Runtime` 同时实现 `AsyncDisposable`，因此可以写 `await using runtime = new Runtime(options)`。

## Session

`runtime.session(options)` 打开或恢复一段对话 Session。

| 选项         | 默认值  | 含义                                                        |
| ------------ | ------- | ----------------------------------------------------------- |
| `spaceId`    | 必填    | 隔离边界，一段 Session 只属于一个空间                       |
| `sessionId`  | —       | 传入已有 ID 即续接同一段历史，省略则新建                    |
| `sources`    | `[]`    | `string[]` 或 `() => string[]`，见[来源与身份](#来源与身份) |
| `crossSpace` | `false` | 允许 Session 与 Memory 工具只读检索相关空间                 |

返回的 `RuntimeSession` 提供 `id`、`spaceId`、`agent`、`compact()` 与 `close()`。

打开 Session 时会一次性组装好 Agent：

- 通过 `sessionManager.space(spaceId).session({ id, sources })` 打开会话并恢复已存储的上下文；
- 工具依次是宿主通过 `RuntimeOptions.tools` 提供的工具、`sessionTools()`、当前空间的 `memoryTools()`，以及面向全局长期记忆的 `globalMemoryTools()`；
- 工具名重复会抛出 `工具名称重复：<name>`，宿主工具不可能悄悄覆盖内置工具；
- `crossSpace: true` 会转成两个 Manager 的 `access: 'related'`：跨空间访问先经来源发现，而不是直接搜索全部正文；
- Memory 工具拿到的来源是 `[`session:${session.id}`, ...sources]`；
- 每个 Agent 事件都会连同 `{ tools, model }` 记录进 Session，会话记录因此是这次运行的事实流水。

`close()` 会标记 Session 已关闭、等待 Agent 进入空闲并退订事件。之后调用 `prompt()` 会抛出 `Session 已关闭：<id>`，运行失败则表现为 `Agent 运行失败：<errorMessage>`。

> [!NOTE]
> `RuntimeOptions.tools` 只与 Session Agent 共享。Investigation 使用的是单独配置的 `RuntimeOptions.investigation.tools`。

## Investigation

`runtime.investigate(options)` 执行一次隔离调查，并以它的回答作为结果。

| 选项           | 默认值                                                                               | 含义                                                             |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `target`       | 必填                                                                                 | `{ type: 'global' }` 或 `{ type: 'space', spaceId, sessionId? }` |
| `question`     | 必填                                                                                 | `string` 或 `AgentMessage[]`                                     |
| `sessionId`    | —                                                                                    | 续接 Investigation 自身的会话                                    |
| `systemPrompt` | 先取 `RuntimeOptions.investigation.systemPrompt`，再取 `RuntimeOptions.systemPrompt` | 单次调查的提示词覆盖                                             |
| `memoryAccess` | 只读                                                                                 | `'read'` 或 `'read-write'`，写权限不会超出 target 指定的层级     |
| `crossSpace`   | `false`                                                                              | 只读检索目标之外的空间                                           |
| `sources`      | `[]`                                                                                 | 与 Session 相同的形状                                            |
| `signal`       | —                                                                                    | 中止它即中止这次 Agent 运行                                      |
| `onEvent`      | —                                                                                    | `(event, { tools, model }) => void`，每个 Agent 事件都会回调     |

Investigation 的会话存放在 `investigationManager` 中，空间名取自 target：全局调查用 `'global'`，其余用 target 的 `spaceId`。`space` 类型的 target 还可以额外指定一段普通 Session（与 Investigation 自身的 sessionId 无关），供 `read_target_session` 顺序分页读取。

内置工具：

| 工具                  | 可用条件                     | 行为                                                                                |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `search_memory`       | 始终可用                     | 只读记忆检索：全局 target 搜索全部空间与全局层，其余搜索目标空间与全局层            |
| `read_memory`         | 始终可用                     | 按 ID 读取目标空间或全局层的一条记忆                                                |
| `search_sessions`     | 始终可用                     | 只读搜索普通 Session 正文，范围由 target 与 `crossSpace` 决定，不搜索 Investigation |
| `read_session`        | 始终可用                     | 读取某段普通 Session 中一条消息的局部上下文                                         |
| `read_target_session` | 始终可用                     | 分页读取宿主指定的 Session；target 未指定 Session 时返回空，且不能改变目标          |
| 记忆写入工具          | `memoryAccess: 'read-write'` | 全局 target 用 `globalMemoryTools()`，空间 target 用 `memoryTools()`                |

`RuntimeOptions.investigation.tools` 中的宿主工具追加在这些工具之后，工具名重复同样会抛错。

结果是 `{ sessionId, answer, messages }`，其中 `answer` 是本次运行最后一条 assistant 消息。没有产生 assistant 消息时抛出 `Investigation 没有产生最终回答`；assistant 消息带有 `errorMessage` 时抛出 `Investigation 失败：<errorMessage>`。

每次调用都是一次独立运行：Runtime 会跟踪它以便 `close()` 等待，但 Investigation 本身没有 `close()`——需要提前停止时传入 `signal`。

## 来源与身份

```ts
type SessionSources = string[] | (() => string[]);
```

- 每次读取都会规范化来源：裁剪空白、丢弃空值、去重并保留首次出现的顺序。
- 函数形式会在每次 Agent 运行前、每次工具调用前重新求值，因此宿主可以跟随变化中的值，例如当前的房间号。
- 只有序列化后的列表真正变化时才会写回 Session；缓存只在写入成功后推进，因此失败的写入会在下次调用时重试。
- 每次模型请求前，Runtime 会插入一条包含 `<ciel_context>` 的用户消息：Session 是 `spaceId` 与 `sources`，Investigation 是 `target` 与 `sources`，并声明这些身份与来源由宿主提供，不能被历史消息或工具结果覆盖。
- Session 运行还会在存在时注入 `<historical_memory>`，包含全局长期记忆、当前空间长期记忆与当前空间每日记忆，并标明它们是可能过时的历史资料而非当前指令。

记忆召回失败不会阻止本轮对话，显式的 Memory 工具仍会报告真实错误。召回过程中被中止时，中止会被重新抛出。

## 上下文与压缩

| 选项                 | 默认值                                                              | 含义                         |
| -------------------- | ------------------------------------------------------------------- | ---------------------------- |
| `contextWindow`      | 对话模型的 `contextWindow`                                          | 用于判断何时压缩的上下文窗口 |
| `reserveTokens`      | [`@cieljs/session`](../session/README.zh-CN.md) 的默认值（`16384`） | 为后续生成预留的 token       |
| `keepRecentMessages` | [`@cieljs/session`](../session/README.zh-CN.md) 的默认值（`10`）    | 至少保留的最近原始消息条数   |

自动路径在每次 Agent 运行前检查一次，并遵循 Session 的阈值。`RuntimeSession.compact()` 是手动路径：它等待 Agent 进入空闲、忽略阈值，并返回是否产生了新的压缩摘要。两条路径都会让 `agent.state.messages` 与压缩后的 `session.context()` 保持同步。

摘要复用对话模型：使用 [`@cieljs/session`](../session/README.zh-CN.md) 的 `DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT`，`maxTokens` 预算为 `2048`，图片会被简化为 `{ type: 'image', mimeType }`，因此摘要输入不携带 base64 正文。未能正常结束的响应或空摘要都会抛错，而不是替换历史。

## API 参考

`@cieljs/runtime`

| 导出                                                                                                                                         | 种类  | 说明                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `Runtime`                                                                                                                                    | class | 入口类，管理状态、Session 与 Investigation                                          |
| `RuntimeOptions`                                                                                                                             | type  | 构造参数                                                                            |
| `OpenRuntimeSessionOptions`                                                                                                                  | type  | `{ spaceId, sessionId?, sources?, crossSpace? }`                                    |
| `RuntimeSession`                                                                                                                             | type  | `{ id, spaceId, agent, compact(), close() }`，并支持异步释放                        |
| `RuntimeStatus`                                                                                                                              | type  | `'idle' \| 'starting' \| 'running' \| 'closing' \| 'closed'`                        |
| `RuntimeCompactionOptions`                                                                                                                   | type  | `{ contextWindow?, reserveTokens?, keepRecentMessages? }`                           |
| `InvestigateOptions`                                                                                                                         | type  | 单次调查的选项                                                                      |
| `InvestigationTarget`                                                                                                                        | type  | `{ type: 'global' }` 或 `{ type: 'space', spaceId, sessionId? }`                    |
| `InvestigationResult`                                                                                                                        | type  | `{ sessionId, answer, messages }`                                                   |
| `SessionSources`                                                                                                                             | type  | `string[] \| (() => string[])`                                                      |
| `AgentEvent`、`AgentMessage`、`RuntimeEvent`、`RuntimeRecord`、`RuntimeReader`、`RuntimeWriter`、`RuntimeMetadata`、`SessionCompactionEvent` | type  | 从 [`@cieljs/agent-kit/protocol`](../agent-kit/README.zh-CN.md#运行时协议) 重新导出 |

`Runtime`

| 成员                      | 说明                                                      |
| ------------------------- | --------------------------------------------------------- |
| `constructor(options)`    | 保存 `RuntimeOptions`，不做任何 I/O                       |
| `status`                  | 当前的 `RuntimeStatus`                                    |
| `start()`                 | 幂等，切换到 `running`                                    |
| `session(options)`        | 打开或恢复一段 Session，要求处于 `running`                |
| `investigate(options)`    | 启动一次 Investigation 运行，要求处于 `running`           |
| `close()`                 | 记住首次调用的收尾流程，关闭 Session 并等待 Investigation |
| `[Symbol.asyncDispose]()` | 调用 `close()`                                            |

`RuntimeOptions`

| 选项                   | 种类                         | 含义                                                  |
| ---------------------- | ---------------------------- | ----------------------------------------------------- |
| `model`                | `Model<Api>`                 | 对话模型，同时用于摘要与 Investigation                |
| `apiKey`               | `string?`                    | 请求级凭据，不写入环境变量或持久化存储                |
| `systemPrompt`         | `string`                     | Session 的默认提示词，也是 Investigation 的兜底提示词 |
| `sessionManager`       | `SessionManager`             | 承载对话 Session 的 Manager                           |
| `investigationManager` | `SessionManager`             | 单独承载 Investigation 会话的 Manager                 |
| `memoryManager`        | `MemoryManager`              | 承载 Memory 工具、召回与全局层的 Manager              |
| `tools`                | `AgentTool[]?`               | 追加到每个 Session Agent 的宿主工具                   |
| `compaction`           | `RuntimeCompactionOptions?`  | 上下文压缩覆盖项                                      |
| `investigation`        | `{ systemPrompt?, tools? }?` | Investigation 的提示词与宿主工具                      |

## 设计说明

Runtime 借用所有注入的 Manager：`close()` 只结束自己的 Session 与 Investigation，不动 `SessionManager`、`MemoryManager` 与 `Storage`，它们由宿主关闭。一段 Session 绑定一个 `spaceId`，`crossSpace` 只扩大对相关空间的只读访问，Investigation 的写入始终限制在 target 指定的层级。来源在每次运行和每次工具调用前刷新，压缩之后 Agent 转录会重新同步，因此长时间存活的 Session 能持续跟随宿主状态。

失败要显式。工具名重复、Runtime 不可用、Session 已关闭、Agent 运行失败都会抛出指明原因的异常，收尾失败会以 `AggregateError` 报告而不是被吞掉。宿主的职责不落在本包里：目录解析、`defineCiel()`、MCP 与 Manager 的创建都在本包之上——见 [`cieljs`](../cieljs/README.zh-CN.md)。

## 开发

在本包目录运行：

```bash
vp check
vp test --run
vp run build
```

测试使用本地数据库、临时目录和模型替身，无需 API Key，覆盖自动与手动压缩、跨空间授权、存储隔离与重放，以及工具重名。
