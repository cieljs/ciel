<h1 align="center">@cieljs/console</h1>

<p align="center">Ciel 的 Vue 3 界面：对话视图、执行轨迹检查、会话与用量状态，以及渲染器扩展点。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概述">概述</a> ·
  <a href="#概念">概念</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#组件">组件</a> ·
  <a href="#扩展点">扩展点</a> ·
  <a href="#api-参考">API 参考</a> ·
  <a href="#设计取舍">设计取舍</a>
</p>

## 概述

`@cieljs/console` 负责渲染 [`@cieljs/trace`](../trace/README.zh-CN.md) 暴露的数据。它有三件事：
展示 Agent 对话、逐条展示执行轨迹，以及让宿主替换单个工具与单条消息的绘制方式。

本包是一个纯粹的 Vue 3 库。它从不创建连接：每个组件都接收一个 `TraceClient` 并自行调用。它提供
唯一一份样式表 `@cieljs/console/style.css`，并依赖 `@vuetify/v0` 提供交互原语、`markstream-vue`
渲染 Markdown、`vue-json-pretty` 渲染 JSON 树。

## 概念

| 名词               | 含义                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- |
| `TraceClient`      | 来自 `@cieljs/trace/client` 的 oRPC 客户端；每个组件都以 prop 接收                 |
| `TraceEntry`       | 一条对话条目或投影步骤；两个视图渲染的基本单位                                     |
| `TraceStepGroup`   | 与同一业务对象的后续事件合并后的步骤，额外带 `events`、`updatedAt`、`runningUntil` |
| `TraceSession`     | 工具栏与状态栏渲染的会话行                                                         |
| `TraceUsageState`  | `{ total, context }`，由状态栏格式化展示                                           |
| 对话视图           | 由 `entry` 记录构成的消息流                                                        |
| 轨迹视图           | 由 `step` 记录构成的步骤列表加检查面板                                             |
| `ToolCallRecord`   | 由 `toolCallId` 把工具步骤与其 `toolResult` 消息连起来的 `{ call?, result? }`      |
| `ToolRenderers`    | 按工具机器名索引的 `Record<string, Component>`                                     |
| `MessageRenderers` | 面向整条消息的有序 `{ match, component }` 谓词列表                                 |
| `useConsole`       | 持有订阅、历史分页、会话选择与清空的组合式函数                                     |

## 安装

在本 monorepo 内通过 workspace 协议引用：

```json
{
  "dependencies": {
    "@cieljs/console": "workspace:*"
  }
}
```

`vue` 是 peer 依赖（`^3.5.0 || ^3.6.0-0`），由宿主应用提供。

## 快速开始

在宿主应用里引入一次样式表，然后用轨迹客户端挂载组合式控制台：

```vue
<script setup lang="ts">
import { CielConsole } from '@cieljs/console';
import type { TraceClient } from '@cieljs/trace';

import '@cieljs/console/style.css';

defineProps<{ client: TraceClient; sessionId: string }>();
</script>

<template>
  <CielConsole :client="client" :session-id="sessionId" />
</template>
```

只想嵌入单个视图时，可以不使用页签式控制台：

```vue
<template>
  <CielChat :client="client" :session-id="sessionId" empty-text="还没有对话。" />
  <ExecutionTraceInspect :client="client" :session-id="sessionId" />
</template>
```

两个组件都由 `@cieljs/console` 导出，并需要同一份样式表引入。

## 组件

### `CielConsole`

组合式外壳：视图页签、会话选择器、清空按钮、执行面板、对话面板与状态栏。

| Prop               | 类型               | 默认值 | 说明                                                                                |
| ------------------ | ------------------ | ------ | ----------------------------------------------------------------------------------- |
| `client`           | `TraceClient`      | 必填   | 用于订阅与按需取值的轨迹客户端                                                      |
| `autoScroll`       | `boolean`          | `true` | 对话流式输出时是否跟随底部                                                          |
| `sessionId`        | `string`           | —      | 宿主当前活动的 Session；变化时自动切换，用户手动选择的其它 Session 会保留到下次变化 |
| `toolRenderers`    | `ToolRenderers`    | —      | 自定义工具渲染器；请用普通常量或 `markRaw`，不要放进 reactive                       |
| `messageRenderers` | `MessageRenderers` | —      | 自定义消息渲染器，同样不能是响应式对象                                              |

