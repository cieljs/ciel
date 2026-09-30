<h1 align="center">@cieljs/storage</h1>

<p align="center">一个进程一个 PGlite：每个功能独占一个 schema，各自带着自己的迁移账本。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概览">概览</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#模块与迁移">模块</a> ·
  <a href="#运行时流水">流水</a> ·
  <a href="#借用与生命周期">生命周期</a> ·
  <a href="#checkpoint">Checkpoint</a> ·
  <a href="#api">API</a>
</p>

## 概览

Ciel 的所有数据都放在一个 PGlite（进程内 PostgreSQL）实例里，`@cieljs/storage` 就是这个实例的主人。其他地方不再自己开库：Session、Memory、Vector 和 Trace 各自注册一个**模块**，模块的表放在自己的 PostgreSQL schema 里。

同一个实例还负责运行时流水。`storage.events` 是一张只追加的表，记录 Pi 的 `AgentEvent` 以及宿主事件（比如会话压缩）。功能模块可以在写入事件的同时，用同一个事务写下自己的读模型——这样读到的东西不会和真实发生过的事情脱节。

```text
Storage（一个 PGlite 实例）
├── storage.events        运行时流水、关联 ID、投影
├── session.*             模块：@cieljs/session
├── memory.*              模块：@cieljs/memory
├── vector.*              模块：@cieljs/vector
└── trace.*               模块：@cieljs/trace
```

往下读之前，先把四个名字理顺。`Storage` 是实例本身：打开数据库、提供 `db` 与 `journal`、推进 checkpoint 并负责关闭。`StorageModule` 是功能模块的自我声明——一个 `id`（同时也是它的 schema 名称）和按顺序排列的 `migrations`。`storage.events` 是事实表。`RuntimeJournal`（也就是 `storage.journal`）负责往里写：接收 `RuntimeEvent`、分配关联 ID、对重复提交去重，并唤醒订阅者。

## 安装

```bash
pnpm add @cieljs/storage
```

在本仓库里，依赖方用 `workspace:` 协议声明它，例如 `packages/vector/package.json`：

```json
{
  "dependencies": {
    "@cieljs/storage": "workspace:*"
  }
}
```

本包是纯 ESM，只暴露一个入口（`"."` → `dist/index.mjs`）。PGlite 跑在进程内，所以没有要启动的数据库服务、没有连接串、也没有迁移 CLI；仓库根目录要求 `node >= 24.11.1`。

## 快速开始

```ts
import { Storage } from '@cieljs/storage';
import { SessionManager, sessionStorage } from '@cieljs/session';
import { MemoryManager, memoryStorage } from '@cieljs/memory';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage, memoryStorage],
});
await using sessions = await SessionManager.open({ storage, namespace: 'session' });
await using memory = await MemoryManager.open({ storage });
```

