<h1 align="center">@cieljs/session</h1>

<p align="center">Agent sessions that keep the full history, compress what no longer fits, and can still find the exact words.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#context-and-compaction">Compaction</a> ·
  <a href="#retrieval">Retrieval</a> ·
  <a href="#agent-tools">Agent tools</a> ·
  <a href="#api-reference">API reference</a>
</p>

A conversation that runs for a long time accumulates things worth keeping: the original goal, the decision reached after three rounds of discussion, the things that were agreed to be done later. When you come back you want to continue the conversation, and when the context window runs out you want the important parts to survive.

`@cieljs/session` is a local store for exactly that. It keeps every message in PGlite, folds older conversation into a recursive summary, and retrieves the details again when they are needed.

A `spaceId` is a stable business space — a livestream room, for example — and one space can hold many sessions. `sources` holds searchable labels such as a streamer nickname or a room title; it takes no part in space isolation.

## Concepts

| Concept      | Storage                       | Role                                                                    |
| ------------ | ----------------------------- | ----------------------------------------------------------------------- |
| Session      | Message rows in the database  | The factual log of a conversation, restored on reopen                   |
| Space        | A `spaceId` namespace         | Isolation boundary; one space holds many sessions                       |
| Sources      | Searchable labels per session | Business identifiers used to discover sessions, not an isolation key    |
| Compaction   | `session_compaction` records  | A cumulative summary plus the boundary it covers                        |
| Search index | Derived chunks and vectors    | Full text, trigram and vector retrieval over message bodies and sources |

> [!NOTE]
> Compaction reorganizes the context handed to the model. The original messages stay in the database and remain searchable and readable.

## Install

`@cieljs/session` is part of the Ciel monorepo and is consumed through the workspace:

```bash
vp install
```

A session needs a `Storage` instance, and vector retrieval additionally needs a `VectorService` from [`@cieljs/vector`](../vector/README.md) that is backed by an `EmbeddingProvider` from [`@cieljs/model-kit`](../model-kit/README.md).

## Quick start

Open a space and a session, append a message, then read back the current context:

```ts
import { Storage } from '@cieljs/storage';
import { SessionManager, sessionStorage } from '@cieljs/session';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage],
});
const manager = await SessionManager.open({ storage, namespace: 'session' });
const space = manager.space('blive:room:21452505');

try {
  // An existing id is reused, so reopening continues the same conversation.
  const session = await space.session({
    id: 'conversation-1',
    sources: ['project:ciel', 'user:alice'],
  });

  await session.appendMessage({
    role: 'user',
    content: '我们决定用本地数据库保存会话。',
    timestamp: Date.now(),
  });

  const messages = await session.context();
  console.log(messages);
} finally {
  await manager.close();
}
```

`context()` returns an `AgentMessage[]` that can be handed to an agent directly. When a cumulative summary exists it is returned as the first history message, followed by the raw messages it does not yet cover. Reusing the same data directory, space id and session id resumes the same history.

Await `appendMessage()` before treating a message as written, and close storage only after you stopped submitting new work — `close()` waits for queued compaction and indexing tasks.

## Context and compaction

Context usage follows the same approach as Pi: read the most recent valid model usage first, then estimate the messages added after it. Compaction is attempted when

```text
contextTokens > contextWindow - reserveTokens
```

Equality does not trigger compaction.

| Option               | Meaning                                                           | Default  |
| -------------------- | ----------------------------------------------------------------- | -------- |
| `contextWindow`      | Context window of the **conversation** model, in tokens           | required |
| `reserveTokens`      | Tokens reserved for the next generation; must be below the window | 16,384   |
| `keepRecentMessages` | Minimum number of recent raw messages to keep                     | 10       |
| `force`              | Skip the threshold check but still respect round boundaries       | `false`  |
| `signal`             | Cancellation or timeout signal                                    | —        |

Usage is measured as follows:

