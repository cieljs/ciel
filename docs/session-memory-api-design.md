# Session / Memory API 整理草案

状态：部分已确认。本文描述建议的公开契约，不代表当前代码已经实现。

已确认：保留 `openCielData()`；将 `defineCiel()` 改为公开的 `class Ciel`；`DefineCielOptions` 改名 `CielOptions`。`Ciel` 借用数据层，重启运行层时复用同一个 data 实例。

## 目标与包边界

- 应用只声明 `cieljs` 一个 Ciel 依赖，并从 `cieljs` 或 `cieljs/*` 导入。`cieljs` 负责安装全部同级包，不要求应用逐个安装 `@cieljs/*`。
- `@cieljs/session`、`@cieljs/memory` 等包仍有自己的 `package.json`、构建产物和公开入口，可以独立安装、发布和使用。包之间继续直接依赖 `@cieljs/*`，避免通过顶层包形成环。
- `cieljs` 根入口负责 `openCielData`、`Ciel` 类及其类型；能力由子路径转发。需要补齐 `cieljs/session/agent`、`cieljs/memory/agent`、UI 的 `style.css` 子路径，以及应用实际使用但尚未转发的入口。
- 应用选择数据目录、时区与业务配置；`openCielData` 打开共享 Storage、Session Manager、Investigation Manager 和 Memory Manager。子包接收显式资源，不自行推导目录。

当前两个应用同时声明 `cieljs` 和多个 `@cieljs/*`，这是入口使用方式不统一。整理应用依赖应排在公开入口确定之后。Watch Blive 开发模式还通过 `require.resolve('@cieljs/perception')` 推导 Hearing 模型目录；改成单一依赖时，必须给这段资源发现逻辑提供明确路径，不能仅替换 import 字符串。

## 当前 API 的主要问题

| 位置            | 当前形状                                                                                 | 使用上的问题                                                                     | 建议                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Session 空间    | `space.session({ id? })`                                                                 | `session` 既是名词又是创建或恢复操作；传入不存在的 ID 时会创建，名称未提示该行为 | 改为 `space.openSession({ id?, title?, sources? })`，明确其 create-or-resume 语义                          |
| Session 对象    | `record`、`appendCompaction`、`getLatestCompaction` 与 `appendMessage`、`context` 等平铺 | Agent 事件投影、压缩内部步骤与常规会话操作混在一起                               | 按实际调用收紧公开方法，详见下方清单                                                                       |
| Memory 变更     | `forget(id, { expectedRevision })`                                                       | 实际行为是软归档，正文和 revision 均保留；Agent 工具已经叫 `archive_*`           | 公共方法改为 `archive`，文档统一称归档                                                                     |
| Memory 全库读取 | `getAny(id)`                                                                             | 名称没有表达会跨空间及全局层                                                     | 改为 `getAcrossSpaces(id)`；保留显式的 Manager 级权限边界                                                  |
| Memory 日期     | `timeZone` 省略时固定为 `Asia/Shanghai`                                                  | 可独立发布的通用包带入了应用默认值，影响 `space.daily` 的日期                    | 倾向要求调用方显式传入 IANA 时区；应用可继续传 `Asia/Shanghai`                                             |
| 顶层别名        | `SessionStorageOptions`、`MemoryStorageOptions`、`InvestigationStorageOptions`           | 名称像 Storage 配置，实际是完整 Manager 选项的别名，且只有前两者用于 `Pick`      | 由 `CielDataOptions` 声明聚合配置，`CielOptions` 只接收 `data` 与运行选项；底层 Manager 选项由各独立包导出 |

Session 还有对称的问题：`SessionManager.getAnySession(id)` 可以跨空间读取，建议改名 `getSessionAcrossSpaces(id)`，与 Space 内的 `getSession(id)` 明确区分。

`Session` 的方法经工作区调用核对后，可进一步收紧：`record(event)` 由 Runtime 使用，建议改名 `recordEvent(event)`，以区别直接写入的 `appendMessage(message)`。`appendCompaction()`、`getActiveMessageRows()`、`getLastMessage()`、`getMessagesAfter()` 在生产调用中没有使用，可从公开对象移除；相关行为通过 `compact()`、`context()`、`getMessages()` 与 `getMessagesRange()` 覆盖。`getLatestCompaction()` 作为只读检查入口保留。这样无需再增加一层高级对象。

`SessionManager.space(spaceId)`、`MemoryManager.space(spaceId)`、`manager.global` 的作用域绑定方式建议保留。`sources` 继续是通用的 `string[]`；跨空间读取必须显式授权，写入始终绑定当前空间。Memory 的逻辑 ID、完整 revision 历史和 `expectedRevision` 乐观并发契约也应保留。

## 建议的使用形状

应用通过 `cieljs` 一次打开并持有公共数据层：