`content` 插槽会转发给当前激活的详情面板，作用域内含 `entry`、`section`、`value` 与
`defaultRenderer`。

`actions` 插槽落在工具栏里、会话选择器与清空按钮之间，宿主可以把自己的命令放在视图控件旁边。
控制台不认识这些按钮的语义——文案、禁用态与忙碌态都由宿主自己决定；给它们
`class="dt-button dt-action"` 就能沿用控制台 28 × 24 的图标按钮几何、hover 与禁用样式。

### 对话组件

| 组件                        | Props                                                                                                       | 说明                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `CielChat`                  | `client`、`sessionId`（必填）、`autoScroll`（`true`）、`emptyText`、`toolRenderers`、`messageRenderers`     | 单会话的对话面板；渲染最近 100 条消息  |
| `MessageView`               | `client`、`entry`、`toolCalls?`、`toolRenderers?`、`messageRenderers?`                                      | 单条消息卡片；提供 `content` 插槽      |
| `AgentConversation`（内部） | `client`、`messages`、`toolCalls`、`autoScroll`、`active`、`emptyText`、`toolRenderers`、`messageRenderers` | 滚动列表本身；面板重新显示时会重新吸底 |

`CielConsole` 渲染所选会话的最近 50 条消息，`CielChat` 渲染最近 100 条。两者都把卡片本身交给
`MessageView`。

### 轨迹组件

| 组件                    | Props                                                                                                  | 说明                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `ExecutionTraceInspect` | `client`、`sessionId`（必填）、`toolRenderers?`                                                        | 只有轨迹的列表/详情分栏面板                             |
| `ExecutionView`（内部） | `client`、`steps`、`hasOlder`、`loadingOlder`、`toolCalls?`、`toolRenderers?`、`v-model:query`（必填） | 过滤框、列表、可拖拽分栏与详情；触发 `older`            |
| `TraceDetail`（内部）   | `client`、`entry`、`toolCalls?`、`toolRenderers?`                                                      | 页签式检查器；触发 `close`                              |
| `TraceList`（内部）     | `entries`、`selectedId`                                                                                | 带状态、开始时间、耗时与轮次分隔的行列表；触发 `select` |

`ExecutionView` 在 `label`、`name`、`id`、`sessionId` 与 `toolCallId` 上过滤；列表滚动到距顶部
80 像素以内时请求更早的一页，并在列表没铺满视口时继续补齐。分栏比例限制在 20 %–75 % 之间，并支持
方向键调整。

`TraceDetail` 为工具步骤显示概览、参数、结果、Schema、计时、原始事件标签，为其它步骤显示概览、消息、
思考、计时、原始事件标签。当一个分组里有多个原始事件时，会出现选择器
切换查看。

### 内容组件

| 组件                                             | Props                                                                 | 说明                                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ContentRenderer`                                | `value`、`final`（`true`）、`client?`、`toolCalls?`、`toolRenderers?` | 文本按 Markdown 渲染，图片块渲染为可放大图片，`thinking` 放进折叠区，工具调用交给 `ToolCallRenderer`，其余按格式化 JSON 展示 |
| `ToolCallRenderer`（导出为 `ToolCallView.vue`）  | `client?`、`call?`、`result?`、`block?`、`renderer?`、`status?`       | 单次工具调用：带状态的标题，以及自定义渲染器或默认的参数/结果视图                                                            |
| `SessionStatus`（导出为 `SessionStatusBar.vue`） | `session?: TraceSession`                                              | 轮次/步数计数与用量浮层                                                                                                      |
| `SessionToolbar`                                 | `sessions: TraceSession[]`、`v-model:session-id`（必填）              | 视图页签、会话选择器，以及给宿主动作使用的默认插槽                                                                           |

> [!NOTE]
> `ContentRenderer` 使用 `markstream-vue` 并设置 `html-policy="escape"`，因此轨迹内容中的原始 HTML
> 不会被当作标记执行。

## 扩展点

### 自定义工具渲染器

`ToolRenderers` 把工具机器名映射到组件。组件收到的是纯数据——取值由 Ciel Console 负责：

```ts
import type { ToolRendererProps } from '@cieljs/console';

