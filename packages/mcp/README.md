<h1 align="center">@cieljs/mcp</h1>

<p align="center">Turn the tools of any MCP server into Ciel Agent tools, dynamically.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#overview">Overview</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#environment-variables">Env vars</a> ·
  <a href="#tool-filtering">Filtering</a> ·
  <a href="#namespaces-and-name-collisions">Namespaces</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#scope-and-non-goals">Scope</a> ·
  <a href="#api-reference">API</a>
</p>

## Overview

`@cieljs/mcp` is Ciel's source of external tools. It discovers tool definitions at start-up through MCP `tools/list` and converts each MCP tool into an ordinary `AgentTool`; when the Agent calls one, the call is forwarded to the matching MCP server through `tools/call`.

```text
MCP Server ──tools/list──▶ AgentTool[] ──Agent call──▶ tools/call ──▶ MCP Server
```

> [!NOTE]
> MCP is owned by the host. Several runtimes may reuse one instance; a runtime never creates or closes the MCP service.

## Concepts

| Concept          | Role                                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| MCP Server       | An external process started over stdio that exposes a set of tools      |
| `.ciel/mcp.json` | Declares which MCP servers to connect to and how each one is configured |
| `AgentTool[]`    | pi-agent-core's uniform tool shape, handed to the Agent as-is           |

## Install

```bash
pnpm add @cieljs/mcp
```

The package is ESM-only and exposes two entry points: `"."` → `dist/index.mjs` and `"./package.json"`. It depends on `@modelcontextprotocol/client` for the protocol and on `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` for the Agent tool and content types. Inside this monorepo, dependants declare it with the `workspace:` protocol.

## Quick start

Create `.ciel/mcp.json` in your project directory:

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "agent-search-mcp"]
    }
  }
}
```

With `@cieljs/runtime`, pass the already-connected MCP instance in:

```ts
import { defineCiel } from 'cieljs';
import { createMcp } from '@cieljs/mcp';

await using mcp = await createMcp({
  cwd: process.cwd(),
  configFile: '.ciel/mcp.json',
});

const ciel = defineCiel({
  // ...
  mcp,
});

await ciel.start();
await ciel.close();
```

When you use the Agent directly, you can open MCP yourself and hand `mcp.tools` to the Agent together with your local tools:

```ts
import { createMcp } from '@cieljs/mcp';

const mcp = await createMcp({
  cwd: process.cwd(),
  configFile: '.ciel/mcp.json',
});

const tools = [...mcp.tools];

await mcp.close();
```

The tools a server exposes are discovered automatically at start-up — there is no need to declare `webSearch()`, `webFetch()` or similar functions up front.

### Connecting to several servers

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "agent-search-mcp"]
    },
    "bilibili": {
      "command": "npx",
      "args": ["-y", "bilibili-mcp"]
    }
  }
}
```

The tools of all servers are merged into the same `mcp.tools`:

```ts
console.log(mcp.tools.map(tool => tool.name));
// ["web_search", "web_fetch", "search_video", "get_video_info", "get_dynamic"]
```

## Configuration

The config file is a JSON object with a single `mcpServers` key. Each entry is one stdio server:

| Key            | Type                     | Default     | Description                                                                              |
| -------------- | ------------------------ | ----------- | ---------------------------------------------------------------------------------------- |
| `command`      | `string`                 | —           | Required, non-empty: the command that starts the MCP server                              |
| `args`         | `string[]`               | —           | Arguments passed to `command`                                                            |
| `env`          | `Record<string, string>` | —           | Environment variables for the server; values support `${VAR}` expansion (see below)      |
| `tools`        | `string[]`               | all tools   | Allow list: expose only these MCP tools                                                  |
| `excludeTools` | `string[]`               | —           | Deny list; it wins when both are present                                                 |
| `enabled`      | `boolean`                | `true`      | `false` skips the server entirely — it is not started and exposes nothing                |
| `prefix`       | `boolean \| string`      | `false`     | Namespace for tool names: `true` uses the server name, a string uses that string         |
| `cwd`          | `string`                 | project cwd | Working directory of the server; a relative path resolves against the project `cwd`      |
| `timeout`      | `number`                 | —           | Per-request timeout in milliseconds, applied to `connect`, `tools/list` and `tools/call` |
| `type`         | `"stdio"`                | `"stdio"`   | Only stdio is supported; any other value fails at load time                              |

