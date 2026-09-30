<h1 align="center">@cieljs/investigation</h1>

<p align="center">Reusable investigation chat UI: target-scoped conversations, a session sidebar and an agent conversation rendered by Ciel Console.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#overview">Overview</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#the-investigationchat-component">The component</a> ·
  <a href="#the-client-contract">Client contract</a> ·
  <a href="#api-reference">API reference</a> ·
  <a href="#behavior-notes--design-decisions">Behavior notes</a>
</p>

## Overview

`@cieljs/investigation` wraps [`@cieljs/console`](../console/README.md) in a thin shell for one workflow. It adds what an investigation needs and nothing else: a list of conversations scoped to a target, a target picker, an inline-editable title and a composer with a stop button.

There is no transport here and no data layer. The package renders whatever an `InvestigationClient` returns, and shows the agent's answer with `CielChat`, which reads it through a separate `TraceClient` from [`@cieljs/trace`](../trace/README.md). One conversation is one session id, and the two clients have to agree on that id.

## Concepts

The component talks to one contract, `InvestigationClient`, whose seven methods are listed under [Client contract](#the-client-contract). The rest of the vocabulary is small. `InvestigationTargetInput` is what the host creates a conversation for: `{ type: 'global' }` or `{ type: 'room', roomId }`. `InvestigationConversation` is the conversation itself, carrying `sessionId`, `target`, `title`, `label`, `createdAt` and an optional `room`. `InvestigationRoom` is `{ roomId, title, streamerName }`, which feeds the "current room" shortcut. `InvestigationUpdate` is the only push defined today: `{ type: 'title_updated', sessionId, title }`.

The session id is the hinge. It is the `TraceClient` session the agent's answer is read from, so conversations and traces are joined by that single string. `TraceClient` is the oRPC client from `@cieljs/trace/client`, passed straight through to `CielChat`.

## Quick start

Inside this monorepo the package is consumed through the `workspace:` protocol, and `vue` is a peer dependency (`^3.5.0 || ^3.6.0-0`). The host needs both stylesheets, because the conversation inside is rendered by Ciel Console:

```ts
import '@cieljs/console/style.css';
import '@cieljs/investigation/style.css';
```

Mount the component with the two clients it needs:

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

An oRPC router whose procedure names match the contract satisfies `InvestigationClient` as is. That is how the bundled Electron app wires it: its `investigation` router exposes exactly `list`, `create`, `rename`, `delete`, `updates`, `prompt` and `abort`, so the generated client is passed directly. When the names differ, adapt them explicitly:

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

Pass the current room and the target picker offers it as a shortcut:

```vue
<InvestigationChat :client="client" :trace-client="traceClient" :current-room="room" />
```

## The InvestigationChat component

| Prop               | Type                                   | Default  | Notes                                                  |
| ------------------ | -------------------------------------- | -------- | ------------------------------------------------------ |
| `client`           | `InvestigationClient`                  | required | Conversation list and lifecycle                        |
| `traceClient`      | `TraceClient`                          | required | Handed to `CielChat` to render the agent answer        |
| `currentRoom`      | `InvestigationRoom`                    | —        | Enables the "current room" option in the target picker |
| `sidebarCollapsed` | `boolean` (`v-model:sidebarCollapsed`) | `false`  | Collapsed state; also drives the `collapsed` class     |

It calls `initialize()` once on mount. After that you have:

- A sidebar of conversations, newest first, with a create popover; collapsed hides it.
- A divider between the sidebar and the workspace that resizes with the pointer or the keyboard. The sidebar width is published as the `--investigation-sidebar-width` CSS variable and clamped between 176 px and `min(320, viewportWidth - 520)` px.
- A header with the conversation title. Clicking it opens an inline input (max 80 characters) that saves on submit or blur and cancels on `Esc`. Under the title sits the conversation `label`, falling back to `准备调查环境…`.
- An error alert (`role="alert"`) when `error` is set.
- The conversation itself: `CielChat` with `:session-id="conversation.sessionId"`, or a placeholder while the conversation is being created.
- A composer that sends with `Enter`, wraps with `Shift+Enter`, ignores IME composition, grows to at most 160 px and switches to a stop button while a prompt is running.
- A "back to bottom" button, driven by the `vFollowScroll` directive from `@cieljs/console`.

Internal components, in case you want to reuse a corner of it:

| Component                   | Props                                                                                                    | Notes                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `InvestigationSidebar`      | `conversations: readonly InvestigationConversation[]`, `selectedSessionId?`, `currentRoom?`, `disabled?` | Emits `create(target)` and `select(sessionId)`; carries `id="investigation-sidebar"` so hosts can point `aria-controls` at it |
| `InvestigationTargetPicker` | `currentRoom?`, `disabled?`                                                                              | Emits `create(target)`; offers global, the current room, or a manually entered room id that must be a positive safe integer   |
| `InvestigationComposer`     | `disabled?`, `running?`                                                                                  | Emits `submit(content)` and `abort`                                                                                           |

## The client contract

| Method    | Signature                                                                                                | Purpose                                                |
| --------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `list`    | `() => Promise<InvestigationConversation[]>`                                                             | Conversations to show in the sidebar                   |
| `create`  | `(input: { target: InvestigationTargetInput }) => Promise<InvestigationConversation>`                    | Create a conversation for a target                     |
| `rename`  | `(input: { sessionId: string; title: string }) => Promise<InvestigationConversation>`                    | Persist a new title; returns the updated conversation  |
| `delete`  | `(input: { sessionId: string }) => Promise<void>`                                                        | Permanently remove a conversation session              |
| `updates` | `(input?: undefined, options?: { signal?: AbortSignal }) => Promise<AsyncIterable<InvestigationUpdate>>` | Long-lived push stream, currently used to sync titles  |
| `prompt`  | `(input: { sessionId: string; content: string }) => Promise<InvestigationConversation>`                  | Run one question; resolves when the answer is complete |
| `abort`   | `(input: { sessionId: string }) => Promise<void>`                                                        | Stop the answer that is currently running              |

The contract hands the host three jobs.

The host owns the target. `InvestigationTargetInput` is only what the user picked, and turning it into the real scope (memory space, sources, tool permissions) is your job, because the component never inspects what the agent is allowed to touch.

The agent has to run under `conversation.sessionId`, because that is where the answer is read from. In the bundled app these ids start with `investigation:`, which lets it mount a dedicated trace router with `session: sessionId => sessionId.startsWith('investigation:')` next to the main one.

The host pushes title changes. Renaming somewhere else, for example an auto-generated title after the first question, is published as an `InvestigationUpdate` of type `title_updated` and applied in place.

## API reference

### `@cieljs/investigation` — `src/index.ts`

| Export                      | Kind      | Description                                              |
| --------------------------- | --------- | -------------------------------------------------------- |
| `InvestigationChat`         | component | Sidebar, editable title, conversation and composer       |
| `InvestigationClient`       | type      | The seven-method contract described above                |
| `InvestigationConversation` | type      | `{ sessionId, target, title, label, createdAt, room? }`  |
| `InvestigationRoom`         | type      | `{ roomId, title, streamerName }`                        |
| `InvestigationTargetInput`  | type      | `{ type: 'global' } \| { type: 'room', roomId: number }` |
| `InvestigationUpdate`       | type      | `{ type: 'title_updated', sessionId, title }`            |

### `@cieljs/investigation/style.css`

The layout stylesheet. `.investigation-chat` is a three-column grid (`var(--investigation-sidebar-width, 216px) 1px minmax(0, 1fr)`), and the sidebar uses `color-mix()` over `--surface` with a backdrop blur. Colors fall back to `--foreground` and `--surface`, the same variables Ciel Console uses.

### Composable reference

Both composables are internal, but they define the component's behavior.

`useInvestigationChat(client)` owns all conversation state:

| Returned            | Type         | Description                                                                                          |
| ------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `conversations`     | readonly ref | Every known conversation                                                                             |
| `conversation`      | readonly ref | The selected one                                                                                     |
| `pending`           | readonly ref | `'create' \| 'delete' \| undefined`                                                                  |
| `sessionPending`    | readonly ref | Per-session map of `'prompt' \| 'abort'` states                                                      |
| `error`             | ref          | Last error message; writable so the host can clear it                                                |
| `initialize()`      | function     | Connect updates, `list()`, select the newest, or create a global conversation when the list is empty |
| `create(target)`    | function     | Create and select a conversation                                                                     |
| `select(sessionId)` | function     | Select a conversation already in the list                                                            |
| `rename(title)`     | function     | Rename the selected conversation (trimmed, ignored when empty)                                       |
| `remove(sessionId)` | function     | Delete a conversation and select the next available one                                              |
| `prompt(content)`   | function     | Send a question (trimmed, ignored when empty or busy)                                                |
| `abort()`           | function     | Stop the running answer                                                                              |

`useInvestigationSidebar()` owns the splitter: `width` (216 by default), `maxWidth`, `dragging`, `startDrag`, `moveDrag`, `endDrag` and `keyboardResize`. Arrow keys move 16 px at a time, `Home` jumps to 176 px and `End` to `maxWidth`. The width is re-clamped on window resize.

## Behavior notes / Design decisions

- **The component is stateless about persistence.** Everything it shows comes from `client.list()` and the `updates` stream, and it keeps no local store. A host can restart the window without losing conversations, as long as its own list method can rebuild them.
- **`initialize()` never leaves you without a conversation.** An empty list from the host creates a global conversation automatically, which is why the workspace shows a placeholder rather than an empty state on first run.
- **A provisional title is optimistic.** While the selected conversation is still called `新调查`, the first question immediately becomes the local title (whitespace collapsed, 36 characters), before the server responds, so the sidebar is never untitled while the model works. The host replaces it later through `rename` or `title_updated`.
- **Abort is not an error.** While the selected session is marked as `prompt`, the composer shows a stop button. Once `abort()` is called, the session id is remembered, so the rejection produced by the cancelled `prompt` promise is swallowed instead of surfacing as an error alert. The flag is cleared either way.
- **Answer state belongs to each session.** You can switch sessions, create another investigation, and prompt an idle session while another answer is running. Only a session marked as `abort` has its own composer disabled.
- **The updates subscription is lifetime-bound.** It is opened once, reused across `initialize()` calls, and aborted by `onScopeDispose`, so it ends with the component scope rather than leaking.
- **The sidebar width is responsive, not persisted.** It is clamped against the viewport (`viewportWidth - 520`) and reset when the window changes size. The component does not write it to storage.
- **Collapsed is a model, not internal state.** `v-model:sidebarCollapsed` lets the host drive its own header button, which is how the bundled app toggles the sidebar from outside the component.

> [!NOTE]
> The UI copy is Chinese (sidebar heading, empty states, composer hint). Like Ciel Console, this package has no i18n layer.

## Development

The package declares two scripts:

| Script           | Command        | Purpose                     |
| ---------------- | -------------- | --------------------------- |
| `check`          | `vp check`     | Format, lint and type check |
| `prepublishOnly` | `vp run build` | Build before publishing     |

`vite.config.ts` registers the Vue plugin and defines two pack entries, `index` (`src/index.ts`) and `style` (`src/style.css`), with declarations enabled. The Vite+ task graph exposes `build` (`vp pack`, depending on the `build` task of its dependencies) and `test` (`vp test`):

```sh
vp install
vp run test
vp check
```

There are no test files in this package yet; the `test` task exists through the shared task configuration.