export interface ToolRendererProps {
  name: string;
  label?: string;
  description?: string;
  status: 'running' | 'completed' | 'error';
  toolCallId: string;
  args: unknown;
  result: unknown;
  loading: boolean;
  loadError: string;
}
```

```vue
<script setup lang="ts">
import type { ToolRendererProps, ToolRenderers } from '@cieljs/console';

import SendDanmakuToolCall from './SendDanmakuToolCall.vue';

// 普通常量，或 markRaw(fn)——不要放进 reactive。
const toolRenderers: ToolRenderers = {
  send_danmaku: SendDanmakuToolCall,
};
</script>
```

渲染器只替换块的正文；折叠标题与状态图标仍由 Ciel Console 渲染。`result` 是工具的原始返回值
（`{ content, details }`），未取到时为 `undefined`；`loadError` 表示 Ciel Console 取值失败，与工具
本身执行失败（`status === 'error'`）不是一回事。

### 自定义消息渲染器

`MessageRenderers` 是一组有序谓词。第一个命中的渲染器负责整条消息；全部未命中时走默认的
Markdown/图片渲染：

```ts
import type { MessageRendererMatch, MessageRenderers } from '@cieljs/console';

import RoomDecisionMessage from './RoomDecisionMessage.vue';

const messageRenderers: MessageRenderers = [
  {
    match: (message: MessageRendererMatch) =>
      message.name === 'assistant' && 'action' in (message.json ?? {}),
    component: RoomDecisionMessage,
  },
];
```

渲染器组件收到的 `MessageRendererProps` 包含 `name`、`label?`、`text`、`json?`、`model?` 与
`status`。只有整串文本本身是 JSON 对象或数组时 `json` 才存在，因此宿主可以识别自己的结构化协议，
而无需自行解析。

### 内容插槽与主题

对话面板与执行面板都会把 `content` 插槽转发给当前详情视图，宿主可以改变载荷的绘制方式，而取值仍由
Ciel Console 负责。

```vue
<template>
  <CielConsole :client="client">
    <template #content="{ entry, section, value, defaultRenderer }">
      <component :is="defaultRenderer" v-if="section !== 'raw'" :value="value" />
      <pre v-else>{{ value }}</pre>
    </template>
  </CielConsole>
