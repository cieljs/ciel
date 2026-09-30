<h1 align="center">@cieljs/console</h1>

<p align="center">Vue 3 UI for Ciel: conversation view, execution trace inspection, session and usage status, plus renderer extension points.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#overview">Overview</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#components">Components</a> ·
  <a href="#extension-points">Extension points</a> ·
  <a href="#api-reference">API reference</a> ·
  <a href="#design-notes">Design notes</a>
</p>

## Overview

`@cieljs/console` renders the data exposed by [`@cieljs/trace`](../trace/README.md). It has three
jobs: show the agent conversation, show the execution trace step by step, and let a host replace how
individual tools and messages are drawn.

The package is a plain Vue 3 library. It never creates a connection: every component takes a
`TraceClient` and calls it. It ships a single stylesheet at `@cieljs/console/style.css` and depends
on `@vuetify/v0` for interactive primitives, `markstream-vue` for Markdown and `vue-json-pretty` for
the JSON tree.

## Concepts

| Noun               | Meaning                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `TraceClient`      | The oRPC client from `@cieljs/trace/client`; every component receives one as a prop                             |
| `TraceEntry`       | One conversation entry or projected step; the unit both views render                                            |
| `TraceStepGroup`   | A step merged with every later event of the same business object, plus `events`, `updatedAt` and `runningUntil` |
| `TraceSession`     | Session row rendered by the toolbar and the status bar                                                          |
| `TraceUsageState`  | `{ total, context }`, formatted by the status bar                                                               |
| Conversation view  | The message stream built from `entry` records                                                                   |
| Execution view     | The step list plus the inspector panel, built from `step` records                                               |
| `ToolCallRecord`   | `{ call?, result? }` joined by `toolCallId` from a tool step and its `toolResult` message                       |
| `ToolRenderers`    | `Record<string, Component>` keyed by tool machine name                                                          |
| `MessageRenderers` | An ordered list of `{ match, component }` predicates for whole messages                                         |
| `useConsole`       | The composable that owns the subscription, history pagination, session selection and clearing                   |

## Install

Inside this monorepo the package is consumed through the workspace protocol:

```json
{
  "dependencies": {
    "@cieljs/console": "workspace:*"
  }
}
```

`vue` is a peer dependency (`^3.5.0 || ^3.6.0-0`), so the host application provides it.

## Quick start

Import the stylesheet once, then mount the combined console with a trace client:

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

Focused integrations can mount one view instead of the tabbed console:

```vue
<template>
  <CielChat :client="client" :session-id="sessionId" empty-text="还没有对话。" />
  <ExecutionTraceInspect :client="client" :session-id="sessionId" />
</template>
```

Both components come from `@cieljs/console` and need the same stylesheet import.

## Components

### `CielConsole`

The combined shell: view tabs, session selector, a clear button, the execution panel, the
conversation panel and the status bar.

| Prop               | Type               | Default  | Notes                                                                                       |
| ------------------ | ------------------ | -------- | ------------------------------------------------------------------------------------------- |
| `client`           | `TraceClient`      | required | Trace client used for the subscription and for on-demand reads                              |
| `autoScroll`       | `boolean`          | `true`   | Follow the bottom while the conversation streams                                            |
| `sessionId`        | `string`           | —        | Active session; when it changes the console switches, manual selections are kept until then |
| `toolRenderers`    | `ToolRenderers`    | —        | Custom tool renderers; use a plain constant or `markRaw`, never a reactive object           |
| `messageRenderers` | `MessageRenderers` | —        | Custom message renderers, same non-reactive rule                                            |

The `content` slot is forwarded to whichever detail panel is active, with `entry`, `section`,
`value` and `defaultRenderer` in scope.

The `actions` slot lands in the toolbar, between the session selector and the clear button, so a host
can put its own commands next to the view controls. The console never learns what those buttons do —
their label, disabled state and busy state stay the host's business. Give them
`class="dt-button dt-action"` to pick up the console's 28 × 24 icon-button geometry, hover and
disabled styling.

### Conversation components

