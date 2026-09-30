<h1 align="center">@cieljs/trace</h1>

<p align="center">UI-independent trace layer: collect agent events, project execution records, persist them, and serve them over oRPC.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#overview">Overview</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#orpc-surface">oRPC surface</a> ·
  <a href="#api-reference">API reference</a> ·
  <a href="#design-notes">Design notes</a>
</p>

## Overview

`@cieljs/trace` is the data layer behind Ciel's console. It subscribes to the runtime event
journal, merges raw events into readable execution records, stores every payload in PGlite, and
exposes the result as oRPC queries plus two subscriptions.

The package ships four entry points:

| Entry point              | Contents                                                          |
| ------------------------ | ----------------------------------------------------------------- |
| `@cieljs/trace`          | Everything below, re-exported for convenience                     |
| `@cieljs/trace/host`     | `TraceHost`, `createTraceRouter`, `traceStorage` and router types |
| `@cieljs/trace/client`   | `createTraceClient` and the `TraceClient` type                    |
| `@cieljs/trace/protocol` | Wire types only, safe to import from either side                  |

It contains no Vue code and no Electron code. The host runtime that owns the `Storage` instance
owns the `TraceHost`; whoever owns the transport owns the link. See
[`@cieljs/console`](../console/README.md) for the UI that consumes this protocol and
[`@cieljs/investigation`](../investigation/README.md) for a second consumer.

## Concepts

| Noun              | Meaning                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TraceEvent`      | Alias of `RuntimeRecord`: one persisted runtime fact with `id`, `sequence`, `sessionId`, `runId`, `turnId`, `messageId`, `toolCallId`, `timestamp`, `event` and `metadata` |
| entry             | A `TraceEntry` owned by the host or the `AgentTrace` merger: agent/turn lifecycle, messages, tool executions, host-recorded facts                                          |
| step              | A `TraceEntry` projected one-to-one from a runtime event, with id `step:<sequence>` and `revision` set to that sequence                                                    |
| record            | One row of `trace.records`: an id, a `category`, a `sequence`, an optional `run_id`/`session_id`, and a V8-serialized value                                                |
| projection state  | JSON snapshot of the replay cursor and derived counters, stored under the id `trace:projection-state`                                                                      |
| `TraceSession`    | One session's time bounds plus `usage`, `turn` and `steps`                                                                                                                 |
| `TraceUsageState` | `{ total, context }` — cumulative usage and the size of the most recent context                                                                                            |
| `TraceUpdate`     | One push: changed entries, changed steps, a usage snapshot and the visible sessions                                                                                        |
| `ValueRef`        | `{ id, path?, preview }` — a lazy pointer to a stored payload, resolved through `values.get`                                                                               |

Record categories written by the host:

| Category            | Id pattern                                               | Written by                                                                     |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `entry`             | `<event id>:<ordinal>` inside an event, else a UUID      | `AgentTrace` merger and `record` / `recordMessage`                             |
| `step`              | `step:<sequence>`                                        | The step projection in `saveEvent`                                             |
| `run`               | `run:<entry id>`                                         | A duplicated `agent_start` entry, for run-scoped queries                       |
| `value`             | `<entry id>:input`, `<entry id>:output`, or the event id | Payload snapshots and external-journal events                                  |
| `message_reference` | `<messageId>:output`                                     | A pointer to `storage.events.record.event.message` instead of a copied payload |
| `projection_state`  | `trace:projection-state`                                 | JSON projection state                                                          |

## Install

Inside this monorepo the package is consumed through the workspace protocol:

```json
{
  "dependencies": {
    "@cieljs/trace": "workspace:*"
  }
}
```

The published package name is `@cieljs/trace`, and it has no peer dependencies.

## Quick start

Open a host on top of an existing `Storage`, then expose its router:

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

Feed the host from an Agent, or record host-level facts directly:

```ts
const unsubscribe = host.observe(agent, sessionId);

