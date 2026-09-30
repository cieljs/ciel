<h1 align="center">@cieljs/memory</h1>

<p align="center">严格分层、保留版本历史，并能沿来源发现相关空间的长期记忆。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概览">概览</a> ·
  <a href="#核心概念">核心概念</a> ·
  <a href="#安装">安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#更新与遗忘">更新与遗忘</a> ·
  <a href="#检索">检索</a> ·
  <a href="#agent-工具">Agent 工具</a> ·
  <a href="#api-参考">API 参考</a> ·
  <a href="#行为说明与设计取舍">设计取舍</a> ·
  <a href="#开发">开发</a>
</p>

## 概览

`@cieljs/memory` 在 [`@cieljs/storage`](../storage/README.zh-CN.md)（PGlite + Drizzle + pgvector）之上保存长期记忆。它维护三个层级，每次更新都保存完整快照，并把正文检索与来源检索拆成两个独立入口。

作用范围绑定在对象上，而不是靠参数传。`manager.global` 是全局长期记忆层，`manager.space(id)` 返回绑定空间的对象，Space API 从不隐式合并全局记忆或别的空间。每次更新都是一个 revision：`update()` 写入下一份完整快照并把逻辑记忆的 current revision 往前推，因此旧正文、旧来源和全部历史 revision 始终可读。来源就是字符串——`MemorySource` 是 `string`，包负责规范化、精确匹配和文本检索，但不解释它的业务含义。跨空间访问是显式且只读的：全库读取只存在于 `MemoryManager` 和单独授权的 Agent 工具集里，普通写入工具始终绑定单个空间。索引是异步的，所以事务一提交，正文就已经能被 `get()`、`list()`、全文检索和来源检索看到，embedding 由后台补齐。

| 入口                          | 目标                     | 内容                     |
| ----------------------------- | ------------------------ | ------------------------ |
| `@cieljs/memory`              | `./dist/index.mjs`       | 存储、检索和生命周期 API |
| `@cieljs/memory/agent`        | `./dist/agent/index.mjs` | Agent 工具与上下文准备   |
| `@cieljs/memory/package.json` | `./package.json`         | 包元数据                 |

Schema、数据库连接、检索实现、索引任务和内部校验器不作为公开子路径导出。

> [!NOTE]
> 第一版不包含自动记忆整理。新记忆属于 `space.daily`、`space.long_term` 还是 `global.long_term`，由调用者或 Agent 显式决定。

## 核心概念

### 三个层级

| Layer              | `spaceId` | `date` | 用途                               |
| ------------------ | --------- | ------ | ---------------------------------- |
| `global.long_term` | `null`    | `null` | 跨空间成立的稳定事实与偏好         |
| `space.long_term`  | 非空      | `null` | 只在一个空间内长期成立的事实       |
| `space.daily`      | 非空      | 有值   | 一个空间在某天发生的事件与短期状态 |

只有这些组合是合法的，数据库以 `CHECK` 约束保证。`spaceId` 是业务定义的不透明字符串：包只要求它非空，不解析其格式和含义。

```ts
type MemoryLayer = 'global.long_term' | 'space.long_term' | 'space.daily';
type SpaceMemoryLayer = 'space.long_term' | 'space.daily';
type MemoryKind = 'event' | 'fact' | 'preference' | 'summary';
type MemoryStatus = 'active' | 'archived';
type MemorySource = string;
```

一条 `MemoryEntry` 表示某个逻辑记忆的当前 revision：

```ts
interface MemoryEntryFields {
  id: string;
  revision: number;

  kind: MemoryKind;
  content: string;
  sources: MemorySource[];

  status: MemoryStatus;

  occurredAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
```

`MemoryEntry` 以 `layer` 作为判别字段：只有全局层的 `spaceId` 是 `null`，只有 `space.daily` 的 `date` 非空。`MemoryEntryFor<Layer>` 把条目收窄到单个层级，`SpaceMemoryEntry` 是两个空间层的联合。

省略 `kind` 时，`space.daily` 默认为 `'event'`，两个长期层默认为 `'fact'`。

### 来源

来源只参与追溯和检索：

```ts
await space.daily.remember({
  content: '今天讨论了新的游戏模式',
  sources: ['bilibili:room:21452505', '主播昵称', '主播旧昵称', '今晚第一次挑战新模式'],
});
```

建议业务对稳定标识使用带命名空间的字符串，例如 `session:conversation-1`、`message:message-42`、`bilibili:room:21452505` 或 `event:agreement-42`。包不解释前缀，只把完整字符串当作可精确匹配、可全文检索的来源；可读名称、标题和别名同样是合法来源。

每次写入 sources 时，包统一执行：

1. 对每个 source 做 Unicode `NFKC` 规范化；
2. 去除首尾空白；
3. 丢弃空字符串；
4. 按规范化值去重，保留第一次出现的顺序和展示文本；
5. 校验单项长度、数组数量和总字节数。

| 限制             | 数值   |
| ---------------- | ------ |
| 单条记忆来源数量 | 32     |
| 单个来源字符数   | 512    |
| 来源总字节数     | 32 KiB |

### Revision

逻辑记忆拥有稳定 `id` 和递增的 `revision`。`remember()` 始终创建一条新的逻辑记忆，初始 revision 为 `1`，不会与已有正文或来源合并。`update()` 不覆盖旧正文，而是追加一份完整快照并重新指向：

```text
memory-1 / revision 1 / 旧内容
memory-1 / revision 2 / 新内容
```

