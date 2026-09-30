<h1 align="center">@cieljs/trace</h1>

<p align="center">与界面无关的轨迹数据层：采集 Agent 事件、投影执行记录、持久化，并通过 oRPC 对外提供。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概述">概述</a> ·
  <a href="#概念">概念</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#orpc-接口">oRPC 接口</a> ·
  <a href="#api-参考">API 参考</a> ·
  <a href="#设计取舍">设计取舍</a>
</p>

## 概述

`@cieljs/trace` 是 Ciel Console 背后的数据层。它订阅运行时事件流水，把原始事件归并成可读的执行
记录，把每份载荷持久化到 PGlite，并以 oRPC 查询加两个订阅的形式对外暴露。

本包提供四个入口：

| 入口                     | 内容                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `@cieljs/trace`          | 以下全部内容的便捷再导出                                      |
| `@cieljs/trace/host`     | `TraceHost`、`createTraceRouter`、`traceStorage` 以及路由类型 |
| `@cieljs/trace/client`   | `createTraceClient` 与 `TraceClient` 类型                     |
| `@cieljs/trace/protocol` | 仅协议类型，两侧都可安全引用                                  |

包内没有 Vue 代码，也没有 Electron 代码。持有 `Storage` 实例的宿主运行时持有 `TraceHost`；
持有传输层的一方持有连接。消费本协议的界面见 [`@cieljs/console`](../console/README.zh-CN.md)，
另一个消费者见 [`@cieljs/investigation`](../investigation/README.zh-CN.md)。

## 概念

| 名词              | 含义                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TraceEvent`      | `RuntimeRecord` 的别名：一条已持久化的运行时事实，含 `id`、`sequence`、`sessionId`、`runId`、`turnId`、`messageId`、`toolCallId`、`timestamp`、`event`、`metadata` |
| 条目（entry）     | 由宿主或 `AgentTrace` 归并器维护的 `TraceEntry`：Agent/轮次生命周期、消息、工具执行、宿主记录的事实                                                                |
| 步骤（step）      | 由运行时事件一对一投影出的 `TraceEntry`，id 为 `step:<sequence>`，`revision` 即该序号                                                                              |
| 记录（record）    | `trace.records` 的一行：id、`category`、`sequence`、可选的 `run_id`/`session_id`，以及 V8 序列化后的值                                                             |
| 投影状态          | 重放游标与派生计数的 JSON 快照，存放在 id `trace:projection-state` 下                                                                                              |
| `TraceSession`    | 单个会话的时间范围，加上 `usage`、`turn`、`steps`                                                                                                                  |
| `TraceUsageState` | `{ total, context }`：累计用量与最近一次上下文规模                                                                                                                 |
| `TraceUpdate`     | 一次推送：变化的条目、变化的步骤、用量快照与可见会话                                                                                                               |
| `ValueRef`        | `{ id, path?, preview }`：指向已存载荷的惰性引用，通过 `values.get` 取值                                                                                           |

宿主写入的记录分类：

| 分类                | id 形式                                           | 写入方                                                            |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| `entry`             | 事件内为 `<event id>:<ordinal>`，否则为 UUID      | `AgentTrace` 归并器与 `record` / `recordMessage`                  |
| `step`              | `step:<sequence>`                                 | `saveEvent` 中的步骤投影                                          |
| `run`               | `run:<entry id>`                                  | `agent_start` 条目的副本，供按 run 查询                           |
| `value`             | `<entry id>:input`、`<entry id>:output` 或事件 id | 载荷快照与外部流水事件                                            |
| `message_reference` | `<messageId>:output`                              | 指向 `storage.events.record.event.message` 的引用，而不是复制载荷 |
| `projection_state`  | `trace:projection-state`                          | JSON 投影状态                                                     |

## 安装

在本 monorepo 内通过 workspace 协议引用：

```json
{
  "dependencies": {
    "@cieljs/trace": "workspace:*"
  }
}
```

发布名为 `@cieljs/trace`，没有 peer 依赖。

## 快速开始

在已有 `Storage` 之上打开宿主，然后暴露它的路由：

```ts
import { Storage } from '@cieljs/storage';
import { TraceHost, createTraceRouter, traceStorage } from '@cieljs/trace/host';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [traceStorage],
});
await using host = await TraceHost.open({ storage });

