<h1 align="center">@cieljs/runtime</h1>

<p align="center">The engine that runs Ciel sessions and isolated investigations.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#lifecycle">Lifecycle</a> ·
  <a href="#sessions">Sessions</a> ·
  <a href="#investigations">Investigations</a> ·
  <a href="#api-reference">API reference</a> ·
  <a href="#design-notes">Design notes</a>
</p>

`Runtime` owns runtime state, agents, and the lifetime of sessions and investigations. It does not parse directories, does not create Storage, SessionManager, MemoryManager or MCP, and does not provide `defineCiel()` — those belong to the host.

An application normally uses the top-level [`cieljs`](../cieljs/README.md). Instantiate `Runtime` directly only when you want to assemble every manager yourself.

## Concepts

| Concept       | Type                    | Role                                                          |
| ------------- | ----------------------- | ------------------------------------------------------------- |
| Runtime       | `Runtime`               | Status, open sessions, in-flight investigations               |
| Session       | `RuntimeSession`        | One conversation agent bound to a space, plus its session log |
| Investigation | `runtime.investigate()` | One isolated retrieval run over memory and session history    |
| Sources       | `SessionSources`        | Host-provided identity labels, refreshed before every run     |

## Install

`@cieljs/runtime` is part of the Ciel monorepo and is consumed through the workspace:

```bash
pnpm add @cieljs/runtime
```

The package depends on [`@cieljs/agent-kit`](../agent-kit/README.md) for tool definitions and protocol types, and on [`@cieljs/session`](../session/README.md) and [`@cieljs/memory`](../memory/README.md) for the managers it borrows. The host creates every manager and keeps ownership of it.

## Quick start

`model` and `hostTools` are supplied by the application; the managers are opened by the host, exactly as the top-level `cieljs` package does.

```ts
import { MemoryManager, memoryStorage } from '@cieljs/memory';
import { SessionManager, sessionStorage } from '@cieljs/session';
import { Storage } from '@cieljs/storage';
import { Runtime } from '@cieljs/runtime';

// A shared storage instance, one namespace per concern.
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
  systemPrompt: 'You are Ciel.',
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
  // Only the runtime's own agents are stopped here; the managers stay owned by the host.
  await runtime.close();
}
```

## Lifecycle

`Runtime` reports one of five states through `status`:

| Status     | Meaning                                         |
| ---------- | ----------------------------------------------- |
| `idle`     | Constructed, never started                      |
| `starting` | `start()` is in flight                          |
| `running`  | Sessions and investigations can be opened       |
| `closing`  | `close()` is in flight; no new work is accepted |
| `closed`   | Terminal state                                  |

`start()` is idempotent: it resolves immediately when the runtime is already running, and returns the same promise while a start is still in flight. Once `close()` has begun, `start()` rejects with `Runtime 已开始关闭` (or `Runtime 已开始关闭：closing` / `...：closed`).

`close()` is memoized — the first call does the work, later calls return the same promise. It

1. switches to `closing` so no new session or investigation can start,
2. waits for an in-flight `start()` to settle, even if that start failed,
3. waits for every session that is still opening,
4. closes every open session and waits for every in-flight investigation,
5. reaches `closed` and throws an `AggregateError` (`Runtime 关闭时发生错误`) if any of the steps above failed.

Calling `session()` or `investigate()` while the runtime is not running throws `Runtime 当前不可用：<status>`. `Runtime` also implements `AsyncDisposable`, so `await using runtime = new Runtime(options)` works.

## Sessions

`runtime.session(options)` opens or resumes one conversation session.