### Working directory and timeouts

An MCP server inherits the Ciel project's cwd by default; use `cwd` for a relative path, and `timeout` for the per-request timeout in milliseconds:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "node",
      "args": ["./server.js"],
      "cwd": "./tools/filesystem",
      "timeout": 30000
    }
  }
}
```

### Where the config lives, and whether it is required

MCP does not decide on a config directory. The caller must pass both the project directory and the config file explicitly:

```ts
const mcp = await createMcp({
  cwd: '/path/to/project',
  configFile: './config/mcp.json',
});
```

`configFile` may be absolute; a relative path resolves against `cwd`. A missing file is not an error by default — `mcp.tools` is simply an empty array. If the current program genuinely depends on MCP, pass `required: true` and a missing config file fails immediately instead.

Malformed configuration is always an error, whether or not it is required: the file must parse as JSON, the root and `mcpServers` must be objects, and each server must be an object with a non-empty `command`. `tools`, `excludeTools` and `args` must be `string[]`, `timeout` must be a finite number, `enabled` must be a boolean, and `prefix` must be a boolean or a non-empty string.

## Environment variables

The configuration can reference environment variables, so API keys never have to be written into `.ciel/mcp.json`:

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "agent-search-mcp"],
      "env": {
        "BOCHA_API_KEY": "${BOCHA_API_KEY}"
      }
    }
  }
}
```

`${VAR}` is expanded from `process.env` while the config is loaded; the pattern is case-insensitive and matches names made of letters, digits and underscores. If a referenced variable does not exist, MCP initialization fails right away rather than starting a server with a missing key.

## Tool filtering

All of a server's tools are exposed by default; `tools` narrows that to a subset:

```json
{
  "mcpServers": {
    "search": {
      "command": "npx",
      "args": ["-y", "agent-search-mcp"],
      "tools": ["web_search", "web_fetch"]
    }
  }
}
```

You can also use `excludeTools` to exclude specific tools; when both are present, `excludeTools` wins. If you temporarily do not need a server, set `enabled: false` — it is not started and exposes no tools.

Filtering happens against the MCP tool name, before any `prefix` is applied.

## Namespaces and name collisions

Different servers may provide tools with the same name. `@cieljs/mcp` never silently overrides — it fails immediately. You can turn on a namespace for a server instead:

```json
{
  "mcpServers": {
    "web": {
      "command": "web-mcp",
      "prefix": true
    },
    "bilibili": {
      "command": "bilibili-mcp",
      "prefix": "bili"
    }
  }
}
```

That yields `web__search` and `bili__search`. `prefix: true` uses the server name as the namespace; you can also pass a custom string. The joined name is `<namespace>__<toolName>`.

> [!WARNING]
> Duplicate tool names after namespacing abort the whole `createMcp()` call with a `MCP tool name 冲突: "<name>"` error, so a mistyped `prefix` is caught at start-up instead of silently shadowing another server's tool.

## How it works

The MCP server owns the tool description. After connecting, `@cieljs/mcp` calls `tools/list` once per server and turns every tool into an `AgentTool`:

| `AgentTool` field | Source                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | The MCP tool name, optionally namespaced with `prefix`                                                                           |
| `label`           | `tool.title`, then `annotations.title`, then the MCP tool name                                                                   |
| `description`     | `tool.description`, or `MCP tool "<tool>" from "<server>"` when absent                                                           |
| `parameters`      | The MCP `inputSchema`, used directly — MCP schemas are already JSON Schema, which is what pi-agent-core / TypeBox use at runtime |
| `execute()`       | Forwards to `tools/call` on that server with `arguments`, the caller's `signal` and the configured `timeout`                     |