host.record('runtime_ready', { at: Date.now() }, sessionId);
host.recordMessage('关键词唤醒', '今天有什么有趣的直播？', sessionId);
```

The client side is created from a link the application already owns:

```ts
import { createTraceClient } from '@cieljs/trace/client';
import { RPCLink } from '@orpc/client/message-port';

const channel = new MessageChannel();
window.postMessage('app:connect', '*', [channel.port2]);
channel.port1.start();

const client = createTraceClient(new RPCLink({ port: channel.port1 }));

const controller = new AbortController();
for await (const update of await client.updates(undefined, { signal: controller.signal })) {
  // update.entries, update.steps, update.usage, update.sessions
}
```

Reading one page of history and one payload on demand:

```ts
const page = await client.steps.list({ limit: 100, sessionId }, { signal: controller.signal });
const older = await client.steps.list(
  { cursor: page[0]?.sequence, limit: 100, sessionId },
  { signal: controller.signal },
);
if (page[0]?.raw) console.log(await client.values.get(page[0].raw));
```

## Host and persistence

`TraceHost.open` accepts the storage plus optional overrides:

| Option        | Type            | Default           | Purpose                                                       |
| ------------- | --------------- | ----------------- | ------------------------------------------------------------- |
| `storage`     | `Storage`       | required          | Where records and projection state live                       |
| `source`      | `RuntimeReader` | `storage.journal` | Where events are read from                                    |
| `writer`      | `RuntimeWriter` | `storage.journal` | Where recorded events are appended                            |
| `capacity`    | `number`        | `300`             | In-memory summary cache size; must be a positive safe integer |
| `awaitReplay` | `boolean`       | `true`            | Whether historical replay finishes inside `open()`            |

When `source` and `writer` are both the storage journal, the host can persist projection state and
resume from a cursor; when they are not, it treats the journal as external and keeps full event
snapshots instead.

Host members:

| Member                                     | Description                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `storage`                                  | The `Storage` instance the host was opened with                                |
| `store`                                    | The underlying record store used by the router                                 |
| `signal`                                   | Lifetime `AbortSignal`, aborted by `close()`                                   |
| `usage()`                                  | Current `TraceUsageState` snapshot                                             |
| `sessions()`                               | Visible `TraceSession[]` with `turn` and `steps` progress                      |
| `subscribe(listener)`                      | Register a `TraceUpdate` listener; returns an unsubscribe function             |
| `record(name, output, sessionId?)`         | Append a completed host fact; `sessionId` defaults to `'blive-agent'`          |
| `recordMessage(label, content, sessionId)` | Append a completed `message`/`perception` entry                                |
| `observe(agent, sessionId)`                | Subscribe to a Pi `Agent` and record its events with live tools/model metadata |
| `agentListener(sessionId, metadata?)`      | Build the recorder without subscribing; the host assigns sequences             |
| `events(afterSequence?, signal?)`          | Async generator of persisted `TraceEvent`s                                     |
| `flushRecords()`                           | Flush the writer, the projection and the store                                 |
| `assertHealthy()`                          | Throw when the projection failed earlier                                       |
| `close()` / `[Symbol.asyncDispose]()`      | Unsubscribe, flush, abort the lifetime and drop caches                         |

### Turn numbering

A turn is one Agent run: `resolveTurnNumber` allocates a number per `runId` inside a session, and
every later event of the same run reuses it. Sessions expose the latest `turn` and a de-duplicated
`steps` count derived from the same keys the UI groups by (tool call, message, agent, turn).

### Rebuild and swap

When projection state is missing, unreadable, or behind the journal's `MAX(sequence)`, the host
creates `trace.records_rebuild`, replays from cursor zero into it, then atomically swaps the tables
and their indexes. Existing rows are never deleted: in-memory eviction only drops the push cache.

## oRPC surface

`createTraceRouter(host, options?)` returns a plain nested object of oRPC procedures. The optional
`session` predicate — `(sessionId: string) => boolean` — filters list results and both
subscriptions, so one host can serve several isolated views.

| Procedure          | Input                                     | Result                                                                          |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `runs.list`        | `{ cursor?, limit?, sessionId? }`         | `TraceEntry[]` from category `run`                                              |
| `steps.list`       | `{ cursor?, limit?, sessionId? }`         | `TraceEntry[]` from category `step`                                             |
| `entries.list`     | `{ cursor?, limit?, runId?, sessionId? }` | `TraceEntry[]` from category `entry`                                            |
| `entries.get`      | `{ id }`                                  | One `TraceEntry`; `NOT_FOUND` when absent                                       |
| `messages.get`     | `{ messageId }`                           | The stored `<messageId>:output` payload                                         |
| `values.get`       | `{ id, path? }`                           | The stored value at `path`; `NOT_FOUND` for missing keys or non-data properties |
| `events.subscribe` | `{ afterSequence? }`                      | `AsyncGenerator<TraceEvent>`                                                    |
| `updates`          | none                                      | `AsyncGenerator<TraceUpdate>`                                                   |

Input validation is expressed with zod in the route modules:

- Page input: `cursor` is a non-negative integer, `limit` is an integer from 1 to 300 defaulting to
  100, and `sessionId` is a 1–300 character string.
- Id input: `id` is a 1–200 character string.
- Value path input: `path` is an array of at most 32 keys of at most 1024 characters, and the keys
  `__proto__`, `constructor` and `prototype` are rejected.

`updates` first subscribes, then reads a snapshot of up to 300 `entry` rows, up to 300 `step` rows,
the usage snapshot and the visible sessions. Later pushes carry only changed entries and steps, and
are also emitted when only usage changed — for example after a background replay catches up.

## Client and connection ownership

`createTraceClient` is a two-line wrapper over `createORPCClient`, and it deliberately knows nothing
about the transport:

```ts
function createTraceClient(link: ClientLink<Record<never, never>>): TraceClient;
```

It is a thin wrapper over `createORPCClient`: given any oRPC link it returns the typed
`RouterClient` for this router, and nothing else.

The application owns the link: it chooses the oRPC adapter, creates the port or socket, and closes
it on teardown. `@orpc/client/message-port` is one such adapter, used by the bundled Electron app,
but nothing in this package depends on it. `TraceClient` is `RouterClient<TraceRouter>`, so the
procedure tree above is mirrored as typed methods, and each subscription accepts
`{ signal?: AbortSignal }` in its second argument.

> [!TIP]
> Cancellation is the consumer's job. Abort the request signal to end an `updates` or
> `events.subscribe` generator; the host also aborts every subscription when it closes.

## API reference

### `@cieljs/trace` — `src/index.ts`

| Export               | Kind     | Description                                                |
| -------------------- | -------- | ---------------------------------------------------------- |
| `TraceHost`          | class    | Host that projects, persists and broadcasts trace data     |
| `createTraceRouter`  | function | Build the oRPC procedure tree from a host                  |
| `traceStorage`       | constant | `StorageModule` with the `trace.records` migrations        |
| `createTraceClient`  | function | Wrap an oRPC `ClientLink` into a typed `TraceClient`       |
| `TraceRouter`        | type     | The router object returned by `createTraceRouter`          |
| `TraceRouterOptions` | type     | `{ session?: (sessionId: string) => boolean }`             |
| `TraceClient`        | type     | `RouterClient<TraceRouter>`                                |
| `TraceEntry`         | type     | One conversation entry or projected step                   |
| `TraceEvent`         | type     | Alias of `RuntimeRecord` from `@cieljs/agent-kit/protocol` |
| `TraceSession`       | type     | Session bounds, usage and progress                         |
| `TraceUpdate`        | type     | One subscription push                                      |
| `TraceUsage`         | type     | `{ input, output, cacheRead, cacheWrite, total }`          |
| `TraceUsageState`    | type     | `{ total, context }`                                       |
| `ValueRef`           | type     | `{ id, path?, preview }`                                   |

### `@cieljs/trace/host`

| Export               | Kind     | Description                                            |
| -------------------- | -------- | ------------------------------------------------------ |
| `TraceHost`          | class    | Same host, opened through `TraceHost.open`             |
| `createTraceRouter`  | function | Same router factory                                    |
| `traceStorage`       | constant | Storage module declaring the `trace` schema migrations |
| `TraceRouter`        | type     | Router instance type                                   |
| `TraceRouterOptions` | type     | Router options, including the session predicate        |

### `@cieljs/trace/client`

| Export              | Kind     | Description                                               |
| ------------------- | -------- | --------------------------------------------------------- |
| `createTraceClient` | function | `(link: ClientLink<Record<never, never>>) => TraceClient` |
| `TraceClient`       | type     | `RouterClient<TraceRouter>`                               |

### `@cieljs/trace/protocol`

| Export            | Kind | Description                                      |
| ----------------- | ---- | ------------------------------------------------ |
| `TraceEntry`      | type | Structural record for entries and steps          |
| `TraceEvent`      | type | Alias of `RuntimeRecord`                         |
| `TraceSession`    | type | `{ id, startedAt, endedAt, usage, turn, steps }` |
| `TraceUpdate`     | type | `{ entries, steps, usage, sessions }`            |
| `TraceUsage`      | type | Per-request token counts                         |
| `TraceUsageState` | type | Cumulative usage plus current context            |
| `ValueRef`        | type | Lazy payload pointer                             |

`TraceStore` lives in the host entry's implementation but is not re-exported from any entry point;
reach it through `host.store`.

## Design notes

Ownership stays with the host. It never creates the `Storage`, the Agent or the transport: applications open storage, hand it to `TraceHost.open`, and own the oRPC link and its lifecycle — which is why the client entry takes a `ClientLink` instead of connection options.

There are two sequence spaces. Entries use host-assigned entry sequences so conversation order and host observations interleave, while steps and raw events keep the runtime event sequence that pagination and `afterSequence` rely on. Replay restores existing records in their original order rather than pushing them past newer messages.

Pagination is cursor-based. `limit` and `cursor` map to `sequence < cursor` in descending order, and the page is then reversed to ascending; because the cursor is a sequence value, records written while paging never shift historical pages.

Usage is tallied host-side. `TraceUsageTally` consumes `message_end` once per assistant message, so streaming updates are never double-counted, and `session_compaction` lowers the current context to the summary estimate until the next real request replaces it. That accumulation survives a host restart because it is part of the projection state.

Projection failures are sticky: a failed batch is recorded, logged and re-thrown through `assertHealthy()`, which the `updates` route turns into `INTERNAL_SERVER_ERROR`, so the UI reports the failure instead of quietly showing stale data.

Values are normalized before serialization — functions become `'[Function]'`, accessors become `'[Getter / Setter]'`, cycles are preserved rather than throwing, and `Map`, `Set`, `Date`, `Error`, `ArrayBuffer` and typed arrays are kept as they are. Record values are stored as `v8.serialize` bytes while projection state stays JSON; that state is versioned (`version: 2`) and stamped with `process.versions.v8`, so a runtime change invalidates it and triggers a rebuild instead of trusting a mismatched payload.

`values.get` walks own property descriptors and rejects anything that is not a plain data property, so a path can never trigger a getter or reach the prototype. Updates are coalesced on a 60 ms timer while raw events are written immediately, and because the push carries entry summaries, evicted entries remain fully readable by id or cursor.

## Development

Scripts declared by this package:

| Script           | Command        | Purpose                     |
| ---------------- | -------------- | --------------------------- |
| `check`          | `vp check`     | Format, lint and type check |
| `prepublishOnly` | `vp run build` | Build before publishing     |

The Vite+ task graph in `vite.config.ts` defines `build` (`vp pack`, depending on the `build` task of
its dependencies) and `test` (`vp test`). The pack config emits four entries — `index`, `host`,
`client`, `protocol` — with declarations. Tests run with a 15 second timeout and file parallelism
disabled, so run them from the package directory:

```sh
vp install
vp run test
vp check
```

The test suites under `src/host/` cover streaming merge, on-demand content reads, pagination
rejection, usage accounting, replay and rebuild, and subscription lifetime over an oRPC
MessagePort.
