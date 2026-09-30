<h1 align="center">@cieljs/agent-kit</h1>

<p align="center">Prompt template helpers, TypeBox-typed tool definitions, and the runtime event protocol.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#concepts">Concepts</a> ·
  <a href="#prompt-templates">Prompt templates</a> ·
  <a href="#defining-tools">Defining tools</a> ·
  <a href="#runtime-protocol">Runtime protocol</a> ·
  <a href="#api-reference">API reference</a>
</p>

`@cieljs/agent-kit` is the small shared layer under every Ciel agent: it builds prompt strings without fighting template indentation, binds a TypeBox parameter schema to a tool factory, and hands tool authors one normalized execute context instead of the raw Pi Agent callback order.

A second entry point, `@cieljs/agent-kit/protocol`, carries the vocabulary that the runtime, storage and trace layers exchange: agent events, the runtime record envelope, and the reader/writer ports.

> [!NOTE]
> Embedding contracts and vector validation have moved to [`@cieljs/model-kit`](../model-kit/README.md). Callers that still import `EmbeddingProvider`, `resolveEmbeddingProvider` or `assertEmbeddingVectors` from this package should update their imports and workspace dependencies.

## Concepts

| Concept          | Export                       | Role                                                        |
| ---------------- | ---------------------------- | ----------------------------------------------------------- |
| Prompt template  | `prompt`                     | Tagged template that keeps escapes and fixes indentation    |
| Tool definition  | `defineTool()`               | Binds a TypeBox schema to a tool factory                    |
| Execute context  | `ToolExecuteContext`         | The normalized `toolCallId` / `signal` / `onUpdate` handoff |
| Runtime protocol | `@cieljs/agent-kit/protocol` | Event and record types shared by runtime, storage and trace |

## Install

`@cieljs/agent-kit` is part of the Ciel monorepo and is consumed through the workspace:

```bash
pnpm add @cieljs/agent-kit
```

Tool schemas are written with TypeBox, so `typebox` is a direct dependency of this package. Tools produced by `defineTool()` are plain Pi Agent tools and are consumed by [`@cieljs/runtime`](../runtime/README.md), [`@cieljs/session`](../session/README.md) and [`@cieljs/memory`](../memory/README.md).

## Quick start

```ts
import { defineTool, prompt } from '@cieljs/agent-kit';
import { Type } from 'typebox';

const systemPrompt = prompt.dedent`
  You are Ciel, a patient assistant.
  Answer briefly and accurately.
`;

const searchMemory = defineTool(
  Type.Object({ query: Type.String({ minLength: 1 }) }),
  (search: (query: string) => Promise<string>) => ({
    name: 'search_memory',
    label: 'Search memory',
    description: prompt.inline`
      Search long-term memory
      for facts that answer the query.
    `,
    async execute({ query }, { toolCallId, signal, onUpdate }) {
      signal?.throwIfAborted();

      onUpdate?.({
        content: [{ type: 'text', text: `searching for "${query}" (${toolCallId})` }],
        details: { query },
      });

      return {
        content: [{ type: 'text', text: await search(query) }],
        details: { query },
      };
    },
  }),
);

// A factory call produces a plain AgentTool.
const tools = [searchMemory(async query => `no hits for ${query}`)];
```

## Prompt templates

`prompt` is a callable tagged template built on `String.raw`, so escape sequences inside the template stay literal. It exposes three additional tags for the three ways prompts are usually cleaned up:

| Tag             | Behaviour                                                                      |
| --------------- | ------------------------------------------------------------------------------ |
| `prompt`        | Returns the raw template string; escapes are preserved                         |
| `prompt.trim`   | Raw string with leading and trailing whitespace removed                        |
| `prompt.dedent` | Trimmed, then the common minimum indentation of all non-empty lines is removed |
| `prompt.inline` | Trimmed, then every run of whitespace is collapsed into a single space         |

```ts
import { prompt } from '@cieljs/agent-kit';

const systemPrompt = prompt.dedent`
  You are a patient assistant.
  Answer briefly and accurately.
`;

const description = prompt.inline`
  Search the history of the current session
  for messages related to the query.
`;

// Windows paths and regular expressions survive because escapes are literal.
const paths = prompt`C:\ciel\storage`;
```

`dedent` measures indentation in characters: it collects the leading `[ \t]*` run of every non-empty line, takes the smallest length, and slices that many characters off each line. Lines that contain only whitespace do not participate in the measurement.

## Defining tools

`defineTool()` takes the parameter schema and a factory, and returns a factory of the same shape that produces a finished `AgentTool`.

```ts
import { defineTool } from '@cieljs/agent-kit';
import { Type } from 'typebox';

const createSearchTool = defineTool(
  Type.Object({ query: Type.String() }),
  (search: (query: string) => Promise<string>) => ({
    name: 'search',
    label: 'Search',
    description: 'Search related content',
    async execute({ query }, { signal }) {
      signal?.throwIfAborted();

      return {
        content: [{ type: 'text', text: await search(query) }],
        details: { query },
      };
    },
  }),
);
```

The signature is:

```ts
function defineTool<
  TDetails = unknown,
  TArgs extends unknown[] = unknown[],
  TParameters extends TSchema = TSchema,
>(
  parameters: TParameters,
  factory: (...args: TArgs) => ToolDefinition<TParameters, TDetails>,
): (...args: TArgs) => AgentTool<TParameters, TDetails>;
```