| Option       | Default  | Meaning                                                                           |
| ------------ | -------- | --------------------------------------------------------------------------------- |
| `spaceId`    | required | Isolation boundary; a session belongs to exactly one space                        |
| `sessionId`  | —        | Existing id resumes the same history; omitted creates a new session               |
| `sources`    | `[]`     | `string[]` or `() => string[]`, see [Sources and identity](#sources-and-identity) |
| `crossSpace` | `false`  | Allow read-only retrieval of related spaces through session and memory tools      |

The returned `RuntimeSession` exposes `id`, `spaceId`, `agent`, `compact()` and `close()`.

Opening a session assembles the agent in one pass:

- the session is opened through `sessionManager.space(spaceId).session({ id, sources })` and its stored context is restored;
- tools are the host tools from `RuntimeOptions.tools`, then `sessionTools()`, then `memoryTools()` for the current space, then `globalMemoryTools()` for global long-term memory;
- duplicated tool names throw `工具名称重复：<name>`, so a host tool can never silently shadow a built-in one;
- `crossSpace: true` becomes `access: 'related'` for both managers: other spaces are reached through source discovery, not by searching every body directly;
- memory tools receive `[`session:${session.id}`, ...sources]` as their sources;
- every agent event is recorded into the session together with `{ tools, model }`, so the session log is the factual record of the run.

`close()` marks the session closed, waits for the agent to become idle and unsubscribes from its events. A later `prompt()` on a closed session throws `Session 已关闭：<id>`, and a failed run surfaces as `Agent 运行失败：<errorMessage>`.

> [!NOTE]
> `RuntimeOptions.tools` are shared with session agents only. Investigations run with the separately configured `RuntimeOptions.investigation.tools`.

## Investigations

`runtime.investigate(options)` runs one isolated investigation and resolves with its answer.

| Option         | Default                                                                         | Meaning                                                           |
| -------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `target`       | required                                                                        | `{ type: 'global' }` or `{ type: 'space', spaceId, sessionId? }`  |
| `question`     | required                                                                        | `string` or `AgentMessage[]`                                      |
| `sessionId`    | —                                                                               | Continues the investigation's own session                         |
| `systemPrompt` | `RuntimeOptions.investigation.systemPrompt`, then `RuntimeOptions.systemPrompt` | Per-investigation prompt override                                 |
| `memoryAccess` | read-only                                                                       | `'read'` or `'read-write'`; writes never leave the target layer   |
| `crossSpace`   | `false`                                                                         | Read-only retrieval of spaces outside the target                  |
| `sources`      | `[]`                                                                            | Same shape as for sessions                                        |
| `signal`       | —                                                                               | Aborting it aborts the agent run                                  |
| `onEvent`      | —                                                                               | `(event, { tools, model }) => void`, called for every agent event |

Investigation sessions live in `investigationManager`, in the space named by the target — `'global'` for a global target, the target's `spaceId` otherwise. A `space` target may additionally name a normal session, unrelated to the investigation's own session id, for `read_target_session` to page through.

Built-in tools:

| Tool                  | Availability                 | Behaviour                                                                                                                        |
| --------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `search_memory`       | always                       | Read-only memory search: every space plus the global layer for a global target, the target space plus the global layer otherwise |
| `read_memory`         | always                       | Read one memory by id, from the target space or the global layer                                                                 |
| `search_sessions`     | always                       | Read-only search over ordinary session bodies; scope follows the target and `crossSpace`, investigations are never searched      |
| `read_session`        | always                       | Read the context around one message of an ordinary session                                                                       |
| `read_target_session` | always                       | Page through the host-specified session; returns nothing unless the target names a session, and cannot change it                 |
| memory write tools    | `memoryAccess: 'read-write'` | `globalMemoryTools()` for a global target, `memoryTools()` for a space target                                                    |

Host tools from `RuntimeOptions.investigation.tools` are appended after these, and duplicate names throw.

The result is `{ sessionId, answer, messages }`, where `answer` is the last assistant message of the run. A run that produced no assistant message throws `Investigation 没有产生最终回答`, and an assistant message carrying `errorMessage` throws `Investigation 失败：<errorMessage>`.

Each call is a single run: the runtime keeps it in flight so `close()` can wait for it, but an investigation has no `close()` of its own — pass a `signal` to stop one early.

## Sources and identity

```ts
type SessionSources = string[] | (() => string[]);
```

- Sources are normalized on every read: trimmed, empty values dropped, duplicates removed while keeping the first occurrence.
- The function form is re-evaluated before every agent run and before every tool call, so a host can follow a moving value such as the current room.
- The session record is updated only when the serialized list actually changed, and the cache advances only after a successful write, so a failed write is retried on the next call.
- Before each model request the runtime inserts a user message containing `<ciel_context>` — `spaceId` and `sources` for a session, `target` and `sources` for an investigation — stating that this identity comes from the host and cannot be overridden by history or tool results.
- Session runs additionally inject `<historical_memory>` with the global long-term, space long-term and space daily memory when they are present, marked as possibly outdated material rather than current instructions.

Memory recall failing does not block a turn, and explicit memory tools still report the real error. An abort during recall is re-thrown.

## Context and compaction

| Option               | Default                                  | Meaning                                 |
| -------------------- | ---------------------------------------- | --------------------------------------- |
| `contextWindow`      | the conversation model's `contextWindow` | Window used to decide when to compact   |
| `reserveTokens`      | `@cieljs/session` default (`16384`)      | Tokens reserved for the next generation |
| `keepRecentMessages` | `@cieljs/session` default (`10`)         | Minimum recent raw messages to keep     |

The automatic path runs once before every agent run and respects the session's threshold. `RuntimeSession.compact()` is the manual path: it waits for the agent to become idle, ignores the threshold, and resolves with whether a new summary was produced. Both paths keep `agent.state.messages` in sync with the compacted `session.context()`.

Summaries are produced with the same conversation model: `DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT` from [`@cieljs/session`](../session/README.md), a `maxTokens` budget of `2048`, and images reduced to `{ type: 'image', mimeType }` so the summary input carries no base64 payloads. A response that did not stop normally, or an empty summary, throws instead of replacing history.

## API reference

`@cieljs/runtime`

| Export                                                                                                                                       | Kind  | Description                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `Runtime`                                                                                                                                    | class | Entry point; owns status, sessions and investigations                                    |
| `RuntimeOptions`                                                                                                                             | type  | Constructor options                                                                      |
| `OpenRuntimeSessionOptions`                                                                                                                  | type  | `{ spaceId, sessionId?, sources?, crossSpace? }`                                         |
| `RuntimeSession`                                                                                                                             | type  | `{ id, spaceId, agent, compact(), close() }` plus async disposal                         |
| `RuntimeStatus`                                                                                                                              | type  | `'idle' \| 'starting' \| 'running' \| 'closing' \| 'closed'`                             |
| `RuntimeCompactionOptions`                                                                                                                   | type  | `{ contextWindow?, reserveTokens?, keepRecentMessages? }`                                |
| `InvestigateOptions`                                                                                                                         | type  | Options for one investigation run                                                        |
| `InvestigationTarget`                                                                                                                        | type  | `{ type: 'global' }` or `{ type: 'space', spaceId, sessionId? }`                         |
| `InvestigationResult`                                                                                                                        | type  | `{ sessionId, answer, messages }`                                                        |
| `SessionSources`                                                                                                                             | type  | `string[] \| (() => string[])`                                                           |
| `AgentEvent`, `AgentMessage`, `RuntimeEvent`, `RuntimeRecord`, `RuntimeReader`, `RuntimeWriter`, `RuntimeMetadata`, `SessionCompactionEvent` | type  | Re-exported from [`@cieljs/agent-kit/protocol`](../agent-kit/README.md#runtime-protocol) |

`Runtime`

| Member                    | Description                                                       |
| ------------------------- | ----------------------------------------------------------------- |
| `constructor(options)`    | Stores `RuntimeOptions`; performs no I/O                          |
| `status`                  | Current `RuntimeStatus`                                           |
| `start()`                 | Idempotent; switches to `running`                                 |
| `session(options)`        | Opens or resumes a session; requires `running`                    |
| `investigate(options)`    | Starts one investigation run; requires `running`                  |
| `close()`                 | Memoized teardown; closes open sessions and awaits investigations |
| `[Symbol.asyncDispose]()` | Calls `close()`                                                   |

`RuntimeOptions`

| Option                 | Kind                         | Meaning                                                                   |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `model`                | `Model<Api>`                 | Conversation model, also used for summaries and investigations            |
| `apiKey`               | `string?`                    | Request-level credential; never written to the environment or persistence |
| `systemPrompt`         | `string`                     | Default prompt for sessions, and the fallback for investigations          |
| `sessionManager`       | `SessionManager`             | Manager backing conversation sessions                                     |
| `investigationManager` | `SessionManager`             | Separate manager backing investigation sessions                           |
| `memoryManager`        | `MemoryManager`              | Manager backing memory tools, recall and the global layer                 |
| `tools`                | `AgentTool[]?`               | Host tools added to every session agent                                   |
| `compaction`           | `RuntimeCompactionOptions?`  | Context compaction overrides                                              |
| `investigation`        | `{ systemPrompt?, tools? }?` | Investigation prompt and host tools                                       |

## Design notes

The runtime borrows every injected manager: `close()` ends its own sessions and investigations and leaves the `SessionManager`, `MemoryManager` and `Storage` untouched for the host to close. A session is bound to one `spaceId`, `crossSpace` only widens read access to related spaces, and investigation writes stay confined to the layer the target names. Sources are refreshed before each run and each tool call, and the agent transcript is re-synced after a compaction, so a long-lived session keeps following host state.

Failures are loud. A duplicate tool name, an unavailable runtime, a closed session and a failed agent run all throw with a message naming the cause, and `close()` reports teardown failures as an `AggregateError` rather than hiding them. Host concerns stay out of this package: directory parsing, `defineCiel()`, MCP and manager construction all live above it — see [`cieljs`](../cieljs/README.md).

## Development

Run these commands in this package:

```bash
vp check
vp test --run
vp run build
```

The tests use a local database, a temporary directory and model doubles, so no API key is required. They cover automatic and manual compaction, cross-space authorization, storage isolation and replay, and duplicate tool names.