| Component                      | Props                                                                                                       | Notes                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `CielChat`                     | `client`, `sessionId` (required), `autoScroll` (`true`), `emptyText`, `toolRenderers`, `messageRenderers`   | Conversation panel for one session; renders the last 100 messages                |
| `MessageView`                  | `client`, `entry`, `toolCalls?`, `toolRenderers?`, `messageRenderers?`                                      | One message card; exposes a `content` slot                                       |
| `AgentConversation` (internal) | `client`, `messages`, `toolCalls`, `autoScroll`, `active`, `emptyText`, `toolRenderers`, `messageRenderers` | The scrolling list itself; re-sticks to the bottom when it becomes visible again |

`CielConsole` renders the last 50 messages of the selected session; `CielChat` renders the last 100.
Both delegate the actual card to `MessageView`.

### Execution components

| Component                  | Props                                                                                                     | Notes                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ExecutionTraceInspect`    | `client`, `sessionId` (required), `toolRenderers?`                                                        | Trace-only panel with the same list/detail split                             |
| `ExecutionView` (internal) | `client`, `steps`, `hasOlder`, `loadingOlder`, `toolCalls?`, `toolRenderers?`, `v-model:query` (required) | Filter box, list, draggable splitter and detail; emits `older`               |
| `TraceDetail` (internal)   | `client`, `entry`, `toolCalls?`, `toolRenderers?`                                                         | Tabbed inspector; emits `close`                                              |
| `TraceList` (internal)     | `entries`, `selectedId`                                                                                   | Row list with status, start time, duration and turn dividers; emits `select` |

`ExecutionView` filters on `label`, `name`, `id`, `sessionId` and `toolCallId`, requests older pages
when the list scrolls within 80 px of the top, and keeps requesting pages while the list does not
fill its viewport. The splitter is clamped between 20 % and 75 % and supports arrow keys.

`TraceDetail` shows tool steps with overview, args, result, schema, timing, and raw event tabs,
and other steps with overview, message, thinking, timing, and raw event tabs. When a group
holds more than one raw event, a selector switches between them.

### Content components

| Component                                            | Props                                                                | Notes                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ContentRenderer`                                    | `value`, `final` (`true`), `client?`, `toolCalls?`, `toolRenderers?` | Renders text as Markdown, image blocks as zoomable images, `thinking` inside a disclosure, tool calls through `ToolCallRenderer`, anything else as formatted JSON |
| `ToolCallRenderer` (exported as `ToolCallView.vue`)  | `client?`, `call?`, `result?`, `block?`, `renderer?`, `status?`      | One tool call: header with status, custom renderer or the default args/result view                                                                                |
| `SessionStatus` (exported as `SessionStatusBar.vue`) | `session?: TraceSession`                                             | Turn/step counter and a usage popover                                                                                                                             |
| `SessionToolbar`                                     | `sessions: TraceSession[]`, `v-model:session-id` (required)          | View tabs, session selector and a default slot for host actions                                                                                                   |

> [!NOTE]
> `ContentRenderer` uses `markstream-vue` with `html-policy="escape"`, so raw HTML in trace content
> is never executed.

## Extension points

### Custom tool renderers

`ToolRenderers` maps a tool machine name to a component. The component receives plain data — Ciel
Console owns the value loading:

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