const router = createTraceRouter(host, {
  session: sessionId => !sessionId.startsWith('investigation:'),
});
```

从 Agent 喂入事件，或直接记录宿主层面的事实：

```ts
const unsubscribe = host.observe(agent, sessionId);

host.record('runtime_ready', { at: Date.now() }, sessionId);
host.recordMessage('关键词唤醒', '今天有什么有趣的直播？', sessionId);
```

客户端由应用自己持有的 link 创建：

```ts
import { createTraceClient } from '@cieljs/trace/client';
import { RPCLink } from '@orpc/client/message-port';

const channel = new MessageChannel();
window.postMessage('app:connect', '*', [channel.port2]);
channel.port1.start();

const client = createTraceClient(new RPCLink({ port: channel.port1 }));

const controller = new AbortController();
for await (const update of await client.updates(undefined, { signal: controller.signal })) {
  // update.entries、update.steps、update.usage、update.sessions
}
```

按需读取一页历史与一份载荷：

```ts
const page = await client.steps.list({ limit: 100, sessionId }, { signal: controller.signal });
const older = await client.steps.list(
  { cursor: page[0]?.sequence, limit: 100, sessionId },
  { signal: controller.signal },
);
if (page[0]?.raw) console.log(await client.values.get(page[0].raw));
```

## 宿主与持久化

`TraceHost.open` 接受存储实例与若干可选覆盖项：

| 选项          | 类型            | 默认值            | 作用                                 |
| ------------- | --------------- | ----------------- | ------------------------------------ |
| `storage`     | `Storage`       | 必填              | 记录与投影状态的存放位置             |
| `source`      | `RuntimeReader` | `storage.journal` | 事件读取来源                         |
| `writer`      | `RuntimeWriter` | `storage.journal` | 事件追加目标                         |
| `capacity`    | `number`        | `300`             | 内存摘要缓存条数，必须是正的安全整数 |
| `awaitReplay` | `boolean`       | `true`            | 历史重放是否在 `open()` 内完成       |

当 `source` 与 `writer` 都是存储流水时，宿主可以持久化投影状态并从游标继续；否则它把流水视作
外部来源，改为保留完整事件快照。

宿主成员：

| 成员                                       | 说明                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| `storage`                                  | 打开宿主时使用的 `Storage` 实例                              |
| `store`                                    | 路由使用的底层记录存储                                       |
| `signal`                                   | 生命周期 `AbortSignal`，由 `close()` 触发中止                |
| `usage()`                                  | 当前 `TraceUsageState` 快照                                  |
| `sessions()`                               | 可见的 `TraceSession[]`，含 `turn` 与 `steps` 进度           |
| `subscribe(listener)`                      | 注册 `TraceUpdate` 监听器，返回取消订阅函数                  |
| `record(name, output, sessionId?)`         | 追加一条已完成的宿主事实；`sessionId` 默认为 `'blive-agent'` |
| `recordMessage(label, content, sessionId)` | 追加一条已完成的 `message`/`perception` 条目                 |
| `observe(agent, sessionId)`                | 订阅 Pi `Agent`，并用实时的工具/模型元数据记录其事件         |
| `agentListener(sessionId, metadata?)`      | 只构造记录器、不订阅；序号由宿主分配                         |
| `events(afterSequence?, signal?)`          | 已持久化 `TraceEvent` 的异步生成器                           |
| `flushRecords()`                           | 依次冲刷 writer、投影与 store                                |
| `assertHealthy()`                          | 此前投影失败时抛出错误                                       |
| `close()` / `[Symbol.asyncDispose]()`      | 取消订阅、冲刷、中止生命周期并清空缓存                       |

### 轮次编号

一轮等于一次 Agent 运行：`resolveTurnNumber` 按会话内的 `runId` 分配号码，同一 run 的后续事件沿用
已分配的号。会话对外暴露最新的 `turn`，以及按界面同款分组键（工具调用、消息、agent、turn）去重后
的 `steps` 计数。

### 重建与切换

当投影状态缺失、不可读，或落后于流水的 `MAX(sequence)` 时，宿主创建 `trace.records_rebuild`，
从游标零重放进去，然后原子地切换表名与索引。已有记录不会被删除：内存淘汰只丢弃推送摘要缓存。

## oRPC 接口

`createTraceRouter(host, options?)` 返回一个由 oRPC 过程组成的普通嵌套对象。可选的 `session` 谓词
——`(sessionId: string) => boolean`——会过滤列表结果与两个订阅，因此一个宿主可以服务多个隔离视图。

| 过程               | 输入                                      | 结果                                                |
| ------------------ | ----------------------------------------- | --------------------------------------------------- |
| `runs.list`        | `{ cursor?, limit?, sessionId? }`         | `run` 分类的 `TraceEntry[]`                         |
| `steps.list`       | `{ cursor?, limit?, sessionId? }`         | `step` 分类的 `TraceEntry[]`                        |
| `entries.list`     | `{ cursor?, limit?, runId?, sessionId? }` | `entry` 分类的 `TraceEntry[]`                       |
| `entries.get`      | `{ id }`                                  | 单条 `TraceEntry`；不存在时 `NOT_FOUND`             |
| `messages.get`     | `{ messageId }`                           | 已存的 `<messageId>:output` 载荷                    |
| `values.get`       | `{ id, path? }`                           | `path` 处的已存值；缺少键或非数据属性时 `NOT_FOUND` |
| `events.subscribe` | `{ afterSequence? }`                      | `AsyncGenerator<TraceEvent>`                        |
| `updates`          | 无                                        | `AsyncGenerator<TraceUpdate>`                       |

输入校验由各路由模块用 zod 表达：

- 分页输入：`cursor` 为非负整数，`limit` 为 1–300 的整数且默认 100，`sessionId` 为 1–300 字符的字符串。
- id 输入：`id` 为 1–200 字符的字符串。
- 取值路径输入：`path` 是最多 32 个、每个最多 1024 字符的键数组，且拒绝 `__proto__`、
  `constructor`、`prototype`。

`updates` 先订阅、再读快照：最多 300 条 `entry`、最多 300 条 `step`、用量快照与可见会话。后续推送
只带变化的条目与步骤；只有用量变化时同样会推送——例如后台重放追平之后。

## 客户端与连接归属

`createTraceClient` 是对 `createORPCClient` 的两行封装，它刻意不关心传输层：

```ts
function createTraceClient(link: ClientLink<Record<never, never>>): TraceClient;
```

给定任意 oRPC link，它返回本路由的类型化 `RouterClient`，除此之外不做任何事。

连接由应用负责：选择 oRPC 适配器、创建端口或套接字，并在退出时关闭。
`@orpc/client/message-port` 是其中一种适配器，随仓库附带的 Electron 应用正在使用它，但本包不依赖
它。`TraceClient` 即 `RouterClient<TraceRouter>`，上面的过程树会映射为带类型的方法，每个订阅都在
第二个参数接受 `{ signal?: AbortSignal }`。

> [!TIP]
> 取消由消费者负责。中止请求信号即可结束 `updates` 或 `events.subscribe` 生成器；宿主关闭时也会
> 中止所有订阅。

## API 参考

### `@cieljs/trace` — `src/index.ts`

| 导出                 | 类型     | 说明                                                   |
| -------------------- | -------- | ------------------------------------------------------ |
| `TraceHost`          | class    | 负责投影、持久化与广播轨迹数据的宿主                   |
| `createTraceRouter`  | function | 由宿主构建 oRPC 过程树                                 |
| `traceStorage`       | constant | 携带 `trace.records` 迁移的 `StorageModule`            |
| `createTraceClient`  | function | 把 oRPC `ClientLink` 包装成类型化 `TraceClient`        |
| `TraceRouter`        | type     | `createTraceRouter` 返回的路由对象                     |
| `TraceRouterOptions` | type     | `{ session?: (sessionId: string) => boolean }`         |
| `TraceClient`        | type     | `RouterClient<TraceRouter>`                            |
| `TraceEntry`         | type     | 一条对话条目或投影步骤                                 |
| `TraceEvent`         | type     | `@cieljs/agent-kit/protocol` 中 `RuntimeRecord` 的别名 |
| `TraceSession`       | type     | 会话时间范围、用量与进度                               |
| `TraceUpdate`        | type     | 一次订阅推送                                           |
| `TraceUsage`         | type     | `{ input, output, cacheRead, cacheWrite, total }`      |
| `TraceUsageState`    | type     | `{ total, context }`                                   |
| `ValueRef`           | type     | `{ id, path?, preview }`                               |

### `@cieljs/trace/host`

| 导出                 | 类型     | 说明                                   |
| -------------------- | -------- | -------------------------------------- |
| `TraceHost`          | class    | 同一个宿主，通过 `TraceHost.open` 打开 |
| `createTraceRouter`  | function | 同一个路由工厂                         |
| `traceStorage`       | constant | 声明 `trace` schema 迁移的存储模块     |
| `TraceRouter`        | type     | 路由实例类型                           |
| `TraceRouterOptions` | type     | 路由选项，含会话谓词                   |

### `@cieljs/trace/client`

| 导出                | 类型     | 说明                                                      |
| ------------------- | -------- | --------------------------------------------------------- |
| `createTraceClient` | function | `(link: ClientLink<Record<never, never>>) => TraceClient` |
| `TraceClient`       | type     | `RouterClient<TraceRouter>`                               |

### `@cieljs/trace/protocol`

| 导出              | 类型 | 说明                                             |
| ----------------- | ---- | ------------------------------------------------ |
| `TraceEntry`      | type | 条目与步骤的结构化记录                           |
| `TraceEvent`      | type | `RuntimeRecord` 的别名                           |
| `TraceSession`    | type | `{ id, startedAt, endedAt, usage, turn, steps }` |
| `TraceUpdate`     | type | `{ entries, steps, usage, sessions }`            |
| `TraceUsage`      | type | 单次请求的 token 计数                            |
| `TraceUsageState` | type | 累计用量与当前上下文                             |
| `ValueRef`        | type | 惰性载荷引用                                     |

`TraceStore` 位于 host 入口的实现中，但没有任何入口再导出它；请通过 `host.store` 访问。

## 设计取舍

归属在宿主这边。宿主从不创建 `Storage`、Agent 或传输层：应用打开存储、交给 `TraceHost.open`，并自行持有 oRPC link 及其生命周期。这也是 client 入口接收 `ClientLink` 而不是连接参数的原因。

系统里有两套序号。条目使用宿主分配的条目序号，让对话顺序与宿主观测可以交错；步骤与原始事件沿用运行时事件序号，分页与 `afterSequence` 用的是后者。重放会沿用已有记录的原顺序，不会把它们挤到更新的消息之后。

分页基于游标。`limit` 与 `cursor` 映射为 `sequence < cursor` 的倒序查询，随后把该页反转成升序；由于游标是序号值，翻页期间新写入的记录不会挤占历史页的位置。

用量由宿主统计。`TraceUsageTally` 只对每条 assistant 消息的 `message_end` 求和一次，因此流式增量不会被重复计入；`session_compaction` 会把当前上下文降为摘要估算，直到下一次真实请求覆盖它。累计用量属于投影状态的一部分，所以宿主重启后依然连续。

投影失败具有粘性：失败的批次会被记录、打日志，并通过 `assertHealthy()` 重新抛出，`updates` 路由再把它转成 `INTERNAL_SERVER_ERROR`，界面因此会报错，而不是静默停在旧数据上。

值在序列化前先做归一化——函数变成 `'[Function]'`，访问器变成 `'[Getter / Setter]'`，循环引用被保留而不是抛错，`Map`、`Set`、`Date`、`Error`、`ArrayBuffer` 与类型化数组原样保留。记录值以 `v8.serialize` 字节存放，投影状态则是 JSON；投影状态带版本（`version: 2`）并记录 `process.versions.v8`，运行时变化会让它失效并触发重建，而不是去信任一份不匹配的载荷。

`values.get` 沿自有属性描述符前进，拒绝一切非纯数据属性，因此路径永远无法触发 getter 或进入原型链。更新按 60 毫秒合并推送，而原始事件立即落盘；由于推送携带的是条目摘要，被淘汰的条目仍可按 id 或游标完整读取。

## 开发

本包声明的脚本：

| 脚本             | 命令           | 作用                    |
| ---------------- | -------------- | ----------------------- |
| `check`          | `vp check`     | 格式化、lint 与类型检查 |
| `prepublishOnly` | `vp run build` | 发布前构建              |

`vite.config.ts` 中的 Vite+ 任务图定义了 `build`（`vp pack`，依赖依赖项的 `build` 任务）与 `test`
（`vp test`）。打包配置产出四个入口——`index`、`host`、`client`、`protocol`——并生成声明文件。
测试超时为 15 秒且关闭文件级并行，请在包目录下运行：

```sh
vp install
vp run test
vp check
```

`src/host/` 下的测试覆盖流式归并、按需内容读取、非法分页拒绝、用量统计、重放与重建，以及通过
oRPC MessagePort 的订阅生命周期。