1. Walk backwards to the most recent valid assistant usage, skipping errors, cancellations and all-zero usage.
2. Prefer `usage.totalTokens`; when it is zero, use `input + output + cacheRead + cacheWrite`.
3. Estimate only what was added after that message and add it to the usage. History already covered by the usage and by the summary is not counted twice.
4. Without a valid usage, estimate the latest summary plus every uncompressed message: characters divided by four, rounded up, per message; thinking blocks, tool names and JSON arguments count too; every image counts as 1,200 tokens.

Like Pi this is "real usage plus a tail estimate", not an exact tokenizer. Character-based estimation tends to undercount Chinese text, and without a usage it cannot see the system prompt and tool definitions that the storage layer never receives — leave a healthy margin.

After a compaction, usage values still attached to retained messages may describe the pre-compaction context. The session excludes usages older than the compaction write and estimates instead, until a fresh valid assistant usage appears.

### Recursive summaries

```text
older messages A          → summary S1
S1 + newly old messages B → summary S2
S2 + newly old messages C → summary S3

current context           = S3 + the most recent raw messages
```

Every compaction reads only the messages not yet covered by a summary and passes the previous summary to the model, so summaries accumulate instead of restarting. Summaries are kept in the database for inspection, while `session.context()` always contains only the history belonging to the latest summary.

The summary function is implemented by the caller. Endpoint, credentials, model, message serialization and output limits all stay outside this package: sessions never call a model and never inject prompts on their own. `DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT` is exported as an optional default.

```ts
import { DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT, type SessionSummarizer } from '@cieljs/session';

const summarize: SessionSummarizer = async ({ summary, messages, signal }) => {
  const response = await models.completeSimple(
    summaryModel,
    {
      systemPrompt: DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ summary, messages }),
          timestamp: Date.now(),
        },
      ],
    },
    { maxTokens: 2048, signal },
  );

  // Never replace history with a failed or truncated summary.
  if (response.stopReason !== 'stop') {
    throw new Error(response.errorMessage ?? `摘要未完整生成：${response.stopReason}`);
  }

  return response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
};
```

Call `session.compact()` after a complete message has been written — either before starting the next user request, or after a batch of tool results has been written and before the next model request. The manager does not subscribe to agent events; the host decides when to check and how to feed the updated context to the model.

```ts
const result = await session.compact({
  summarize,
  contextWindow: 128_000,
  reserveTokens: 16_384,
  keepRecentMessages: 10,
  signal: AbortSignal.timeout(60_000),
});

if (result) {
  console.log(await session.context());
}
```

`compact()` returns `null` when the budget is not exceeded or when there is no old round that can be compacted safely. The retention boundary is aligned backwards to a user message so that a tool call and its results never get split, which means more messages than configured may be kept. A single oversized round is never truncated, and compaction does not guarantee the result falls below the budget.

When compaction never triggers, check `contextWindow`, `reserveTokens` and whether a valid usage exists at all — everything may simply still be inside the retention range, or inside a single round. If the context is still near the limit afterwards, look at the summary length and the size of the retained messages, then lower the summary output limit or `keepRecentMessages`, and re-evaluate the budget the host actually requests. A summary model that reports an over-long context is a separate limit: it has to hold the previous summary plus the messages being compacted, and the conversation budget guarantees nothing about that. After a failure, an empty summary or a cancellation, the compaction boundary does not advance; the caller gets the error and may retry, with the original history untouched. Concurrent calls in one session are serialized per manager, and the summary boundary is re-checked before writing, so a summary that someone else updated in the meantime is never overwritten.

Every successful compaction appends a `session_compaction` event to `storage.events`, recording the cumulative summary and the boundary. Consumers such as [`@cieljs/trace`](../trace/README.md) can replay the log to observe the step.

## Retrieval

`session.search(query, options)` searches one session; `manager.searchAll(query, options)` searches every session in the manager. Both merge full-text and trigram matches with vector matches.

| Mode        | Behaviour                                              |
| ----------- | ------------------------------------------------------ |
| `hybrid`    | Default; merges every available retrieval mode         |
| `full_text` | Tokenized full-text search over message bodies         |
| `trigram`   | Fuzzy substring matching, tolerant of partial wording  |
| `vector`    | Semantic search; requires a configured `VectorService` |