```ts
import { Ciel, openCielData } from 'cieljs';
import { traceStorage } from 'cieljs/trace/host';

await using data = await openCielData({
  dataDir,
  session: { namespace: 'conversation' },
  investigation: { namespace: 'investigation' },
  memory: { timeZone: 'Asia/Shanghai' },
  modules: [traceStorage],
});

await using ciel = new Ciel({
  data,
  model,
  systemPrompt,
});

await ciel.start();

const space = data.sessions.space(spaceId);
const session = await space.openSession({ id: sessionId, sources });

const spaceMemory = data.memories.space(spaceId);
const entry = await spaceMemory.daily.remember({ content, sources });
await spaceMemory.daily.archive(entry.id, { expectedRevision: entry.revision });
```

`openCielData()` 自动注册 `sessionStorage`、`memoryStorage`；`modules` 只用于宿主需要的额外 Storage 模块。它返回 `storage`、`sessions`、`investigations`、`memories`。若传入 `vector: Omit<VectorOptions, 'storage'>`，它再注册 `vectorStorage`、创建并返回 `vectors`，然后把同一个服务注入两个 Manager。初始化失败逆序回滚；关闭顺序为 Ciel Runtime → Managers → VectorService → Storage。聚合对象拥有这些资源，`new Ciel({ data })` 借用它们，不重复打开 Manager，也不负责关闭聚合对象。Watch 应用可以从 `data.storage` 打开 Trace、维持自己的 checkpoint 策略。

`Ciel` 从当前私有 `CielInstance` 提升为公开类，构造函数接受 `CielOptions`，同步且无 I/O；`start()` 才启动 Runtime。类本身提供现有的 `status`、`session()`、`investigate()`、`close()` 和 `[Symbol.asyncDispose]()`。公开类既是运行时值也是 TypeScript 类型，移除单独的 `Ciel` interface 与 `defineCiel()` 工厂，避免留下两个等价入口。现有 `DefineCielOptions` 相应改名为 `CielOptions`。

`Ciel.close()` 只关闭该实例的 Runtime 与会话，不关闭 `data`。需要重新运行时，关闭旧实例后用同一个 `data` 创建新的 `Ciel`；新的模型、提示词和工具可以随新实例传入。`data.close()` 留在应用退出或共享数据层确实不再使用时执行。这样重启 Agent 不需要重开 PGlite、重放数据或重建索引 Manager。

推荐在聚合入口保留现有的 `'session'` / `'investigation'` 默认 namespace，也允许宿主显式覆盖，且两者必须不同。独立包的 `SessionManager.open()` 仍要求明确给出 namespace。已有数据库不能静默切换 namespace。

独立包仍可直接创建所需资源，使用相同的 Session / Memory 方法与类型：

```ts
import { SessionManager, sessionStorage } from '@cieljs/session';
import { MemoryManager, memoryStorage } from '@cieljs/memory';
```

`openSession({ id })` 沿用当前行为：ID 已存在就恢复，尚不存在就用该 ID 创建；省略 ID 则生成新 ID。传入 `title` 或 `sources` 会在恢复时覆盖对应字段；省略则保留原值。若只想查找而不创建或修改，使用 `space.getSession(id)` 并处理 `null`。这两个动作需要在文档中并排展示。

## 分阶段迁移

1. 确定上述 API 名称与 `timeZone` 规则；补充针对公开类型、create-or-resume、归档和作用域边界的契约测试。
2. 实现 `openCielData` 与 `new Ciel({ data })` 的借用关系；测试初始化回滚、重复关闭、关闭顺序和外部 Trace 使用同一 Storage。然后调整 Session / Memory 的公开方法及调用方，同步中文和英文 README。
3. 补齐 `cieljs/*` 转发入口，两个应用改为仅声明 `cieljs` 并从它导入。底层包之间仍使用 `@cieljs/*`。
4. 用独立消费者分别安装 `@cieljs/session`、`@cieljs/memory` 和 `cieljs`，检查 JS、声明文件、`./agent` 入口及真实运行。修正包元数据中仍存在的模板地址与作者信息，再考虑发布流程。

## 确认点

1. `space.session()` 是否改为 `space.openSession()`，并保持 create-or-resume 语义？
2. `forget()` 是否改名 `archive()`？Manager 上的 `getAny()` / `getAnySession()` 是否分别改名 `getAcrossSpaces()` / `getSessionAcrossSpaces()`？
3. `MemoryManager.open()` 的 `timeZone` 是改为必填，还是改用 `UTC` 默认值？
4. Session 是否按上文收紧方法：`recordEvent()` 明确事件写入，移除四个未被生产调用的方法，保留 `getLatestCompaction()`？
5. `openCielData({ dataDir, session?, investigation?, memory, modules?, vector? })` 的可选配置及 namespace 默认值是否按上文实现？`openCielData`、`new Ciel({ data, ... })` 和 `CielOptions` 命名已确认。