更新事务按固定顺序执行：锁定逻辑记忆，校验 scope、状态和 `currentRevision`，读取当前完整 revision，合并 patch，插入下一条 revision，更新 `currentRevision` 与 `updatedAt`，重建当前 revision 的检索索引，提交事务。

`id`、`layer`、`spaceId`、`date`、`occurredAt` 和 `createdAt` 是身份字段，`update()` 永远不能修改它们。如果这些字段需要改变，应创建新记忆并遗忘旧记忆。

### 空间

`manager.space(spaceId)` 返回绑定对象；空或纯空白的 `spaceId` 会抛出 `MemoryValidationError`。空间级的 `get()`、`list()`、`search()`、`update()`、`forget()`、`history()` 和 `getRevision()` 严格限制在当前空间，不会回退到全局或全库读取。

Memory 不维护独立的 space 注册表：没有任何记忆的空间在发现时不存在，并且每次调用 `manager.space(id)` 都返回一个新的绑定对象，而不是缓存对象。

### 每日日期

`space.daily` 可以显式传入 `YYYY-MM-DD` 日期。省略时，包先使用 `occurredAt`，两者都省略时使用当前时间，再按 manager 配置的 `timeZone`（默认 `Asia/Shanghai`）计算日期。长期层传入 `date` 会抛出 `MemoryValidationError`。

## 安装

```bash
pnpm add @cieljs/memory @cieljs/storage
```

需要向量检索时再安装向量服务：

```bash
pnpm add @cieljs/vector
```

`MemoryManager.open()` 会调用 `storage.require(memoryStorage)`，因此 `memoryStorage` 必须通过 `Storage.open({ modules: [...] })` 注册。`EmbeddingProvider` 和 `EmbeddingOptions` 已从 `@cieljs/model-kit` 重新导出，使用这些类型不需要额外引入该包。

> [!NOTE]
> 工作区要求 Node `>= 24.11.1`。时间戳以 `timestamp with time zone` 保存，日期以 PostgreSQL `date` 保存，包通过 PGlite 读写它们。

## 快速开始

```ts
import { Storage } from '@cieljs/storage';
import { MemoryManager, memoryStorage } from '@cieljs/memory';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [memoryStorage],
});
await using memories = await MemoryManager.open({
  storage,
  timeZone: 'Asia/Shanghai',
});

const space = memories.space('blive:room:21452505');

// 全局长期记忆：跨空间成立的稳定事实与偏好。
await memories.global.remember({
  content: '用户偏好简洁且自然的表达',
  sources: ['session:conversation-1'],
});

// 空间长期记忆：只在这个空间内成立的知识。
await space.longTerm.remember({
  content: '这个直播间经常讨论独立游戏',
  sources: ['bilibili:room:21452505', '主播昵称'],
});

// 空间每日记忆：当天事件与短期状态。
await space.daily.remember({
  content: '今天主播开始体验新的独立游戏',
  sources: ['bilibili:room:21452505', '今晚第一次挑战新模式'],
});
```

`MemoryManagerOptions`：

| 选项           | 默认值               | 说明                                                       |
| -------------- | -------------------- | ---------------------------------------------------------- |
| `storage`      | —                    | 必填。必须已注册 `memoryStorage`。                         |
| `timeZone`     | `'Asia/Shanghai'`    | 用于计算每日日期的 IANA 时区，无效值会抛出异常。           |
| `vectors`      | —                    | 传入 `VectorService` 才会启用向量索引和 `mode: 'vector'`。 |
| `tokenize`     | `tokenizeSearchText` | 正文索引与查询共用的分词规则。                             |
| `onIndexError` | —                    | 接收索引错误；不传时用 `console.warn` 报告。               |

注意两种层级的写法差异：全局对象本身就是长期记忆层（`memories.global.remember(...)`，没有 `global.longTerm`），而空间显式提供 `longTerm` 和 `daily`，目标层级始终由调用的对象固定。

读取也从相同的绑定对象开始：

```ts
const memory = await space.get(memoryId);

const recent = await space.list({
  layers: ['space.daily'],
  dateFrom: '2024-05-01',
  dateTo: '2024-05-31',
  limit: 50,
});
```

`list()` 按 `occurredAt DESC, id ASC` 排序，默认 `limit: 50`、`offset: 0`，并支持 `kind`、`dateFrom`、`dateTo`、`layers`、`includeArchived` 和 `includeExpired`。

## 更新与遗忘

更新只提交变化字段和调用者做判断时依据的 revision。数据库会创建下一份完整快照，旧内容仍可通过历史 API 读取。

```ts
const current = await space.get(memoryId);

if (current) {
  await space.update(current.id, {
    expectedRevision: current.revision,
    content: '修正后的完整内容',
  });

  const history = await space.history(current.id, { limit: 20 });
  const firstRevision = await space.getRevision(current.id, 1);
}
```

- `content` 是更新后的完整正文，不是文本 diff；没有提交的字段保持当前 revision 的值。
- `sources` 一旦传入就是整体替换，不做隐式合并。
- `content`、`kind`、`expiresAt`、`sources` 至少提供一个，否则抛出 `MemoryValidationError`。
- `expiresAt: null` 会清除过期时间。
- `expectedRevision` 必须是真正读取到的版本；已过期时更新失败并抛出 `MemoryConflictError`，调用者应重新读取最新记忆再判断。包不会自动把两个冲突正文合并。
- `history(id, { limit = 20, beforeRevision })` 按 revision 从新到旧返回，`getRevision(id, revision)` 返回指定的单份快照或 `null`；两者对已归档记忆同样有效。

遗忘是软归档：

```ts
await space.forget(current.id, { expectedRevision: current.revision });
```

