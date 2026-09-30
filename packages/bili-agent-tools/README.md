<h1 align="center">@cieljs/bili-agent-tools</h1>

<p align="center">Bilibili Web API tools for search, user activity, submissions, and live rooms.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#tools">Tools</a> ·
  <a href="#cookies-and-electron">Cookies and Electron</a> ·
  <a href="#options">Options</a> ·
  <a href="#api-reference">API reference</a>
</p>

`@cieljs/bili-agent-tools` creates six read-only `AgentTool`s with [`@cieljs/agent-kit`](../agent-kit/README.md). It uses Node.js `fetch` by default; the host can supply another HTTP transport and, when needed, a Bilibili login session. No MCP server is required.

## Install

```bash
pnpm add @cieljs/bili-agent-tools
```

Inside this monorepo, dependants use the `workspace:` protocol.

## Quick start

```ts
import { createBiliAgentTools } from '@cieljs/bili-agent-tools';

const tools = createBiliAgentTools({
  cookie: 'SESSDATA=...; bili_jct=...; buvid3=...',
});

// Pass tools to the Agent alongside other AgentTool[] entries.
```

`cookie` is optional. Without a login session, some endpoints only return public data or reject requests. The returned tools can be passed directly to an Agent; no additional tool conversion is needed.

## Tools

| Tool                        | Input and result                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `search_bili`               | Search videos, articles, live rooms, or users by `keyword`; `type` defaults to `video` |
| `get_bili_user_dynamics`    | Read recent activity by `uid`; pass the returned `nextOffset` as `offset` to continue  |
| `get_bili_dynamic_detail`   | Read a full dynamic post by string `id` or opus URL, including its text and images     |
| `get_bili_pinned_dynamic`   | Read a user's pinned dynamic post by `uid`; `dynamic` is `null` when none is pinned    |
| `get_bili_user_submissions` | Page through a user's video or article submissions by `uid`; audio is not supported    |
| `get_bili_live_room`        | Read room information by `roomId`, or resolve the room from a streamer `uid`           |

Search, dynamics, and submissions default to at most 10 returned items. Each tool's parameter schema describes its pagination and limits. These tools return metadata and public post content; they do not retrieve video transcripts, comments, or chapters.

## Cookies and Electron

Node.js `fetch` accepts `credentials: 'include'`, but it has no browser cookie session to load a Bilibili login from. Supply a `cookie` string, or inject a fetch implementation backed by the host's cookie session. The package sends `credentials: 'include'` on each request.

For an Electron webview using `partition="persist:blive-agent"`, use the same partition for the tools:

```ts
import { createBiliAgentTools } from '@cieljs/bili-agent-tools';
import { session } from 'electron';

const biliSession = session.fromPartition('persist:blive-agent');

const tools = createBiliAgentTools({
  fetch: (url, init) => {
    const headers = new Headers(init?.headers);
    headers.delete('Cookie');

    return biliSession.fetch(url, { ...init, headers });
  },
});
```

Removing the package's `Cookie` header lets Electron use the current session cookies, including changes after login or logout. The Bilibili dynamic feed is particularly likely to reject requests without a login session.

## Options

`createBiliAgentTools(options)` and `createBiliClient(options)` accept the same optional settings:

| Option      | Type                                                     | Default         | Meaning                                                    |
| ----------- | -------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `cookie`    | `string`                                                 | none            | Initial Bilibili Cookie header for a manual session        |
| `fetch`     | `(url: string, init?: RequestInit) => Promise<Response>` | Node.js `fetch` | Host HTTP implementation, such as Electron `session.fetch` |
| `timeoutMs` | `number`                                                 | `15_000`        | Timeout for each HTTP request, in milliseconds             |
| `userAgent` | `string`                                                 | Browser-like UA | User-Agent request header                                  |

The client reads `Set-Cookie` response headers into its manual cookie map for subsequent requests. An Electron adapter should discard that generated `Cookie` header as shown above so the browser session stays authoritative.

## API reference

| Export                  | Kind      | Purpose                                                               |
| ----------------------- | --------- | --------------------------------------------------------------------- |
| `createBiliAgentTools`  | function  | Creates the six `AgentTool`s                                          |
| `createBiliClient`      | function  | Creates a client with `request<T>(url, { query?, signed?, signal? })` |
| `BiliApiError`          | class     | Nonzero Bilibili response `code`; exposes `code` and `url`            |
| `BiliAgentToolsOptions` | type      | Tool factory options; alias of `BiliClientOptions`                    |
| `BiliClientOptions`     | interface | Cookie, fetch, timeout, and User-Agent settings                       |
| `BiliClient`            | type      | Return type of `createBiliClient`                                     |
| `BiliApiRequest`        | interface | Query parameters, WBI signing flag, and abort signal                  |

Endpoints requiring WBI signatures load keys from Bilibili's `nav` endpoint and cache them for six hours. HTTP failures throw an error; a nonzero Bilibili `code` throws `BiliApiError`. Tool results are normalized into text content and structured `details` for the Agent.

## Development

Run these commands in this package:

```bash
vp check      # format, lint, and type check
vp test       # local fake-fetch tests; no live Bilibili requests
vp run build  # build the package via the Vite+ task
```