| Option                | Meaning                                         | Default |
| --------------------- | ----------------------------------------------- | ------- |
| `limit` / `offset`    | Page through hits                               | —       |
| `candidateLimit`      | Candidates pulled from each mode before merging | —       |
| `minVectorSimilarity` | Minimum cosine similarity for vector hits       | 0.35    |
| `signal`              | Cancellation signal                             | —       |

A hit reports the `spaceId`, the matched `SessionMessage`, an `excerpt`, a `score` and the `matches` that produced it, so a host can show why something was returned.

Source discovery uses the same tokenizer as source full-text search and supports multi-keyword Chinese queries. `manager.findSessionsBySource(query, options)` resolves a business identifier to sessions, with `mode` of `auto`, `exact` or `text`. Changing the tokenizer means indexes have to be rebuilt — `rebuildIndexes()` rebuilds both the body and the source indexes.

```ts
const hits = await manager.searchAll('会话保存在哪里', { mode: 'hybrid' });
const related = await manager.findSessionsBySource('主播昵称');
```

> [!TIP]
> Start with full text and trigram search. Add an `EmbeddingProvider` that implements `embedBatch()` only when semantic retrieval is actually needed.

### Embedding and indexes

An embedding provider is described by a model id, an output dimension count and a batch function. The model id must distinguish provider and version: vectors from different models must never be compared even when the dimensions match.

| Option       | Meaning                                      | Default  |
| ------------ | -------------------------------------------- | -------- |
| `model`      | Unique identity of the vector space          | required |
| `dimensions` | Output dimension count, `1` to `16,000`      | required |
| `batchSize`  | Maximum texts per indexing request           | 32       |
| `embed`      | Optional single-text entry point             | —        |
| `embedBatch` | Vectors in the same order as the input texts | required |

```ts
import { Storage } from '@cieljs/storage';
import { VectorService, vectorStorage } from '@cieljs/vector';
import { SessionManager, sessionStorage } from '@cieljs/session';

await using storage = await Storage.open({
  dataDir: '.ciel/storage',
  modules: [sessionStorage, vectorStorage],
});
await using vectors = new VectorService({
  storage,
  provider: embedding,
  providerId: 'provider',
  revision: '1',
  granularity: 'chunk',
  inputConfig: 'raw',
});
const manager = await SessionManager.open({
  storage,
  namespace: 'session',
  vectors,
  onIndexError: error => console.error('向量索引失败', error),
});

await manager
  .space('blive:room:21452505')
  .session()
  .then(session =>
    session.appendMessage({
      role: 'user',
      content: '本次决定采用本地数据库保存会话。',
      timestamp: Date.now(),
    }),
  );

// Indexing is queued after the write; flush before searching what you just wrote.
await manager.flushIndexes();
const hits = await session.search('会话保存在哪里', { mode: 'vector' });
```

`options.purpose` is `document` for indexing and `query` for lookups; adapters that need different task types or prefixes map that themselves. Queries carry a `signal` that should be forwarded to the SDK or `fetch`. Returned vectors must match the configured dimensions, contain finite numbers, and must not be zero vectors.

Indexing is derived data and never blocks a write. A query that misses may mean indexing has not finished, that the model id and dimensions do not match, or that `minVectorSimilarity` is too high. If the vector service is down, messages are still stored: hybrid `search()` reports the vector error and continues with full text and trigram, while an explicit `{ mode: 'vector' }` hands the error to the caller. After changing the model or the tokenizer, reopen storage with the new configuration and call `session.rebuildIndexes()`, or `manager.rebuildIndexes()` for every session; failed jobs can be retried with `manager.retryIndexes()`, and `manager.getIndexStatus()` reports the `pending`, `ready` and `failed` counts. Keep in mind that retrieval has no approximate index — it filters by model and dimensions and computes exact cosine similarity — so evaluate performance against your own data volume.

Without `onIndexError` a warning is logged; a failed index job never rolls back a message.

## Agent tools

Agent tools live behind a separate entry point. `sessionTools({ session, space })` returns tools for both the current session and the history of the current space:

- `search_current_session_messages` — find relevant history in the current session.
- `read_current_session_messages` — read the context around one message of the current session.
- `find_sessions_by_source` — discover sessions in the current space by business id, name, nickname, title or alias.
- `search_discovered_session_messages` — search sessions that were already discovered.
- `read_discovered_session_messages` — read the context around a message of a discovered session.

Cross-space access is closed by default. The current session body is searchable directly, other sessions in the same space must be discovered by source first, and no tool searches the body of every session in a space without discovery.

| Configuration       | Source discovery scope      | Body search and read scope                                      |
| ------------------- | --------------------------- | --------------------------------------------------------------- |
| no `crossSpace`     | the current space           | the current session, plus discovered sessions in the same space |
| `access: "related"` | every space of that manager | the current session, plus sessions discovered by source         |
| `access: "all"`     | every space of that manager | also every session of that manager directly, without discovery  |

```ts
import { sessionTools } from '@cieljs/session/agent';

// Default: only find history inside the current space.
const localTools = sessionTools({ session, space });

// Cross-space: discover sessions by source first, then search and read them.
const relatedTools = sessionTools({
  session,
  space,
  crossSpace: { manager, access: 'related' },
});

// Cross-space: also allow searching every session body directly.
const allTools = sessionTools({
  session,
  space,
  crossSpace: { manager, access: 'all' },
});
```

| Tool name                            | Available with            | Behaviour                                                   |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------- |
| `search_current_session_messages`    | default, `related`, `all` | Always searches only the current session body               |
| `read_current_session_messages`      | default, `related`, `all` | Always reads context around messages of the current session |
| `find_sessions_by_source`            | default, `related`, `all` | Matches `sources` only; never searches bodies               |
| `search_discovered_session_messages` | default, `related`, `all` | Searches the body of a discovered session by `sessionId`    |
| `read_discovered_session_messages`   | default, `related`, `all` | Reads context by `sessionId` and `messageId`                |
| `search_all_session_messages`        | `all` only                | Searches message bodies across every space, not `sources`   |
| `read_any_session_messages`          | `all` only                | Reads by `sessionId` and `messageId` without discovery      |

`related` follows `find_sessions_by_source` → `search_discovered_session_messages` → `read_discovered_session_messages`. Discovery results carry `session.id`, `session.spaceId` and `matchedSources`; feed `session.id` back as `sessionId` and the `message.id` of a body hit as `messageId`. Discovery records live as long as the tool instance — recreating the tools means discovering again.

`all` can call `search_all_session_messages` directly and pass the returned `message.sessionId` and `message.id` to `read_any_session_messages`. Reading tools return the target message plus the neighbouring messages requested through `before` and `after`; they never return a whole conversation.

Every tool is read-only. `all` covers only the session database behind the manager that was passed in, never another independent database. There is no `list_sessions` tool; a host that needs an administration list calls `space.list()` or `manager.list()`.

A standalone question-answering agent can keep its own sessions in a separate data directory and use a normal space's manager purely as a cross-session query source, so its history never mixes with product data.

## API reference

`@cieljs/session`