</template>
```

`style.css` 还定义了界面各处使用的 `--dt-*` 自定义属性，每一项都回落到宿主变量：`--dt-accent`
（`--accent`）、`--dt-background`（`--surface`）、`--dt-raised`（`--surface-raised`）、`--dt-text`
（`--foreground`）、`--dt-muted`（`--muted`）与 `--dt-border`（`--border`）。自定义渲染器可以沿用
同一组变量以保持外观一致。

## 组合式函数与指令

### `useConsole(client)`

为挂载它的组件持有实时订阅、历史分页、会话选择与清空。`CielConsole`、`CielChat` 与
`ExecutionTraceInspect` 各自调用一次，因此每个已挂载的组件都会打开自己的 `updates` 订阅。

| 返回值                      | 类型                                     | 说明                                         |
| --------------------------- | ---------------------------------------- | -------------------------------------------- |
| `entries`                   | `Ref<TraceEntry[]>`                      | 所选会话的对话条目，上限 600 条              |
| `steps`                     | `Ref<TraceEntry[]>`                      | 所选会话的步骤                               |
| `sessions`                  | `Ref<TraceSession[]>`                    | 最近一次推送带来的会话                       |
| `selectedSession`           | `ComputedRef<TraceSession \| undefined>` | 从 `sessions` 中解析得到                     |
| `selectedSessionId`         | `Ref<string>`                            | 当前选中的会话 id                            |
| `usage`                     | `ComputedRef<TraceUsageState>`           | 所选会话的用量，未知时为 `emptyUsage()`      |
| `error`                     | `Ref<string>`                            | 最近一次连接或请求错误                       |
| `connected`                 | `Ref<boolean>`                           | 订阅是否已经产生过推送                       |
| `hasOlder` / `loadingOlder` | `Ref<boolean>`                           | 历史分页状态                                 |
| `older()`                   | function                                 | 加载上一页（100 条步骤）                     |
| `selectSession(sessionId)`  | function                                 | 切换会话并重放其快照                         |
| `replay()`                  | function                                 | 重新加载当前会话最多 300 条条目与 100 条步骤 |
| `connect()`                 | function                                 | （重新）打开 `updates` 订阅                  |
| `clear()`                   | function                                 | 隐藏当前会话已加载的全部内容                 |

它会在挂载时连接，并在卸载时中止所有进行中的请求。

### `useTraceValue(client, entry, section)` —— 内部

按需加载唯一一份被引用的载荷，返回 `{ value, error, loading }`。`section` 取
`'input' | 'output' | 'raw' | 'error' | 'schema'` 之一。条目、其 `revision` 或 section 变化时会中止
上一个请求，因此旧响应永远不会覆盖新的选择；而同一条流式消息的更新会保留当前内容，不会闪烁。

### `vFollowScroll` —— `v-follow-scroll`

用于滚动容器的指令。内容流式更新时保持贴底；用户一旦自己往上滚就停止跟随，滚回底部后恢复跟随。
滚离底部时它会在元素上设置 `data-detached` 属性，「返回底部」按钮正是据此显示。绑定值为 `false`
时，在用户至少主动滚离过一次之前不跟随。它监听 DOM 变更、尺寸变化、图片加载与滚动事件，并把距底部
24 像素以内都算作仍然贴底。

## 工具函数

只有用量相关的辅助函数属于公开 API：

| 导出                   | 说明                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| `emptyUsage()`         | 各项计数为零、`context` 为 `null` 的 `TraceUsageState`             |
| `cacheHitRate(usage)`  | `cacheRead / (input + cacheRead + cacheWrite)`，提示为空时返回 `0` |
| `formatTokens(tokens)` | 小于一千按整数，之后压成带一位小数的 `k`/`M`                       |
| `formatPercent(rate)`  | `0%`、一位小数，达到 99.95 % 及以上直接显示 `100%`                 |

塑造界面表现的内部辅助函数：`mergeTraceEntries`、`groupTraceSteps`、`indexToolCalls`、
`conversationEntries`、`toolCallStatus`、`toolResultEntry`、`toolResultPayload`、`toolResultText`、
`messageText`、`wholeJson`、`readableText`、`jsonSafe`、`jsonText`、`jsonMarkdown` 与
`imageSource`。

## API 参考

### `@cieljs/console` — `src/ui/index.ts`

| 导出                                                                         | 类型      | 说明                                             |
| ---------------------------------------------------------------------------- | --------- | ------------------------------------------------ |
| `CielConsole`                                                                | component | 组合式控制台：页签、会话栏、执行与对话面板       |
| `CielChat`                                                                   | component | 单会话的对话面板                                 |
| `ExecutionTraceInspect`                                                      | component | 单会话的执行轨迹列表与检查器                     |
| `ContentRenderer`                                                            | component | 渲染文本、图片、思考块、工具调用与 JSON          |
| `MessageView`                                                                | component | 单条消息卡片，含自定义渲染器查找                 |
| `ToolCallRenderer`                                                           | component | 单次工具调用，可由宿主组件渲染                   |
| `SessionStatus`                                                              | component | 会话轮次/步数计数与用量浮层                      |
| `SessionToolbar`                                                             | component | 视图页签、会话选择器与宿主插槽                   |
| `useConsole`                                                                 | function  | 订阅、分页与会话状态组合式函数                   |
| `vFollowScroll`                                                              | directive | 保持滚动容器贴底                                 |
| `emptyUsage`                                                                 | function  | 全零的 `TraceUsageState`                         |
| `cacheHitRate`                                                               | function  | 给定 `TraceUsage` 的缓存命中率                   |
| `formatTokens`                                                               | function  | 紧凑的 token 计数                                |
| `formatPercent`                                                              | function  | 百分比格式化                                     |
| `TraceClient`、`TraceEntry`、`TraceSession`、`TraceUsage`、`TraceUsageState` | types     | 由 `@cieljs/trace` 再导出                        |
| `ToolRendererProps`                                                          | type      | 交给自定义工具渲染器的数据                       |
| `ToolRenderers`                                                              | type      | `Record<string, Component>`                      |
| `MessageRenderer`                                                            | type      | `{ match, component }`                           |
| `MessageRendererMatch`                                                       | type      | `{ name, label?, text, json? }`                  |
| `MessageRendererProps`                                                       | type      | `MessageRendererMatch` 加上 `model?` 与 `status` |
| `MessageRenderers`                                                           | type      | `readonly MessageRenderer[]`                     |

### `@cieljs/console/style.css`

样式入口：先引入 `markstream-vue/index.css` 与 `vue-json-pretty/lib/styles.css`，再定义
`.ciel-console` 容器、`--dt-*` 主题变量，以及组件使用的全部 `dt-*` 类。宿主应用引入一次即可。

## 设计取舍

每个已挂载组件各自持有一个订阅：`useConsole` 会被 `CielConsole`、`CielChat` 与 `ExecutionTraceInspect` 分别实例化，所以传输成本敏感时只挂载其中一个，而不是三个都要。

旧响应是取消，不是对账。`connect`、`replay`、`older` 与 `useTraceValue` 各自持有 `AbortController`；新请求开始前会中止上一个，期间目标会话或目标条目发生变化时结果也会被丢弃。

清空只是隐藏，不是删除。`clear()` 按会话记录当前可见的最大序号并过滤掉小于等于它的记录，而会话用量不受影响，因为它由宿主在存储层累计。重放与实时推送是合并关系而不是替代关系：快照查询通过 `mergeTraceEntries` 并入现有数组，因此稍旧的查询结果永远不会覆盖更新的流式事件。

重渲染成本是被刻意管理的。内容等价时 `indexToolCalls` 会复用上一个 `Map` 实例，`CielConsole` 也按条目 id 复用索引，因此流式更新不会让每张消息卡片的 props 失效。

运行中的耗时不读墙上时钟。仍在运行的步骤分组用 `runningUntil`（所在 run 最后一次观察到的事件）计算耗时，被中断的 run 因此不再无限增长。

渲染器不能是响应式的。`toolRenderers` 与 `messageRenderers` 都要求普通常量或 `markRaw`；放进 `reactive`/`ref` 会重建组件引用并破坏 props 同一性。

状态有优先级：工具调用取工具步骤的状态，只要有一个参与分组的步骤出错，分组即为 `error`，而 `toolResult` 消息既不会重新开始工具，也不会延长它的耗时。无障碍同样是契约的一部分——工具栏、分栏手柄、图片与图标按钮都带 `aria-label`/`role` 属性，分栏手柄暴露 `aria-valuenow`、`aria-valuemin` 与 `aria-valuemax`。

> [!WARNING]
> 包内界面文案（页签名、空状态、按钮）是中文的。源码里没有 i18n 层；需要其它语言的宿主必须自行包装
> 或替换这些组件。

## 开发

本包声明的脚本：

| 脚本             | 命令           | 作用                    |
| ---------------- | -------------- | ----------------------- |
| `check`          | `vp check`     | 格式化、lint 与类型检查 |
| `prepublishOnly` | `vp run build` | 发布前构建              |

`vite.config.ts` 为打包注册了 Vue 插件，并定义两个入口：`index`（`src/ui/index.ts`）与 `style`
（`src/ui/styles/main.css`），同时开启声明文件生成。Vite+ 任务图暴露 `build`（`vp pack`，依赖依赖项
的 `build` 任务）与 `test`（`vp test`）：

```sh
vp install
vp run test
vp check
```

测试覆盖消息渲染器匹配、内容格式化、工具调用连接、轨迹条目分组与用量格式化。