// A plain constant, or markRaw(fn) — never a reactive object.
const toolRenderers: ToolRenderers = {
  send_danmaku: SendDanmakuToolCall,
};
</script>
```

A renderer replaces only the body of the block; the disclosure title and the status icon are still
rendered by Ciel Console. `result` is the raw tool return value (`{ content, details }`) and is
`undefined` until it loads, while `loadError` reports a failure of Ciel Console's own value read —
which is not the same as the tool failing (`status === 'error'`).

### Custom message renderers

`MessageRenderers` is an ordered list of predicates. The first match renders the whole message;
when nothing matches, the default Markdown/image rendering runs:

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

A renderer's component receives `MessageRendererProps`: `name`, `label?`, `text`, `json?`, `model?`
and `status`. `json` is only present when the entire message text is a JSON object or array, so a
host can recognize its own structured protocol without parsing anything itself.

### Content slot and theming

Both the conversation and the execution panel forward a `content` slot to the active detail view, so
a host can override how a payload is drawn while Ciel Console keeps loading it.

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

`style.css` also defines the `--dt-*` custom properties used across the UI, each falling back to a
host variable: `--dt-accent` (`--accent`), `--dt-background` (`--surface`), `--dt-raised`
(`--surface-raised`), `--dt-text` (`--foreground`), `--dt-muted` (`--muted`) and `--dt-border`
(`--border`). Custom renderers can use the same variables to stay consistent.

## Composables and directives

### `useConsole(client)`

Owns the live subscription, history pagination, session selection and clearing for the components
that mount it. `CielConsole`, `CielChat` and `ExecutionTraceInspect` each call it, so each mounted
component opens its own `updates` subscription.

| Returned                    | Type                                     | Description                                                    |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| `entries`                   | `Ref<TraceEntry[]>`                      | Conversation entries of the selected session, capped at 600    |
| `steps`                     | `Ref<TraceEntry[]>`                      | Steps of the selected session                                  |
| `sessions`                  | `Ref<TraceSession[]>`                    | Sessions from the latest push                                  |
| `selectedSession`           | `ComputedRef<TraceSession \| undefined>` | Resolved from `sessions`                                       |
| `selectedSessionId`         | `Ref<string>`                            | Selected session id                                            |
| `usage`                     | `ComputedRef<TraceUsageState>`           | Usage of the selected session, `emptyUsage()` when unknown     |
| `error`                     | `Ref<string>`                            | Last connection or request error                               |
| `connected`                 | `Ref<boolean>`                           | Whether the subscription produced a push                       |
| `hasOlder` / `loadingOlder` | `Ref<boolean>`                           | History pagination state                                       |
| `older()`                   | function                                 | Load the previous page (100 steps)                             |
| `selectSession(sessionId)`  | function                                 | Switch session and replay its snapshot                         |
| `replay()`                  | function                                 | Reload up to 300 entries and 100 steps for the current session |
| `connect()`                 | function                                 | (Re)open the `updates` subscription                            |
| `clear()`                   | function                                 | Hide everything loaded so far for the current session          |

It connects on mount and aborts every in-flight request on unmount.

### `useTraceValue(client, entry, section)` — internal

Loads exactly one referenced payload on demand and returns `{ value, error, loading }`. `section` is
one of `'input' | 'output' | 'raw' | 'error' | 'schema'`. Changing the entry, its `revision` or the
section aborts the previous request, so a stale response can never overwrite a newer selection, while
streaming updates of the same message keep the current content on screen instead of flickering.

### `vFollowScroll` — `v-follow-scroll`

A directive for a scrolling container. It keeps the container pinned to the bottom while content
streams in, stops following as soon as the user scrolls away, and resumes when they return. While
detached it sets the attribute `data-detached` on the element, which is how the "back to bottom"
buttons decide to appear. A binding value of `false` disables following until the user has detached
at least once. It observes mutations, resizes, image loads and scroll events, and treats anything
within 24 px of the bottom as still attached.

## Utilities

Only the usage helpers are part of the public API:

| Export                 | Description                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| `emptyUsage()`         | `TraceUsageState` with zero counts and `context: null`                       |
| `cacheHitRate(usage)`  | `cacheRead / (input + cacheRead + cacheWrite)`, `0` when the prompt is empty |
| `formatTokens(tokens)` | `0`, an integer below 1000, then `k`/`M` with one decimal                    |
| `formatPercent(rate)`  | `0%`, one decimal, and `100%` at or above 99.95 %                            |

Internal helpers shape what the UI shows: `mergeTraceEntries`, `groupTraceSteps`, `indexToolCalls`,
`conversationEntries`, `toolCallStatus`, `toolResultEntry`, `toolResultPayload`, `toolResultText`,
`messageText`, `wholeJson`, `readableText`, `jsonSafe`, `jsonText`, `jsonMarkdown` and `imageSource`.

## API reference

### `@cieljs/console` — `src/ui/index.ts`

| Export                                                                       | Kind      | Description                                                            |
| ---------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| `CielConsole`                                                                | component | Combined console: tabs, session bar, execution and conversation panels |
| `CielChat`                                                                   | component | Conversation panel for one session                                     |
| `ExecutionTraceInspect`                                                      | component | Execution trace list and inspector for one session                     |
| `ContentRenderer`                                                            | component | Renders text, images, thinking blocks, tool calls and JSON             |
| `MessageView`                                                                | component | One message card with the custom-renderer lookup                       |
| `ToolCallRenderer`                                                           | component | One tool call, optionally rendered by a host component                 |
| `SessionStatus`                                                              | component | Session turn/step counter and usage popover                            |
| `SessionToolbar`                                                             | component | View tabs, session selector and host slot                              |
| `useConsole`                                                                 | function  | Subscription, pagination and session state composable                  |
| `vFollowScroll`                                                              | directive | Keep a scroll container pinned to the bottom                           |
| `emptyUsage`                                                                 | function  | Zeroed `TraceUsageState`                                               |
| `cacheHitRate`                                                               | function  | Cache hit rate for a `TraceUsage`                                      |
| `formatTokens`                                                               | function  | Compact token count                                                    |
| `formatPercent`                                                              | function  | Percentage formatting                                                  |
| `TraceClient`, `TraceEntry`, `TraceSession`, `TraceUsage`, `TraceUsageState` | types     | Re-exported from `@cieljs/trace`                                       |
| `ToolRendererProps`                                                          | type      | Data handed to a custom tool renderer                                  |
| `ToolRenderers`                                                              | type      | `Record<string, Component>`                                            |
| `MessageRenderer`                                                            | type      | `{ match, component }`                                                 |
| `MessageRendererMatch`                                                       | type      | `{ name, label?, text, json? }`                                        |
| `MessageRendererProps`                                                       | type      | `MessageRendererMatch` plus `model?` and `status`                      |
| `MessageRenderers`                                                           | type      | `readonly MessageRenderer[]`                                           |

### `@cieljs/console/style.css`

The stylesheet entry: it imports `markstream-vue/index.css` and `vue-json-pretty/lib/styles.css`,
then defines the `.ciel-console` container, the `--dt-*` theme variables and every `dt-*` class used
by the components. Import it once in the host application.

## Design notes

One subscription per mounted component: `useConsole` is instantiated by `CielConsole`, `CielChat` and `ExecutionTraceInspect`, so mount one of them — not all three — when the transport is expensive.

Stale responses are cancelled rather than reconciled. `connect`, `replay`, `older` and `useTraceValue` each hold their own `AbortController`; a previous request is aborted before a new one starts, and results are also discarded when the target session or entry changed in the meantime.

Clearing hides, it does not delete. `clear()` records the highest visible sequence per session and filters anything at or below it, while session usage is unaffected because the host accumulates it in storage. Replay merges with live pushes instead of replacing them: snapshot queries go through `mergeTraceEntries`, so a slightly older query result never overwrites newer streamed events.

Re-render cost is managed deliberately. `indexToolCalls` returns the previous `Map` instance when its content is equivalent, and `CielConsole` keeps the reused index keyed by entry id, so streaming updates do not invalidate every message card.

Running durations never read the wall clock. A step group that is still running takes its duration from `runningUntil`, the last observed event of its run, so an interrupted run stops growing instead of counting up forever.

Renderers must not be reactive. Both `toolRenderers` and `messageRenderers` are documented as plain constants or `markRaw`; passing them through `reactive`/`ref` would re-create component references and break props identity.

Status has a precedence order: a tool call takes its status from the tool step, a group is `error` if any contributing step errored, and a `toolResult` message never restarts the tool or extends its duration. Accessibility is part of the contract too — toolbars, splitters, images and icon buttons carry `aria-label`/`role` attributes, and the splitter exposes `aria-valuenow`, `aria-valuemin` and `aria-valuemax`.

> [!WARNING]
> The package renders Chinese UI copy (tab labels, empty states, buttons). There is no i18n layer in
> the source; a host that needs another language must wrap or replace these components.

## Development

Scripts declared by this package:

| Script           | Command        | Purpose                     |
| ---------------- | -------------- | --------------------------- |
| `check`          | `vp check`     | Format, lint and type check |
| `prepublishOnly` | `vp run build` | Build before publishing     |

`vite.config.ts` registers the Vue plugin for packing and defines two entries: `index`
(`src/ui/index.ts`) and `style` (`src/ui/styles/main.css`), with declarations enabled. The Vite+ task
graph exposes `build` (`vp pack`, depending on the `build` task of its dependencies) and `test`
(`vp test`):

```sh
vp install
vp run test
vp check
```

The test suites cover message renderer matching, content formatting, tool-call joining, trace entry
grouping and usage formatting.