| Export                                                                                    | Kind     | Description                                                                                                                    |
| ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SessionManager`                                                                          | class    | Opens sessions in one storage namespace; entry point for the package                                                           |
| `SessionManager.open(options)`                                                            | method   | `{ storage, namespace, vectors?, tokenize?, onIndexError? }`                                                                   |
| `sessionStorage`                                                                          | const    | Storage module registering the session schema and migrations                                                                   |
| `DEFAULT_SESSION_SUMMARY_SYSTEM_PROMPT`                                                   | const    | Optional default system prompt for summary models                                                                              |
| `tokenizeSearchText`                                                                      | function | The tokenizer used by full-text and source search                                                                              |
| `estimateContextTokens`                                                                   | function | Context usage estimate for a set of messages                                                                                   |
| `estimateAgentMessageTokens`                                                              | function | Per-message token estimate                                                                                                     |
| `SessionError` and subclasses                                                             | class    | `SessionNotFoundError`, `SessionAccessError`, `SessionCompactionConflictError`, `SessionClosedError`, `SessionValidationError` |
| `Session`, `SessionSpace`, `SessionInfo`                                                  | type     | Session handles and their metadata                                                                                             |
| `SessionMessage`, `SessionCompaction`                                                     | type     | Stored message and summary records                                                                                             |
| `SessionOptions`, `SessionListOptions`, `SessionMessageListOptions`, `UpdateSessionInput` | type     | Session-level inputs                                                                                                           |
| `CompactionOptions`, `SessionSummarizer`, `SummarizeInput`, `AppendCompactionInput`       | type     | Compaction inputs and the summarizer contract                                                                                  |
| `SessionSearchOptions`, `SessionSearchMode`, `SessionSearchMatch`, `SessionSearchHit`     | type     | Search inputs and results                                                                                                      |
| `FindSessionsBySourceOptions`, `SessionSourceHit`, `SessionSourceSearchMode`              | type     | Source discovery inputs and results                                                                                            |
| `SessionIndexStatus`, `SessionContext`, `SessionManagerOptions`, `SessionSource`          | type     | Index status, context and manager options                                                                                      |

`SessionManager`

| Member                                                   | Description                                                |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `space(spaceId)`                                         | Returns a `SessionSpace` handle                            |
| `getAnySession(id)`                                      | Looks a session up across spaces                           |
| `list(options)`                                          | Lists session metadata                                     |
| `searchAll(query, options)`                              | Merges retrieval across every session in the manager       |
| `findSessionsBySource(query, options)`                   | Resolves business identifiers to sessions                  |
| `getIndexStatus()`                                       | `{ pending, ready, failed }`                               |
| `flushIndexes()` / `retryIndexes()` / `rebuildIndexes()` | Drain, retry or rebuild derived indexes                    |
| `close()`                                                | Waits for queued work; never closes the underlying storage |

`Session`

| Member                                                                                      | Description                                                            |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `appendMessage(message)` / `getMessages(options)`                                           | Append an `AgentMessage` and page through stored messages              |
| `getMessagesAfter(afterSeq)` / `getMessagesRange(fromSeq, toSeq)` / `getMessage(messageId)` | Read specific parts of the log                                         |
| `context()`                                                                                 | Latest summary plus the raw messages it does not cover                 |
| `compact(options)`                                                                          | Run one compaction round; `null` when nothing was compacted            |
| `search(query, options)`                                                                    | Retrieval inside this session only                                     |
| `record(event, metadata?)` / `appendCompaction(input)`                                      | Append a runtime event, or a summary with an optimistic boundary check |
| `getLatestCompaction()` / `getLastMessage()` / `getActiveMessageRows()`                     | Inspect the current summary, tail and active rows                      |
| `getInfo()` / `update(input)` / `delete()`                                                  | Session metadata and lifetime                                          |
| `rebuildIndexes()`                                                                          | Rebuild the text and vector projections of this session                |

`@cieljs/session/agent`

| Export                                     | Kind     | Description                                     |
| ------------------------------------------ | -------- | ----------------------------------------------- |
| `sessionTools(options)`                    | function | Builds the read-only session tools for an agent |
| `CrossSpaceAccess`, `CrossSpaceOptions`    | type     | `"related"` / `"all"` cross-space authorization |
| `SessionToolsOptions`, `SessionToolLimits` | type     | Tool options and result limits                  |

## Behavior notes

- **Writes and errors.** Messages are facts; indexes are derived. A failed index job is reported through `onIndexError` and never cancels a write.
- **Concurrency.** Compaction calls are serialized per manager, and `appendCompaction()` refuses to overwrite a summary that moved while it was being generated.
- **Ownership.** A manager borrows storage and the vector service. Closing it releases neither, and closing storage while a manager is still open is a misuse.
- **Isolation.** A space never merges with another space implicitly; cross-space reads happen only through explicitly authorized tools or through a manager the host handed over.

## Development

```bash
vp check
vp test --run
vp run build
```

Tests use a local database and model doubles, so no API key is required. Session recovery, recursive compaction, token accounting and history retrieval can all be verified before connecting a real model service.