`forget()` 把 `status` 改为 `'archived'` 并记录 `archivedAt`。记忆会从默认读取和默认的内容/来源检索中消失，但全部 revision、来源、chunk 和向量都会保留。确实需要归档记录的宿主可以在单次读取时显式传入 `includeArchived: true`，Agent 工具不会这样做。第一版不提供 `purge()`，也没有恢复 API。

> [!WARNING]
> `update()` 和 `forget()` 都要求 `expectedRevision`，并且都会以 `MemoryArchivedError` 拒绝已归档记忆。猜测版本号不是捷径——要么冲突，要么改到错误的状态上。

## 检索

正文检索和来源检索是两个独立入口：`search()` 匹配正文 `content`，`searchBySource()` 匹配 `sources` 数组。除来源检索显式开启历史外，两者都只检索当前 revision，并且默认过滤已归档和已过期记录。

### 正文检索

```ts
const hits = await space.search('独立游戏', {
  mode: 'hybrid',
  limit: 8,
});
```

| `mode`           | 行为                                                     | 适用场景                       |
| ---------------- | -------------------------------------------------------- | ------------------------------ |
| `hybrid`（默认） | 融合 `full_text`、`trigram` 和 `vector` 三路结果         | 通用召回                       |
| `full_text`      | 对分词后的 chunk 做 PostgreSQL 全文检索                  | 明确关键词                     |
| `trigram`        | pg_trgm 相似度配合 `LIKE` 包含匹配                       | 短文本、部分匹配和轻微差异     |
| `vector`         | 对 ready 向量做余弦相似度，受 `minVectorSimilarity` 限制 | 语义相关内容（需要 `vectors`） |

| 选项                  | 默认值     | 说明                                              |
| --------------------- | ---------- | ------------------------------------------------- |
| `mode`                | `'hybrid'` | 上述四种模式之一。                                |
| `kind`                | —          | 按 `MemoryKind` 过滤。                            |
| `limit`               | `10`       | 融合后返回的命中条数，取值 1–1000。               |
| `offset`              | `0`        | 在融合之后应用。                                  |
| `candidateLimit`      | `50`       | 每路融合前的候选上限。                            |
| `minVectorSimilarity` | `0.35`     | 必须落在 `-1..1`，否则抛出 `TypeError`。          |
| `layers`              | 全部层级   | `space.search()` 默认并只接受它自己的两个空间层。 |
| `dateFrom` / `dateTo` | —          | `YYYY-MM-DD`，与保存的 `date` 比较。              |
| `includeArchived`     | `false`    | 是否包含已归档记忆。                              |
| `includeExpired`      | `false`    | 是否包含 `expiresAt` 已过期的记忆。               |
| `signal`              | —          | `AbortSignal`，每路检索前检查。                   |

hybrid 的分数基于排名而非概率：某一路的第 n 条命中贡献 `1 / (60 + n)`，`trigram` 贡献 `0.7 / (60 + n)`；同一记忆在多路命中时分数相加，命中的路记录在 `matches` 中。`score` 只用于排序，分数相同时按 `occurredAt DESC, id ASC` 稳定排序。

历史正文被刻意排除在语义检索之外：`search()` 永不返回旧 revision，模型不会同时召回同一条事实的两个冲突版本。

### 配置向量检索

```ts
import { Storage } from '@cieljs/storage';
import { MemoryManager, memoryStorage } from '@cieljs/memory';
import { VectorService, vectorStorage } from '@cieljs/vector';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [memoryStorage, vectorStorage],
});
await using vectors = new VectorService({
  storage,
  provider: { model: 'text-embedding-model', dimensions: 1024, embedBatch },
  providerId: 'provider',
  revision: '1',
  granularity: 'chunk',
  inputConfig: 'raw',
});
await using manager = await MemoryManager.open({ storage, vectors });
```

正文写入和 revision 更新在事务提交后即可被普通读取、全文检索和来源检索看到，embedding 异步执行。没有配置 `VectorService` 时，`vector` 返回空结果，`hybrid` 仍使用全文和 trigram；`hybrid` 中失败的向量分支通过 `onIndexError` 上报，不会让整次检索失败。

### 来源检索

```ts
const exact = await manager.searchBySource('bilibili:room:21452505', { mode: 'exact' });
const text = await manager.searchBySource('主播昵称', { mode: 'text' });
```

| `mode`         | 行为                                                      |
| -------------- | --------------------------------------------------------- |
| `auto`（默认） | 先精确匹配再文本检索，同一记忆取更高分                    |
| `exact`        | 完整 source 元素匹配，适合稳定业务标识                    |
| `text`         | 对合并后的来源做全文和 trigram 检索，适合名称、标题和别名 |

选项包括 `includeHistory`（默认 `false`；开启后结果带有准确 `revision`，需要用 `getRevision()` 读取正文）、`layers`、`limit`（默认 `10`）、`offset`（默认 `0`）、`includeArchived`、`includeExpired` 和 `signal`。每条结果包含 `memoryId`、`revision`、`spaceId`、`layer`、`date`、`matchedSources`、最长 400 字符的 `excerpt` 和 `score`。

结果同时给出 `spaceId + memoryId + revision`，因此不必先聚合 space 也能直接读取具体记忆：

```ts
const hits = await manager.searchBySource('主播昵称', { mode: 'text' });
const hit = hits[0];

if (hit?.spaceId) {
  const memory = await manager.space(hit.spaceId).get(hit.memoryId);
}
```

### 发现相关空间

`findSpacesBySource()` 复用来源检索并按 `spaceId` 聚合：

```ts
const relatedSpaces = await memories.findSpacesBySource('主播昵称');

for (const related of relatedSpaces) {
  const hits = await memories.space(related.spaceId).search('之前对这个游戏有什么看法');
}
```