- `TParameters` is inferred from the schema argument, so `execute` receives `Static<TParameters>` — the schema is never repeated inside the factory.
- `TDetails` types the structured `details` field of the tool result, and `onUpdate` is an `AgentToolUpdateCallback<TDetails>`.
- `TArgs` is inferred from the factory parameters, so a tool that needs host dependencies gets them by calling the returned factory: `createSearchTool(search)`.

`ToolDefinition` is the factory contract: everything from `AgentTool` except `parameters` and `execute`, plus an `execute` that already received the flattened context.

## Tool execute context

Pi Agent calls `execute(toolCallId, params, signal, onUpdate)`. `defineTool()` normalizes that into one object:

```ts
interface ToolExecuteContext<TDetails = unknown> {
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<TDetails>;
}
```

| Field        | Purpose                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| `toolCallId` | Identifier of the current tool call, for logging, tracing and correlating streamed updates |
| `signal`     | Abort signal of the current run; call `signal?.throwIfAborted()` around async work         |
| `onUpdate`   | Streams partial results for this call; calls made after the promise settles are ignored    |

Throw to report a failure — the agent runtime turns a thrown error into error output for the model, so errors should not be encoded into `content` by hand.

## Runtime protocol

`@cieljs/agent-kit/protocol` re-exports the Pi Agent `AgentEvent` and `AgentMessage` types and adds the host's own record envelope.

```ts
import type {
  RuntimeEvent,
  RuntimeReader,
  RuntimeRecord,
  RuntimeWriter,
  SessionCompactionEvent,
} from '@cieljs/agent-kit/protocol';
```

| Type                     | Shape                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RuntimeMetadata`        | `{ tools?, model?, parentRunId? }` — the tools and model in effect for the record                                                              |
| `SessionCompactionEvent` | `{ type: 'session_compaction', summary, throughSeq, createdAt, contextTokens? }`                                                               |
| `RuntimeEvent`           | `AgentEvent \| SessionCompactionEvent`                                                                                                         |
| `RuntimeRecord`          | `version: 1`, `id`, `sequence`, `sessionId`, `runId`, `turnId?`, `messageId?`, `toolCallId?`, `parentRunId?`, `timestamp`, `event`, `metadata` |
| `RuntimeReader`          | `read(after?, limit?)` and `subscribe(listener)`                                                                                               |
| `RuntimeWriter`          | `record(sessionId, event, metadata?)` and `flush()`                                                                                            |

`.contextTokens` is the post-compaction context estimate (summary plus retained raw messages) so consumers such as [`@cieljs/trace`](../trace/README.md) can update "current context" immediately; older records may not have the field. It excludes the system prompt and tool definitions.

> [!NOTE]
> `RuntimeReader.subscribe()` is only a wake-up signal. Consumers should read by a persisted cursor instead of treating the notification as the event payload, so a disconnect cannot lose events.

## API reference

`@cieljs/agent-kit`

| Export                            | Kind      | Description                                                              |
| --------------------------------- | --------- | ------------------------------------------------------------------------ |
| `prompt`                          | const     | Tagged template callable with `trim`, `dedent` and `inline` methods      |
| `prompt.trim`                     | template  | Raw string with leading and trailing whitespace removed                  |
| `prompt.dedent`                   | template  | Trimmed, with the common minimum indentation removed                     |
| `prompt.inline`                   | template  | Trimmed, with whitespace runs collapsed to single spaces                 |
| `defineTool(parameters, factory)` | function  | Binds a TypeBox schema to a tool factory, returns an `AgentTool` factory |
| `ToolExecuteContext<TDetails>`    | interface | `{ toolCallId, signal?, onUpdate? }` passed to `execute`                 |

`@cieljs/agent-kit/protocol`

| Export                       | Kind      | Description                                                       |
| ---------------------------- | --------- | ----------------------------------------------------------------- |
| `AgentEvent`, `AgentMessage` | type      | Re-exported from `@earendil-works/pi-agent-core`                  |
| `RuntimeMetadata`            | interface | Tools, model and parent run attached to a record                  |
| `SessionCompactionEvent`     | interface | Compaction event that shares the same factual log as agent events |
| `RuntimeEvent`               | type      | `AgentEvent \| SessionCompactionEvent`                            |
| `RuntimeRecord`              | interface | The persisted record written by `RuntimeWriter`                   |
| `RuntimeReader`              | interface | Read by cursor plus a wake-up subscription                        |
| `RuntimeWriter`              | interface | Append records and flush them                                     |

## Design decisions

Escapes stay literal: `prompt` is built on `String.raw` because prompts frequently contain backslashes and template-like text that has to reach the model unchanged. Cleaning up is opt-in — three small tags cover the whole job, with `dedent` for multi-line system prompts and `inline` for the single-line tool descriptions that models read as metadata.

The schema lives in one place: `defineTool()` takes `parameters` as its first argument and overwrites the definition's own `parameters`, so the factory cannot drift from the schema that validates it. Tool authors also get one context object instead of having to remember the positional order of Pi Agent's `execute` arguments, which means a tool can be written before the runtime that will host it. The `./protocol` entry point is types only, with no runtime code, so storage and trace can depend on that vocabulary without pulling in agent execution.

## Development

Run these commands in this package:

```bash
vp check
vp run build
```

This package currently ships no test files, so its `test` task is configured with `vp test --passWithNoTests`. Tools built here are exercised by the tests of [`@cieljs/runtime`](../runtime/README.md).