A call that comes back with `isError` throws, using the returned text content (falling back to `structuredContent`, then to `MCP tool execution failed`). Successful results become `AgentToolResult`s whose `details` carry `{ server, tool, structuredContent, meta }`.

MCP content is converted to Agent content:

| MCP block         | Becomes                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `text`            | Text content                                                                                                       |
| `image`           | Image content (data + mime type)                                                                                   |
| `audio`           | A text placeholder, `[MCP audio: <mimeType>]`                                                                      |
| `resource_link`   | Text describing name, URI, description and mime type                                                               |
| embedded resource | Text when it carries `text`, an image when it is an image blob, otherwise a text descriptor with URI and mime type |
| anything else     | JSON of the raw block                                                                                              |

When a result has no visible content but does have `structuredContent`, that JSON is rendered as a text block so the model still sees the payload.

### Ownership and lifecycle

`mcp` is an `AsyncDisposable`: `close()` (and `await using`) shuts every server client down, in reverse connection order, and repeated calls share one promise. The host owns the instance — several runtimes may reuse it, and a runtime must not close it. If opening fails partway through, the clients that were already connected are cleaned up instead of leaking.

## Scope and non-goals

Currently supported: stdio transport, tool discovery, tool calls, multiple servers, tool filtering and namespacing, environment variables, MCP Content → Agent Content, `AbortSignal` and timeouts.

Not handled (yet): Resources, Prompts, Sampling, Elicitation, OAuth and Streamable HTTP.

## API reference

| Export                 | Kind     | Description                                                                               |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `createMcp`            | function | `createMcp({ cwd, configFile, required })` → `Promise<Mcp>`; same as `Mcp.open()`         |
| `Mcp`                  | class    | Connected instance: `servers`, `tools`, `close()`, `Symbol.asyncDispose`, static `open()` |
| `loadMcpConfig`        | function | Reads, parses and normalizes the config file without connecting to anything               |
| `McpConfig`            | type     | `{ mcpServers?: Record<string, McpServerConfig> }`                                        |
| `McpOptions`           | type     | `{ cwd: string; configFile: string; required?: boolean }`                                 |
| `McpServerConfig`      | type     | The normalized per-server configuration (see the table above)                             |
| `McpStdioServerConfig` | type     | Alias source of `McpServerConfig`; only `type: 'stdio'` is supported                      |
| `McpServer`            | type     | `{ name, client, config }` — `client` is an `@modelcontextprotocol/client` `Client`       |
| `McpRuntime`           | type     | `McpTools` plus `servers` and `close()` — what a runtime consumes                         |
| `McpTools`             | type     | `{ readonly tools: readonly AgentTool[] }`                                                |
| `McpToolDetails`       | type     | `{ server, tool, structuredContent?, meta? }`, present on every tool result               |

## Design notes

Tools are discovered at start-up rather than at call time: each server is listed once while connecting, so an Agent always sees a stable tool list, and a server that changes its tools needs a reconnect. The MCP `inputSchema` is reused verbatim as the parameter schema instead of being rebuilt, which keeps validation exactly as the server declared it.

Collisions are errors, because silently overriding a tool name would let an Agent call an unpredictable server; duplicate names abort start-up and point at `prefix`. Servers themselves come only from configuration — `createMcp()` takes an explicit `cwd` and `configFile` instead of searching for them, which keeps the package usable from any layout. The host owns the lifecycle: `Mcp` connects eagerly and closes explicitly, so a runtime can share one instance across several agents.

## Development

```bash
vp check        # format, lint and type check
vp test --run   # unit tests
vp run build    # build the package
```

Tests live in `tests/lifecycle.test.ts` and cover client cleanup when connecting or listing tools fails, reverse-order shutdown, repeated-close sharing, and suppressed cleanup errors. `packages/mcp/package.json` defines the `check` (`vp check`) and `prepublishOnly` (`vp run build`) scripts; the `build` (`vp pack`) and `test` tasks themselves come from `vite.config.ts`.