| 选项     | 默认值     | 说明                                 |
| -------- | ---------- | ------------------------------------ |
| `mode`   | `'auto'`   | 与来源检索相同的模式。               |
| `layers` | 两个空间层 | `space.long_term` 和 `space.daily`。 |
| `limit`  | `10`       | 返回的空间数量，不是记忆数量。       |
| `signal` | —          | `AbortSignal`。                      |

发现过程最多扫描 1000 条来源命中，每个空间只保留一条、取最高分，合并匹配来源，附带这些命中带来的具体记忆引用（`id`、`revision`、`layer`、`excerpt`），并按分数降序、再按 `spaceId` 排序。全局层命中会被跳过，没有任何记忆的空 space 不会出现。发现始终排除已归档和已过期记忆。

### 全库读取

`MemoryManager` 另外提供管理端读取，这些方法不会从 space 对象隐式回退触达：

| 方法                                  | 范围                           |
| ------------------------------------- | ------------------------------ |
| `getAny(id, options?)`                | 任意层级、任意空间。           |
| `searchAll(query, options?)`          | 三个层级，可用 `layers` 收窄。 |
| `searchBySource(query, options?)`     | 默认三个层级。                 |
| `findSpacesBySource(query, options?)` | 全库范围的空间发现。           |

## Agent 工具

Agent 相关 API 位于第二个入口：

```ts
import { globalMemoryTools, loadMemoryContext, memoryTools } from '@cieljs/memory/agent';
```

### 当前空间工具

```ts
const tools = memoryTools({
  space,
  sources: ['session:conversation-1', 'bilibili:room:21452505'],
});
```

`memoryTools()` 绑定宿主传入的 `SpaceMemory`，所以工具参数中不含 `spaceId`。每日和长期记忆使用两个不同的 remember 工具，Agent 不需要传数据库 layer 字符串。

| Tool                                      | 行为                                                |
| ----------------------------------------- | --------------------------------------------------- |
| `search_current_space_memory`             | 检索绑定空间的每日与长期记忆正文                    |
| `search_current_space_memory_by_source`   | 只匹配绑定空间的 `sources`                          |
| `read_current_space_memory`               | 按 id 分页读取一条记忆                              |
| `remember_current_space_daily_memory`     | 在绑定空间创建 `space.daily` 记忆                   |
| `remember_current_space_long_term_memory` | 在绑定空间创建 `space.long_term` 记忆               |
| `update_current_space_memory`             | 带 revision 校验的更新（必须传 `expectedRevision`） |
| `archive_current_space_memory`            | 软归档；返回 `{ id, archived: true }` 并保留历史    |

后四个工具默认创建，显式关闭时不出现。工具名直接表达范围：`current_space` 是当前绑定空间，`discovered_space` 是允许只读探索的已发现空间，`global` 仅指全局长期记忆，`all` 包含全局层和全部空间，`by_source` 匹配来源，普通 search 匹配正文。

### 选项

| 选项               | 默认值     | 说明                                          |
| ------------------ | ---------- | --------------------------------------------- |
| `space`            | —          | 必填，绑定好的 `SpaceMemory`。                |
| `sources`          | —          | 静态 `string[]` 或 `MemorySourceProvider`。   |
| `sourcesMode`      | `'append'` | 设为 `'replace'` 时更新会整体替换来源。       |
| `rememberDaily`    | 开启       | 设为 `false` 时不提供每日写入工具。           |
| `rememberLongTerm` | 开启       | 设为 `false` 时不提供空间长期写入工具。       |
| `update`           | 开启       | 设为 `false` 时不提供更新工具。               |
| `forget`           | 开启       | 设为 `false` 时不提供归档工具。               |
| `searchLimit`      | `8`        | 取值 1–20，检索工具的默认 `limit`。           |
| `maxReadChars`     | `12000`    | 取值 1–100000，读取的分页大小和预览截断上限。 |
| `crossSpace`       | —          | `{ manager, access }`，显式开启跨空间检索。   |

### 写入工具参数

```ts
// remember_current_space_daily_memory
{ content: string; kind?: MemoryKind; date?: string; occurredAt?: string; expiresAt?: string }

// remember_current_space_long_term_memory
{ content: string; kind?: MemoryKind; occurredAt?: string; expiresAt?: string }

// update_current_space_memory
{ id: string; expectedRevision: number; content?: string; kind?: MemoryKind; expiresAt?: string | null }

// archive_current_space_memory
{ id: string; expectedRevision: number }
```

`content` 最长 16000 字符，`date` 必须符合 `YYYY-MM-DD`，`expiresAt: null` 清除过期时间。Agent 不能提交 `sources`，由宿主以静态数组或每次调用时执行的 provider 注入：

```ts
const tools = memoryTools({
  space,
  sources: ({ toolCallId, action }) => [
    `session:${sessionId}`,
    `tool-call:${toolCallId}`,
    `action:${action}`,
  ],
});
```

provider 收到 `{ toolCallId, action: 'remember' | 'update', signal }`。`sourcesMode: 'append'`（默认）把注入来源追加到旧来源，返回空数组不改变旧来源；`sourcesMode: 'replace'` 用返回数组整体替换旧来源，因此空数组会清空旧来源。

读取工具按页读取正文：首次 `offset: 0`，之后原样传入返回的 `nextOffset`，直到 `null` 表示读完。正文检索结果给出 `memory.id`，来源检索结果给出 `memoryId`，两者都可以作为读取工具的 `id` 参数。更新前必须用同范围的读取工具取得完整正文和最新 `revision`，并用它作为 `expectedRevision`；搜索片段不能直接当作完整正文覆盖旧版本。