`await using` 会按声明顺序的逆序释放，所以借用方先关、`Storage` 最后关，详见[借用与生命周期](#借用与生命周期)。

打开数据库会依次创建 `vector` 与 `pg_trgm` 扩展、`storage` schema 与 `storage.events` 表，最后是每个模块自己的 schema。传 `dataDir: 'memory://'` 可以得到一次性的内存数据库，测试就是这么用的。

## 模块与迁移

一个模块就是 `{ id, migrations }`，没有别的。`id` 同时是 PostgreSQL schema 名称，因此必须匹配 `^[a-z][a-z0-9_]*$`、在 `modules` 中唯一，并且不能叫 `storage`——那个名字属于流水。`dataDir` 为空，或模块 id 非法、重复、被占用时，`Storage.open()` 会抛出 `TypeError`。

```ts
import type { StorageModule } from '@cieljs/storage';

export const notesStorage: StorageModule = {
  id: 'notes',
  migrations: [
    {
      id: '0001',
      sql: 'CREATE TABLE notes.items (id text PRIMARY KEY, body text NOT NULL)',
    },
  ],
};
```

每个模块的迁移都在一个事务里完成：先建 `"<id>"` 和 `"<id>".__migrations (id text PRIMARY KEY, sql text NOT NULL)`，然后按声明顺序遍历 `migrations`。如果某个 `id` 已经记录过且 `sql` 相同就跳过，记录过的 `sql` 不同就抛 `迁移内容已修改: <module>/<migration>`，其余情况执行并把 `sql` 记下来。

> [!WARNING]
> 已经应用的迁移不可修改。记录下来的 SQL 会逐字节比较，所以改动跑过的迁移会让下一次 `Storage.open()` 直接失败——请新增一条迁移。

模块之间互不打扰。每个模块在自己的 schema 里拥有独立的 `__migrations` 表，`modules` 的声明顺序不会影响后续 `open()` 的结果，重复打开同一个 `dataDir` 也是幂等的。

### 新库从当前基线开始

`open()` 只创建缺失的东西。新数据库直接从当前基线开始，没有回放或复制旧库内容这条路。

### 迁移失败时

整个打开过程跑在一个 `AsyncDisposableStack` 里，只有所有模块都成功才用 `move()` 交出所有权。某个迁移抛错时，该模块的事务回滚（测试会断言那个只建了一半的 schema 不存在），本次尝试打开的 PGlite 客户端也会被关闭。

## 运行时流水

`storage.journal` 是一个 `RuntimeJournal`，也是唯一只追加的事实流。给它一个 `RuntimeEvent`——Pi 的 `AgentEvent`，或 `session_compaction` 这样的宿主事件——它返回一条 `RuntimeRecord`。

```ts
import { Storage } from '@cieljs/storage';

await using storage = await Storage.open({ dataDir: '.ciel/storage' });

const record = await storage.journal.record('session-1', {
  type: 'message_end',
  message: { role: 'user', content: 'hello', timestamp: Date.now() },
});

console.log(record.sequence, record.runId, record.messageId);
```

### 关联 ID

这些 ID 在消息生成时分配，而不是在落库时：

| 事件              | 效果                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `agent_start`     | 开启新的 `runId`，清空 `turnId`、`messageId` 与工具调用映射                    |
| `turn_start`      | 开启新的 `turnId`                                                              |
| `message_start`   | 开启新的 `messageId`——任何第一条 `message_*` 事件都会如此                      |
| assistant message | 把每个 `toolCall` 块 id 映射到当前 `messageId`，后续工具事件因此归到同一条消息 |
| `message_end`     | 清空 `messageId`                                                               |
| 工具事件          | 带上其 `toolCallId` 所属的 `messageId`（若此前见过）                           |

事件在入队前会用 `structuredClone()` 做一次快照，因为流式事件在模型还在生成时会被原地修改。

### 投影与事件同一个事务

`record()` 可以传第四个参数：一个投影回调，它**和写入 `storage.events` 在同一个事务里**执行。

```ts
import { sql } from '@cieljs/storage';

await storage.journal.record('session-1', event, {}, async (transaction, record) => {
  await transaction.execute(
    sql`INSERT INTO session.message_links (id, event_id) VALUES (${id}, ${record.id})`,
  );
});
```

两边要么都写成功，要么都不写，因此读模型永远不会和事件流水对不上。投影抛错时事件插入一起回滚，`journal.flush()` 会把第一次失败的写入错误重新抛出。

读回消息正文走的就是这条路：功能模块在同一个事务里投影自己需要的内容，再通过自己的视图读取。`session.session_messages` 就是这样一个视图——它把会话的关联表连到 `storage.events`，取出 `record->'event'->'message'`。

### 同一个事件提交两次

流水用 `WeakMap` 记住某个事件对象加会话的第一次写入 promise。再提交同一个对象时返回原来的记录，而不是追加第二行。如果这次重复提交也带了 `project`，投影仍会在自己的事务里对已存记录执行一次，所以第二个观察者可以补上自己的投影，而事件不会被重复写入。

### 读取与订阅

```ts
const records = await storage.journal.read(after, 100); // sequence > after，按 sequence 升序
const unsubscribe = storage.journal.subscribe(() => {
  // 醒来后从自己持久化的游标继续读
});
```

- `read(after = 0, limit = 100)` 按 `sequence` 升序返回。
- `subscribe(listener)` 只是唤醒信号，不保证投递，返回取消订阅的函数。消费者应当从自己持久化的游标读取，这样断开期间的内容不会丢——这正是 [@cieljs/agent-kit](../agent-kit/README.zh-CN.md) 里 `RuntimeReader` 的约定。
- `flush()` 排空写入队列，并把第一个失败重新抛出。
- `close()` 标记流水关闭、排空队列、清空监听者。之后再 `record()` 会以 `RuntimeJournal 已关闭` 拒绝。

## 借用与生命周期

一个进程树只有一个 `Storage`，谁需要谁借用。

借用方先关：Manager 和 `TraceHost` 持有 storage 引用，必须在它之前关闭，而关闭 Manager 从不关闭数据库。`Storage` 由宿主最后关闭。

借用方用 `storage.require(module)` 确认自己还合法。`close()` 开始后会抛 `Storage 已关闭`；模块从未传给 `Storage.open()` 时抛 `Storage 未注册模块: <id>`。

`Storage.close()` 是幂等的——重复调用和 `Symbol.asyncDispose` 共享同一个 promise。它先关闭流水（等待排队中的写入），对落盘数据库执行最后一次 `CHECKPOINT`，然后关闭 PGlite 客户端。关闭进行中 `journal.record()` 会拒绝，迟到的生产者会直接报错，而不是往正在关闭的数据库里写。

## Checkpoint

PGlite 没有后台 checkpointer。开发时重启、Ctrl+C 杀掉进程之后，下一次启动要回放上次 checkpoint 以来的全部 WAL。`storage.checkpoint()` 可以按需执行 `CHECKPOINT`，所以定时调用的宿主能把恢复窗口压到一个周期，而不是整段运行时间。

`close()` 之后再调 `checkpoint()` 是空操作：与关闭竞争的一次周期调用既不能抛错，也不能把连接复活。`dataDir` 以 `memory://` 开头时，`Storage.open()` 会跳过最后一次 checkpoint。

## API

| 导出             | 类型          | 说明                                                                                                                           |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Storage`        | class         | `Storage.open({ dataDir, modules })`；字段 `db`、`journal`；方法 `require()`、`checkpoint()`、`close()`、`Symbol.asyncDispose` |
| `StorageModule`  | type          | `{ id: string; migrations: readonly { id: string; sql: string }[] }`                                                           |
| `StorageOptions` | type          | `{ dataDir: string; modules?: readonly StorageModule[] }`                                                                      |
| `Database`       | type          | 由 PGlite 客户端构建出的 Drizzle 数据库类型                                                                                    |
| `Transaction`    | type          | 传给 `db.transaction()` 回调和流水投影的事务句柄                                                                               |
| `RuntimeJournal` | class         | 构造函数接收 `Database`；提供 `record()`、`read()`、`subscribe()`、`flush()`、`close()`                                        |
| `runtimeRecords` | Drizzle table | `storage.events`，给用 Drizzle 而不是原生 SQL 的查询使用                                                                       |
| `sql`            | re-export     | 转出 `drizzle-orm` 的 `sql` 辅助函数，依赖方不必自己再引一次                                                                   |

`RuntimeJournal` 实现了 [@cieljs/agent-kit](../agent-kit/README.zh-CN.md) `/protocol` 的 `RuntimeReader` 与 `RuntimeWriter`，投影回调是它额外的能力。

## 行为与设计约定

- **一个库，一个功能一个 schema。** 隔离靠 schema 加上独立的 `__migrations` 账本，因此新增、删除或调整顺序都不会碰到别人。
- **写入是串行的。** `record()` 接在同一条待处理 promise 后面，事件按提交顺序落表；每条在自己的事务里用 `nextval(pg_get_serial_sequence('storage.events', 'sequence'))` 取 `sequence`，因此值唯一；`storage.events` 上有 `(session_id, sequence)` 索引供按会话读取。
- **存的是快照，不是引用。** 流水保存 Pi 的事件快照，从不重新生成内容。完整的流式事件都会保留，目前既没有保留策略也没有压缩。
- **投影失败就是写入失败。** 事件行和投影共用同一个事务，基于回放的消费者才能信任一个游标。
- **`storage` 保持保留。** 流水的 schema 不能被当作模块 id 占用，功能模块也就不可能误把事实流迁移掉。

## 开发

```bash
vp install      # 拉取代码后
vp check        # 格式化、lint 与类型检查
vp test --run   # 单元测试
vp run build    # 构建本包
```

`src/storage.test.ts` 里的测试跑在真实的临时目录上，覆盖迁移隔离与幂等重开、迁移失败的回滚与清理、按需 checkpoint、事件与投影的原子提交、sequence 持久化、重复提交以及关闭顺序。

`packages/storage/package.json` 里没有 `scripts`。`build`（`vp pack`）和 `test` 两个任务来自 `vite.config.ts` 的 `run.tasks`，所以要用 `vp run` 调用。
