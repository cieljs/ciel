<h1 align="center">@cieljs/investigation</h1>

<p align="center">可复用的调查问答界面：按目标划分的会话、会话侧栏，以及由 Ciel Console 渲染的 Agent 对话。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概览">概览</a> ·
  <a href="#概念">概念</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#investigationchat-组件">组件</a> ·
  <a href="#客户端契约">客户端契约</a> ·
  <a href="#api-参考">API 参考</a> ·
  <a href="#行为说明">行为说明</a>
</p>

## 概览

`@cieljs/investigation` 把 [`@cieljs/console`](../console/README.zh-CN.md) 包在一层很薄的外壳里，只为一种流程服务。它补上调查需要的东西，别的一概不加：按目标划分的会话列表、目标选择器、可就地编辑的标题，以及一个带停止按钮的输入框。

这里没有传输层，也没有数据层。包只负责渲染 `InvestigationClient` 返回的内容，并用 `CielChat` 显示 Agent 的回答——后者通过另一个来自 [`@cieljs/trace`](../trace/README.zh-CN.md) 的 `TraceClient` 读取。一个会话就是一个 session id，两个 client 必须对同一个 id 达成一致。

## 概念

组件只跟一个契约打交道：`InvestigationClient`，它的七个方法列在[客户端契约](#客户端契约)里。其余词汇不多。`InvestigationTargetInput` 是宿主用来创建会话的目标：`{ type: 'global' }` 或 `{ type: 'room', roomId }`。`InvestigationConversation` 就是会话本身，带 `sessionId`、`target`、`title`、`label`、`createdAt` 以及可选的 `room`。`InvestigationRoom` 是 `{ roomId, title, streamerName }`，用来支撑「当前房间」这个快捷选项。`InvestigationUpdate` 是目前唯一的推送：`{ type: 'title_updated', sessionId, title }`。

session id 是这套东西的铰链。它同时也是读取 Agent 回答所用的 `TraceClient` 会话，因此会话与轨迹就靠这一个字符串连起来。`TraceClient` 是 `@cieljs/trace/client` 的 oRPC 客户端，会原样传给 `CielChat`。

## 快速开始

在本仓库里，包通过 `workspace:` 协议使用，`vue` 是 peer 依赖（`^3.5.0 || ^3.6.0-0`）。宿主需要同时引入两份样式，因为里面的对话是由 Ciel Console 渲染的：

```ts
import '@cieljs/console/style.css';
import '@cieljs/investigation/style.css';
```

把组件挂上去，并给它需要的两个 client：

```vue
<script setup lang="ts">
import { InvestigationChat } from '@cieljs/investigation';
import type { InvestigationClient } from '@cieljs/investigation';
import type { TraceClient } from '@cieljs/trace';

import '@cieljs/console/style.css';
import '@cieljs/investigation/style.css';

defineProps<{ client: InvestigationClient; traceClient: TraceClient }>();
</script>

<template>
  <InvestigationChat :client="client" :trace-client="traceClient" />
</template>
```

一个过程名与契约一致的 oRPC router 本身就能当 `InvestigationClient` 用。仓库里那个 Electron 应用就是这么接的：它的 `investigation` router 正好暴露 `list`、`create`、`rename`、`delete`、`updates`、`prompt` 和 `abort`，于是生成的 client 被直接传了进去。名字对不上时，显式适配一层：

```ts
import type { InvestigationClient } from '@cieljs/investigation';
import { createORPCClient } from '@orpc/client';
import type { RouterClient } from '@orpc/server';

import type { AppRouter } from './router.ts';

const rpc: RouterClient<AppRouter> = createORPCClient(link);

const client: InvestigationClient = {
  list: () => rpc.investigation.list(),
  create: input => rpc.investigation.create(input),
  rename: input => rpc.investigation.rename(input),
  delete: input => rpc.investigation.delete(input),
  updates: (input, options) => rpc.investigation.updates(input, options),
  prompt: input => rpc.investigation.prompt(input),
  abort: input => rpc.investigation.abort(input),
};
```

把当前房间传进去，目标选择器就会把它作为一个快捷选项：

```vue
<InvestigationChat :client="client" :trace-client="traceClient" :current-room="room" />
```

## InvestigationChat 组件

| Prop               | 类型                                    | 默认值  | 说明                               |
| ------------------ | --------------------------------------- | ------- | ---------------------------------- |
| `client`           | `InvestigationClient`                   | 必填    | 会话列表与生命周期                 |
| `traceClient`      | `TraceClient`                           | 必填    | 交给 `CielChat` 渲染 Agent 的回答  |
| `currentRoom`      | `InvestigationRoom`                     | —       | 让目标选择器多出「当前房间」这一项 |
| `sidebarCollapsed` | `boolean`（`v-model:sidebarCollapsed`） | `false` | 折叠状态，同时驱动 `collapsed` 类  |

挂载时它会调用一次 `initialize()`。之后你会得到：

- 一个会话侧栏，新的在上面，带一个创建浮层；折叠后整个隐藏。
- 侧栏与工作区之间的一条分隔条，可以用鼠标或键盘调整。侧栏宽度通过 `--investigation-sidebar-width` 这个 CSS 变量发布，并被夹在 176 px 到 `min(320, viewportWidth - 520)` px 之间。
- 一个显示会话标题的头部。点击标题打开行内输入框（最多 80 字符），提交或失焦时保存，`Esc` 取消。标题下方是会话的 `label`，缺失时退回 `准备调查环境…`。
- `error` 有值时出现的错误提示（`role="alert"`）。
- 对话本身：`:session-id="conversation.sessionId"` 的 `CielChat`，会话还在创建时则显示占位。
- 一个输入框：`Enter` 发送，`Shift+Enter` 换行，忽略输入法组合状态，最多长到 160 px，提问进行中会变成停止按钮。
- 一个「回到底部」按钮，由 `@cieljs/console` 的 `vFollowScroll` 指令驱动。

如果只想复用其中一角，可以看这几个内部组件：

| 组件                        | Props                                                                                                    | 说明                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `InvestigationSidebar`      | `conversations: readonly InvestigationConversation[]`、`selectedSessionId?`、`currentRoom?`、`disabled?` | 发出 `create(target)` 与 `select(sessionId)`；带 `id="investigation-sidebar"`，宿主可以拿它做 `aria-controls` |
| `InvestigationTargetPicker` | `currentRoom?`、`disabled?`                                                                              | 发出 `create(target)`；提供全局、当前房间，或手动输入的正整数房间号                                           |
| `InvestigationComposer`     | `disabled?`、`running?`                                                                                  | 发出 `submit(content)` 与 `abort`                                                                             |

## 客户端契约

| 方法      | 签名                                                                                                     | 用途                           |
| --------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `list`    | `() => Promise<InvestigationConversation[]>`                                                             | 侧栏要显示的会话               |
| `create`  | `(input: { target: InvestigationTargetInput }) => Promise<InvestigationConversation>`                    | 为某个目标创建会话             |
| `rename`  | `(input: { sessionId: string; title: string }) => Promise<InvestigationConversation>`                    | 持久化新标题，返回更新后的会话 |
| `delete`  | `(input: { sessionId: string }) => Promise<void>`                                                        | 永久删除一个调查会话           |
| `updates` | `(input?: undefined, options?: { signal?: AbortSignal }) => Promise<AsyncIterable<InvestigationUpdate>>` | 长连接推送流，目前用来同步标题 |
| `prompt`  | `(input: { sessionId: string; content: string }) => Promise<InvestigationConversation>`                  | 提一个问题，回答完整时 resolve |
| `abort`   | `(input: { sessionId: string }) => Promise<void>`                                                        | 停止正在进行的那次回答         |

这个契约把三件事留给了宿主。

目标由宿主掌控。`InvestigationTargetInput` 只是用户选了什么，把它变成真正的范围（记忆空间、来源、工具权限）是你的活，因为组件从不检查 Agent 被允许碰什么。

Agent 必须在 `conversation.sessionId` 下运行，因为回答就是从那里读的。仓库里的应用让这些 id 以 `investigation:` 开头，于是可以在主 trace router 旁边再挂一个专用的，用 `session: sessionId => sessionId.startsWith('investigation:')` 分流。

标题变化由宿主推送。在别处改名——比如提完第一个问题后自动生成标题——会以 `title_updated` 类型的 `InvestigationUpdate` 发布，并在原地生效。

## API 参考

### `@cieljs/investigation` —— `src/index.ts`

| 导出                        | 类型      | 说明                                                     |
| --------------------------- | --------- | -------------------------------------------------------- |
| `InvestigationChat`         | component | 侧栏、可编辑标题、对话与输入框                           |
| `InvestigationClient`       | type      | 上面那个七方法契约                                       |
| `InvestigationConversation` | type      | `{ sessionId, target, title, label, createdAt, room? }`  |
| `InvestigationRoom`         | type      | `{ roomId, title, streamerName }`                        |
| `InvestigationTargetInput`  | type      | `{ type: 'global' } \| { type: 'room', roomId: number }` |
| `InvestigationUpdate`       | type      | `{ type: 'title_updated', sessionId, title }`            |

### `@cieljs/investigation/style.css`

布局样式表。`.investigation-chat` 是一个三列网格（`var(--investigation-sidebar-width, 216px) 1px minmax(0, 1fr)`），侧栏在 `--surface` 上做 `color-mix()` 并加背景模糊。颜色兜底用 `--foreground` 与 `--surface`，也就是 Ciel Console 用的同一组变量。

### Composable 参考

两个 composable 都是内部的，但组件的行为由它们定义。

`useInvestigationChat(client)` 持有全部会话状态：

| 返回                | 类型         | 说明                                                               |
| ------------------- | ------------ | ------------------------------------------------------------------ |
| `conversations`     | readonly ref | 已知的全部会话                                                     |
| `conversation`      | readonly ref | 当前选中的会话                                                     |
| `pending`           | readonly ref | `'create' \| 'delete' \| undefined`                                |
| `sessionPending`    | readonly ref | 每个 session 独立的 `'prompt' \| 'abort'` 状态 Map                 |
| `error`             | ref          | 最近一条错误信息；可写，宿主可以自行清空                           |
| `initialize()`      | function     | 连接 updates、`list()`、选中最新的一条；列表为空时创建一个全局会话 |
| `create(target)`    | function     | 创建并选中一个会话                                                 |
| `select(sessionId)` | function     | 选中列表里已有的会话                                               |
| `rename(title)`     | function     | 重命名当前会话（会 trim，空则忽略）                                |
| `remove(sessionId)` | function     | 删除调查会话；删除当前项时选择下一条可用会话                       |
| `prompt(content)`   | function     | 发送一个问题（会 trim，空或正忙则忽略）                            |
| `abort()`           | function     | 停止正在进行的回答                                                 |

`useInvestigationSidebar()` 负责分隔条：`width`（默认 216）、`maxWidth`、`dragging`、`startDrag`、`moveDrag`、`endDrag` 和 `keyboardResize`。方向键每次移动 16 px，`Home` 跳到 176 px，`End` 跳到 `maxWidth`。窗口尺寸变化时会重新夹紧宽度。

## 行为说明

- **组件对持久化无状态。** 它显示的一切都来自 `client.list()` 和 `updates` 流，本地不存任何 store。只要宿主的 list 方法能重建会话，重启窗口也不会丢。
- **`initialize()` 不会让你没有会话可用。** 宿主返回空列表时它会自动创建一个全局会话，所以第一次运行时工作区显示的是占位，而不是空状态。
- **临时标题是乐观的。** 当选中会话还叫 `新调查` 时，第一个问题会立刻变成本地标题（折叠空白、截到 36 字符），不等服务端回应，这样模型工作时侧栏不会一直无标题。宿主之后通过 `rename` 或 `title_updated` 覆盖它。
- **中止不算错误。** 当前 session 处于 `prompt` 状态时输入框显示停止按钮。调用 `abort()` 之后会记住该 session id，于是那次被取消的 `prompt` promise 产生的 rejection 会被吞掉，而不是弹出错误提示。无论哪条路径，标记都会被清掉。
- **回答状态归属于各自的 session。** 一个 session 回答期间仍可切换、创建新调查，也可以在其他空闲 session 提问；只有处于 `abort` 状态的 session 会禁用自己的输入区。
- **updates 订阅与组件生命周期绑定。** 它只开一次，跨多次 `initialize()` 复用，并由 `onScopeDispose` 中止，因此随组件作用域结束，不会泄漏。
- **侧栏宽度是响应式的，不做持久化。** 它按视口夹紧（`viewportWidth - 520`），窗口尺寸变化时重置。组件不会把它写进存储。
- **折叠是 model，不是内部状态。** `v-model:sidebarCollapsed` 让宿主可以驱动自己的头部按钮，仓库里的应用就是这样从组件外部切换侧栏的。

> [!NOTE]
> 界面文案是中文（侧栏标题、空状态、输入框提示）。和 Ciel Console 一样，这个包没有 i18n 层。

## 开发

包声明了两个脚本：

| 脚本             | 命令           | 用途                    |
| ---------------- | -------------- | ----------------------- |
| `check`          | `vp check`     | 格式化、lint 与类型检查 |
| `prepublishOnly` | `vp run build` | 发布前构建              |

`vite.config.ts` 注册 Vue 插件并定义两个打包入口，`index`（`src/index.ts`）和 `style`（`src/style.css`），并开启声明文件。Vite+ 的任务图提供 `build`（`vp pack`，依赖它自己依赖项的 `build` 任务）和 `test`（`vp test`）：

```sh
vp install
vp run test
vp check
```

这个包目前还没有测试文件；`test` 任务来自共享的任务配置。