### 跨空间只读访问

跨空间访问需要显式开启，并且全部只读。不传 `crossSpace` 时，检索、读取和写入都只作用于绑定空间，没有全库回退。

| 配置                | 跨空间能力                         | 是否包含全局层                               |
| ------------------- | ---------------------------------- | -------------------------------------------- |
| 不传 `crossSpace`   | 无，只访问当前空间                 | 否                                           |
| `access: 'related'` | 按来源发现空间，再搜索、读取该空间 | 否                                           |
| `access: 'all'`     | 额外允许直接搜索、读取全部记忆     | 是，通过 `search_all_*` 与 `read_any_memory` |

```ts
import { memoryTools } from '@cieljs/memory/agent';

const localTools = memoryTools({ space });

const relatedTools = memoryTools({
  space,
  crossSpace: { manager, access: 'related' },
});

const allTools = memoryTools({
  space,
  crossSpace: { manager, access: 'all' },
});
```

当前空间的七个工具保持原范围，跨空间配置在此之上增加以下工具：

| Tool 名称                                  | 可用配置         | 行为                                                          |
| ------------------------------------------ | ---------------- | ------------------------------------------------------------- |
| `find_memory_spaces_by_source`             | `related`、`all` | 按记忆的 `sources` 发现空间；不搜索正文或全局层，不枚举空空间 |
| `search_discovered_space_memory`           | `related`、`all` | 在指定已发现 `spaceId` 内检索正文                             |
| `search_discovered_space_memory_by_source` | `related`、`all` | 匹配指定已发现 `spaceId` 记忆的 `sources`                     |
| `read_discovered_space_memory`             | `related`、`all` | 在指定已发现 `spaceId` 内分页读取                             |
| `search_all_memory`                        | 仅 `all`         | 检索全局长期记忆及全部空间，无需先发现                        |
| `search_all_memory_by_source`              | 仅 `all`         | 匹配全局层及全部空间的 `sources`，无需先发现                  |
| `read_any_memory`                          | 仅 `all`         | 按 id 直接读取全局层或任意空间记忆，无需先发现                |

`related` 的调用顺序是 `find_memory_spaces_by_source` → `search_discovered_space_memory`（或其 `by_source` 版本）→ `read_discovered_space_memory`。每条发现结果包含 `spaceId`、匹配来源和记忆引用。绑定空间始终可调用；其他空间必须先被发现，而发现记录只在这组工具实例存续期间有效，重新创建工具后需要重新发现。

`all` 可以直接调用 `search_all_memory` 或 `search_all_memory_by_source`，再用结果中的 id 调用 `read_any_memory`。`all` 只覆盖所传 manager 的记忆库，不会搜索其他独立数据库。返回的 `spaceId`、`layer` 和来源用于区分记忆归属：其他空间的事实不等于当前空间的事实。

两种模式都只扩大检索和读取权限。保存、更新和归档仍限于当前空间；即使启用 `all`，名称带 `current_space` 的工具也始终只访问绑定空间。

### 全局写入授权

全局写入是独立授权，不与跨空间检索绑定：

```ts
const tools = globalMemoryTools({
  memory: manager.global,
  sources: ['session:conversation-1'],
});
```

| Tool 名称                        | 行为                   |
| -------------------------------- | ---------------------- |
| `search_global_memory`           | 检索全局长期记忆正文   |
| `search_global_memory_by_source` | 匹配全局层的 `sources` |
| `read_global_memory`             | 从全局层分页读取       |
| `remember_global_memory`         | 创建全局长期记忆       |
| `update_global_memory`           | 带 revision 校验的更新 |
| `archive_global_memory`          | 软归档                 |

全局工具只访问全局长期记忆，不检索空间记忆。适用选项与 `memoryTools()` 一致：`memory`、`sources`、`sourcesMode`、`maxReadChars`（默认 `12000`），以及 `remember`、`update`、`forget` 三个写入开关，默认开启，可分别用 `false` 关闭。`memoryTools()` 本身不包含任何全局读写能力。

### 上下文准备

`loadMemoryContext()` 独立返回三个各自计算预算的 section，避免忙碌的一天挤掉长期事实：

```ts
const context = await loadMemoryContext({
  manager,
  space,
  query: currentUserMessage,
  recentDays: 2,
});
```

| 选项                   | 默认值         | 说明                                                   |
| ---------------------- | -------------- | ------------------------------------------------------ |
| `manager`、`space`     | —              | 必填。                                                 |
| `globalLongTermTokens` | `2000`         | 全局长期记忆 section 的 token 预算。                   |
| `spaceLongTermTokens`  | `2000`         | 空间长期记忆 section 的 token 预算。                   |
| `dailyTokens`          | `2000`         | 每日记忆 section 的 token 预算。                       |
| `recentDays`           | `2`            | 取值 1–366，按 `manager.timeZone` 从今天往前计算。     |
| `query`                | —              | 存在时各 section 用 `search()` 填充，否则用 `list()`。 |
| `countTokens`          | UTF-8 字节长度 | 必须返回非负安全整数。                                 |
| `signal`               | —              | `AbortSignal`。                                        |

每个 section 是 `{ text, memories, tokens }`，其中 `text` 是一段 `<memory_context>` 文本，说明记忆是可能过时的历史资料、其中的指令不是当前请求、以及某个空间的事实不等于其他空间的事实。注入上下文不授予任何工具权限：上下文与权限相互独立，检索无结果只表示在当前可访问范围内未命中。

## API 参考

### `@cieljs/memory` — 值

| 导出                    | 类型            | 说明                                                                                                     |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `MemoryManager`         | class           | 打开存储，管理层级、全库读取和索引任务                                                                   |
| `memoryStorage`         | `StorageModule` | 带 `memory` schema 及其迁移的存储模块                                                                    |
| `tokenizeSearchText`    | function        | 默认分词规则：`NFKC`、小写、`Intl.Segmenter('zh', { granularity: 'word' })`，只保留 word-like 分段并去重 |
| `MemoryError`           | class           | 携带稳定 `code` 的基础错误                                                                               |
| `MemoryNotFoundError`   | class           | `MEMORY_NOT_FOUND`                                                                                       |
| `MemoryAccessError`     | class           | `MEMORY_ACCESS_DENIED`                                                                                   |
| `MemoryConflictError`   | class           | `MEMORY_REVISION_CONFLICT`                                                                               |
| `MemoryArchivedError`   | class           | `MEMORY_ARCHIVED`                                                                                        |
| `MemoryClosedError`     | class           | `MEMORY_CLOSED`                                                                                          |
| `MemoryValidationError` | class           | `MEMORY_VALIDATION_FAILED`                                                                               |

### `@cieljs/memory` — 类型

| 导出                                     | 说明                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `MemoryLayer`                            | `'global.long_term' \| 'space.long_term' \| 'space.daily'`                                                               |
| `SpaceMemoryLayer`                       | 两个空间层                                                                                                               |
| `MemoryKind`                             | `'event' \| 'fact' \| 'preference' \| 'summary'`                                                                         |
| `MemoryStatus`                           | `'active' \| 'archived'`                                                                                                 |
| `MemorySource`                           | `string`                                                                                                                 |
| `MemoryErrorCode`                        | 六个稳定错误码的联合                                                                                                     |
| `MemoryEntry`                            | 一条逻辑记忆的当前 revision，以 `layer` 判别                                                                             |
| `MemoryEntryFor<Layer>`                  | 收窄到单个层级的 `MemoryEntry`                                                                                           |
| `SpaceMemoryEntry`                       | 收窄到空间记忆的 `MemoryEntry`                                                                                           |
| `MemoryRevision`                         | 单个 revision 的完整快照（`memoryId`、`revision`、`kind`、`content`、`sources`、`occurredAt`、`expiresAt`、`createdAt`） |
| `LongTermRememberInput`                  | `{ content, kind?, occurredAt?, expiresAt?, sources? }`                                                                  |
| `DailyRememberInput`                     | `LongTermRememberInput` 加可选的 `date`                                                                                  |
| `UpdateMemoryInput`                      | `{ expectedRevision, content?, kind?, expiresAt?, sources? }`                                                            |
| `ForgetMemoryOptions`                    | `{ expectedRevision }`                                                                                                   |
| `MemoryReadOptions`                      | `{ includeArchived?, includeExpired? }`                                                                                  |
| `MemoryListOptions`                      | 读取选项加 `kind`、`limit`、`offset`                                                                                     |
| `SpaceMemoryListOptions`                 | 列表选项加 `layers`、`dateFrom`、`dateTo`                                                                                |
| `MemoryHistoryOptions`                   | `{ limit?, beforeRevision? }`                                                                                            |
| `MemorySearchMode`                       | `'hybrid' \| 'full_text' \| 'trigram' \| 'vector'`                                                                       |
| `MemorySearchMatch`                      | `'full_text' \| 'trigram' \| 'vector'`                                                                                   |
| `MemorySearchOptions`                    | 正文检索选项（见检索章节的表格）                                                                                         |
| `SpaceMemorySearchOptions`               | 正文检索选项加 `layers`、`dateFrom`、`dateTo`                                                                            |
| `SearchAllMemoryOptions`                 | 正文检索选项加全层 `layers`、`dateFrom`、`dateTo`                                                                        |
| `MemorySearchHit<Layer>`                 | `{ memory, excerpt, score, matches }`                                                                                    |
| `MemorySourceSearchMode`                 | `'auto' \| 'exact' \| 'text'`                                                                                            |
| `MemorySourceSearchOptions`              | 来源检索选项，包含 `includeHistory`                                                                                      |
| `SpaceMemorySourceSearchOptions`         | 限制在两个空间层的来源检索选项                                                                                           |
| `MemorySourceSearchHit<Layer>`           | `{ memoryId, revision, spaceId, layer, date, matchedSources, excerpt, score }`                                           |
| `FindMemorySpacesOptions`                | `{ mode?, layers?, limit?, signal? }`                                                                                    |
| `MemorySpaceSourceHit`                   | `{ spaceId, score, matchedSources, memories }`                                                                           |
| `MemoryManagerOptions`                   | `MemoryManager.open()` 的选项                                                                                            |
| `MemoryIndexStatus`                      | `{ pending, ready, failed }`                                                                                             |
| `MemoryLayerStore<Layer, RememberInput>` | `global`、`longTerm` 和 `daily` 使用的单层存储接口                                                                       |
| `GlobalLongTermMemory`                   | `MemoryLayerStore<'global.long_term', LongTermRememberInput>`                                                            |
| `SpaceMemory`                            | `manager.space()` 返回的绑定空间 API                                                                                     |
| `EmbeddingProvider`                      | 从 `@cieljs/model-kit` 重新导出：embedding 后端契约                                                                      |
| `EmbeddingOptions`                       | 从 `@cieljs/model-kit` 重新导出：`{ purpose, signal? }`                                                                  |

### 对象成员

`MemoryManager`：

| 成员                                  | 说明                                                          |
| ------------------------------------- | ------------------------------------------------------------- |
| `timeZone`                            | 解析后的 IANA 时区。                                          |
| `global`                              | 全局长期记忆层存储。                                          |
| `space(spaceId)`                      | 返回绑定空间的 `SpaceMemory`。                                |
| `getAny(id, options?)`                | 从任意层级读取一条记忆。                                      |
| `searchAll(query, options?)`          | 全库正文检索。                                                |
| `searchBySource(query, options?)`     | 全库来源检索。                                                |
| `findSpacesBySource(query, options?)` | 按来源发现空间。                                              |
| `getIndexStatus()`                    | `{ pending, ready, failed }`；没有 `VectorService` 时全为 0。 |
| `flushIndexes()`                      | 等待已排入的索引任务完成。                                    |
| `retryIndexes()`                      | 重新排入失败的索引任务。                                      |
| `rebuildIndexes()`                    | 重建当前 revision 的 chunk，并重新分词全部 revision 的来源。  |
| `close()`                             | 关闭 manager；重复调用返回同一个 Promise。                    |
| `[Symbol.asyncDispose]()`             | 调用 `close()`，因此支持 `await using`。                      |

`SpaceMemory`：

| 成员                                                 | 说明                                                 |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `spaceId`                                            | 绑定空间。                                           |
| `longTerm`、`daily`                                  | 固定为 `space.long_term` 和 `space.daily` 的层存储。 |
| `get(id, options?)`、`list(options?)`                | 空间内读取（list 默认包含两个空间层）。              |
| `search(query, options?)`                            | 空间内正文检索。                                     |
| `searchBySource(query, options?)`                    | 空间内来源检索。                                     |
| `update(id, input)`、`forget(id, options)`           | 空间内变更，层级由内部判断。                         |
| `history(id, options?)`、`getRevision(id, revision)` | 空间内 revision 历史。                               |

`MemoryLayerStore<Layer, RememberInput>`（用于 `manager.global`、`space.longTerm`、`space.daily`）：

| 成员                                                 | 说明                                                      |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `layer`                                              | 这个存储固定的层级。                                      |
| `remember(input)`                                    | 在该层创建新的逻辑记忆。                                  |
| `get(id, options?)`、`list(options?)`                | 在该层内读取。                                            |
| `search(query, options?)`                            | 在该层内做正文检索。                                      |
| `searchBySource(query, options?)`                    | 在该层内做来源检索（`layers` 已固定，因此不接受该选项）。 |
| `update(id, input)`、`forget(id, options)`           | 在该层内做带 revision 校验的变更。                        |
| `history(id, options?)`、`getRevision(id, revision)` | 在该层内读取 revision 历史。                              |

### `@cieljs/memory/agent`

| 导出                          | 类型     | 说明                                                      |
| ----------------------------- | -------- | --------------------------------------------------------- |
| `memoryTools(options)`        | function | 组装当前空间工具集，可选加入跨空间只读工具                |
| `globalMemoryTools(options)`  | function | 组装独立授权的全局写入工具集                              |
| `loadMemoryContext(options)`  | function | 返回三个独立预算的上下文 section                          |
| `MemoryToolsOptions`          | type     | `memoryTools()` 的选项                                    |
| `GlobalMemoryToolsOptions`    | type     | `globalMemoryTools()` 的选项                              |
| `CrossSpaceMemoryAccess`      | type     | `'related' \| 'all'`                                      |
| `CrossSpaceMemoryOptions`     | type     | `{ manager, access }`                                     |
| `MemorySourceProvider`        | type     | `(context) => MemorySource[] \| Promise<MemorySource[]>`  |
| `MemorySourceProviderContext` | type     | `{ toolCallId, action: 'remember' \| 'update', signal? }` |
| `LoadMemoryContextOptions`    | type     | `loadMemoryContext()` 的选项                              |
| `MemoryContextSection`        | type     | `{ text, memories, tokens }`                              |
| `LoadedMemoryContext`         | type     | `{ globalLongTerm, spaceLongTerm, daily }`                |

## 行为说明与设计取舍

### 隔离保证

- 层存储携带固定的 selector（`layers` 加可选的 `spaceId`），因此一次调用不可能触达它没有被创建用于的层级；`remember()` 还会校验传入层级属于当前入口。
- 空间 API 不包含全局记忆，也不访问其他空间，不会隐式回退到 manager 的全库方法。
- manager 的 `getAny()`、`searchAll()` 和全库来源检索是显式的宿主侧 API。
- Agent 工具接收绑定好的 `SpaceMemory`，参数中没有 `spaceId`。跨空间工具只接受绑定空间或同一组工具发现过的空间，并且全部只读。
- 跨空间检索与全局写入是两项独立授权，任何一项都不会扩大 `remember`、`update` 或 `forget` 的作用范围。
- 请求范围与实际记忆不匹配时返回 `MemoryAccessError`，而不是静默的空结果。

### 软删除语义

`forget()` 只把 `memories.status` 改为 `'archived'` 并写入 `archivedAt`。正文、来源、revision、chunk 和向量全部保留，因此 `history()` 和 `getRevision()` 对已归档记忆仍然有效，宿主也可以用 `includeArchived: true` 检索它们。默认读取和默认检索（包括全部 Agent 工具）看不到它们，对已归档记忆执行 `update()` 会抛出 `MemoryArchivedError`。第一版没有物理删除，也没有 Agent 恢复工具。

### 索引维护

- `remember()` 和 `update()` 在事务内替换该记忆的全部 chunk，并在提交后排入 embedding 任务。chunk id 是每次新生成的 UUID，因此旧 revision 遗留的 embedding 任务无法把向量写回新 revision。
- 正文按 1600 字符切分，重叠 160 字符，每个 chunk 同时保存规范化检索文本和分词文本。
- 全文检索和来源检索读取的正是索引写入的同一份分词结果；来源匹配同时使用 `text[]` 包含索引（精确标识）和 FTS/trigram 索引（合并后的来源）。
- 索引状态可观测：`getIndexStatus()` 报告 `pending`、`ready`、`failed`；`flushIndexes()` 等待已排入的任务；`retryIndexes()` 重新排入失败条目；`rebuildIndexes()` 重建当前 revision 的 chunk，并重新分词包括历史 revision 在内的全部来源。
- 索引失败不会破坏检索：`hybrid` 中失败的向量分支通过 `onIndexError` 上报，该分支不贡献命中。只有 `model`、`dimensions` 和 `ready` 状态都与当前 `VectorService` 匹配的向量才会成为候选。
- `close()` 之后的新操作以 `MemoryClosedError` 拒绝，等待进行中的操作和索引任务完成，并且是幂等的——重复调用返回同一个 Promise。关闭 manager 不会关闭 `Storage`；宿主应在所有借用方结束之后最后关闭存储。

### 更换 tokenizer 需要 `rebuildIndexes()`

默认 tokenizer 是单例 `Intl.Segmenter('zh', { granularity: 'word' })`，在 `NFKC` 规范化和小写化之后只保留 word-like 分段并去重。索引文本和查询必须共用同一个 tokenizer，因此替换 `tokenize` 之后要调用 `rebuildIndexes()`，否则库里保存的分词文本与查询产生的分词不再匹配，全文检索和来源检索会静默失效。自定义实现可通过 `MemoryManager.open({ tokenize })` 注入。

### Embedding provider 契约

`MemoryManagerOptions.vectors` 接收一个 [`VectorService`](../vector/README.zh-CN.md)，它使用的 provider 来自 `@cieljs/model-kit`：

| 字段         | 必填 | 说明                                           |
| ------------ | ---- | ---------------------------------------------- |
| `model`      | 是   | 模型标识；更换模型或版本时必须同步更新。       |
| `dimensions` | 是   | 取值 1–16000，必须与每个返回向量一致。         |
| `batchSize`  | 否   | 单次请求的最大文本数，默认 `32`，最大 `1000`。 |
| `embedBatch` | 是   | 返回顺序必须与输入一致；查询也使用单元素数组。 |
| `embed`      | 否   | 单文本版本；省略时由 `embedBatch` 自动实现。   |

调用携带 `purpose: 'query' | 'document'`，便于 provider 选择前缀或任务类型，并可选携带 `signal`。`VectorService` 根据 `providerId`、provider 的 model、`revision`、`granularity`、`dimensions` 和 `inputConfig` 派生自己的模型键，并按 `(模型键, purpose, 文本)` 缓存向量。由于检索只接受模型键、维数和状态都匹配当前服务的记录，更换 embedding 模型、维数或输入配置需要新建 `VectorService` 并重新索引；用其他模型键索引的文档不会成为候选。

### 为什么这样设计

作用范围放在对象上，而不是参数里：`manager.space(spaceId)` 由宿主创建，Agent 只拿到已经绑定的工具，因此既不需要传 `spaceId`，也无法借写入参数伪造别的空间。

拆分两个 remember 工具，是因为 daily 与 long-term 的生命周期本来就不同。拆开后工具本身就固定了目标层级，不需要 Agent 再传一个数据库 layer 字符串。

update 只传新值和 `expectedRevision`。调用者为了做判断已经读过旧内容，但不必把它再发一遍：`expectedRevision` 足以证明这次更新基于哪个版本，事务内部会自己读取当前快照。

每个 revision 都保存完整快照，让历史读取、回滚分析和来源审计保持简单；记忆正文通常不大，第一版不需要文本 diff 或事件溯源。sources 保持 `string[]`，因为稳定标识、名称、标题和别名就是当前的全部需求，纯字符串也让包不必依赖业务字段结构。

正文检索与来源检索分成两个入口，是因为「这条记忆讲了什么」和「这条记忆来自哪里」本来就是两种问题；分开之后也更容易控制跨空间权限。跨空间访问默认只读——发现一个相关空间，并不代表有权修改它。

第一版不做自动整理。整理会连带引入模型决策、调度、批处理、冲突重试和质量评估；先验证分层写入、revision、来源检索和 Agent 权限，能以更小的边界拿到真实使用数据。将来加 Organizer 时，它可以直接消费现有的 daily 与 long-term 记录，而这些 API 不必改变。

### 第一版未实现

- `space.daily` 自动整理为 `space.long_term`，或 `space.long_term` 自动提升为 `global.long_term`。
- Organizer、整理 checkpoint 或模型提示词。
- 定时或后台维护任务。
- Agent 跨空间写入。
- 物理删除（`purge()`）和恢复 API。
- 历史 revision 的语义检索。

## 开发

```bash
vp install    # 安装工作区依赖
vp check      # 格式化、lint 和类型检查
vp run test   # 执行 `vp test`
vp run build  # 在本包依赖之后执行 `vp pack`
```

`packages/memory/vite.config.ts` 定义了 `build` 和 `test` 任务，包的 `check` 脚本执行 `vp check`。测试使用内存 PGlite 实例（`dataDir: 'memory://'`）和 embedding 替身（`embedBatch` 返回固定向量），无需 API Key 或外部服务。测试覆盖分词、分层写入、revision 历史、版本冲突、软归档、检索模式、跨空间工具、上下文加载和 manager 生命周期。
