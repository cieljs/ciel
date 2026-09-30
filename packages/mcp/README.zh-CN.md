<h1 align="center">@cieljs/mcp</h1>

<p align="center">把任意 MCP Server 暴露的工具，动态转换成 Ciel Agent 可以直接调用的工具。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概览">概览</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#配置">配置</a> ·
  <a href="#环境变量">环境变量</a> ·
  <a href="#工具过滤">工具过滤</a> ·
  <a href="#namespace-与工具名冲突">Namespace</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#作用范围">作用范围</a> ·
  <a href="#api-参考">API</a>
</p>

## 概览

`@cieljs/mcp` 是 Ciel 的外部工具来源。它通过 MCP `tools/list` 在启动时发现工具定义，把每个 MCP Tool 转换成一个普通的 `AgentTool`；Agent 调用工具时，再通过 `tools/call` 转发给对应的 MCP Server。

```text
MCP Server ──tools/list──▶ AgentTool[] ──Agent 调用──▶ tools/call ──▶ MCP Server
```

> [!NOTE]
> MCP 由宿主持有。多个 runtime 可以复用同一个实例；runtime 不创建或关闭 MCP 服务。

## 概念

| 概念             | 作用                                         |
| ---------------- | -------------------------------------------- |
| MCP Server       | 用 stdio 启动的外部进程，暴露一组 Tool       |
| `.ciel/mcp.json` | 声明要连接哪些 MCP Server 以及各自的配置     |
| `AgentTool[]`    | pi-agent-core 的统一工具形态，直接交给 Agent |

## 安装

```bash
pnpm add @cieljs/mcp
```

本包是纯 ESM，暴露两个入口：`"."` → `dist/index.mjs` 与 `"./package.json"`。它依赖 `@modelcontextprotocol/client` 提供协议、依赖 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai` 提供 Agent 工具与内容类型。在本仓库内，依赖方使用 `workspace:` 协议声明它。

## 快速开始

在项目目录创建 `.ciel/mcp.json`：

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

使用 `@cieljs/runtime` 时，传入已连接的 MCP 实例：

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

直接使用 Agent 时，也可以直接打开 MCP，把 `mcp.tools` 与本地工具一起交给 Agent：

```ts
import { createMcp } from '@cieljs/mcp';

const mcp = await createMcp({
  cwd: process.cwd(),
  configFile: '.ciel/mcp.json',
});

const tools = [...mcp.tools];

await mcp.close();
```

Server 暴露的工具会在启动时自动发现，不需要提前声明 `webSearch()`、`webFetch()` 之类的函数。

### 连接多个 Server

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

所有 Server 的工具会合并到同一个 `mcp.tools`：

```ts
console.log(mcp.tools.map(tool => tool.name));
// ["web_search", "web_fetch", "search_video", "get_video_info", "get_dynamic"]
```

## 配置

配置文件是一个 JSON object，只有一个 `mcpServers` 键，每一项对应一个 stdio Server：

| 键             | 类型                     | 默认值    | 说明                                                                   |
| -------------- | ------------------------ | --------- | ---------------------------------------------------------------------- |
| `command`      | `string`                 | —         | 必填且非空：启动 MCP Server 的命令                                     |
| `args`         | `string[]`               | —         | 传给 `command` 的参数                                                  |
| `env`          | `Record<string, string>` | —         | 传给 Server 的环境变量，值支持 `${VAR}` 展开（见下文）                 |
| `tools`        | `string[]`               | 全部工具  | 白名单：只暴露这些 MCP Tool                                            |
| `excludeTools` | `string[]`               | —         | 黑名单；两者同时存在时以它为准                                         |
| `enabled`      | `boolean`                | `true`    | `false` 时该 Server 完全跳过，不启动也不暴露工具                       |
| `prefix`       | `boolean \| string`      | `false`   | 工具名 namespace：`true` 用 Server 名，传字符串则用该字符串            |
| `cwd`          | `string`                 | 项目 cwd  | Server 的工作目录；相对路径相对于项目 `cwd` 解析                       |
| `timeout`      | `number`                 | —         | 每次请求的超时（毫秒），作用于 `connect`、`tools/list` 与 `tools/call` |
| `type`         | `"stdio"`                | `"stdio"` | 目前只支持 stdio，其他取值会在加载配置时直接失败                       |

### 工作目录与超时

MCP Server 默认继承 Ciel 项目的 cwd，可用 `cwd` 指定相对路径；`timeout` 控制每次请求的超时（毫秒）：

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

### 配置位置与可选性

MCP 不决定配置目录，调用方必须显式传入项目目录和配置文件：

```ts
const mcp = await createMcp({
  cwd: '/path/to/project',
  configFile: './config/mcp.json',
});
```

`configFile` 可以是绝对路径，相对路径相对于 `cwd` 解析。文件不存在时默认不报错，`mcp.tools` 返回空数组；如果当前程序必须依赖 MCP，传 `required: true`，配置文件缺失时直接失败。

配置本身写错时始终报错，与 `required` 无关：文件必须能解析为 JSON，根对象与 `mcpServers` 必须是 object，每个 Server 必须是带非空 `command` 的 object。`tools`、`excludeTools`、`args` 必须是 `string[]`，`timeout` 必须是有限数字，`enabled` 必须是 boolean，`prefix` 必须是 boolean 或非空 string。

## 环境变量

配置支持引用环境变量，避免把 API Key 直接写进 `.ciel/mcp.json`：

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

`${VAR}` 在加载配置时从 `process.env` 展开；匹配不区分大小写，变量名由字母、数字与下划线组成。引用的环境变量不存在时，MCP 初始化会直接失败，而不是带着缺失的密钥启动 Server。

## 工具过滤

默认暴露 Server 的全部工具，可以用 `tools` 只启用部分：

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

也可以用 `excludeTools` 排除指定工具；两者同时存在时 `excludeTools` 优先。暂时不需要某个 Server 时，设置 `enabled: false`，它就不会启动，也不会暴露工具。

过滤针对 MCP 原始工具名，发生在应用 `prefix` 之前。

## Namespace 与工具名冲突

不同 Server 可能提供同名工具，`@cieljs/mcp` 不会静默覆盖，而是直接报错。可以为 Server 开启 namespace：

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

得到 `web__search`、`bili__search`。`prefix: true` 用 Server 名做前缀，也可以传自定义字符串；拼接结果是 `<namespace>__<toolName>`。

> [!WARNING]
> 加前缀后仍有重名时，整个 `createMcp()` 会以 `MCP tool name 冲突: "<name>"` 失败，因此写错的 `prefix` 会在启动时暴露，而不会悄悄覆盖另一个 Server 的工具。

## 工作原理

MCP Server 负责描述工具，`@cieljs/mcp` 在连接后对每个 Server 执行一次 `tools/list`，把每个工具转换成 `AgentTool`：

| `AgentTool` 字段 | 来源                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `name`           | MCP 工具名，按 `prefix` 决定是否加 namespace                                                                       |
| `label`          | 依次取 `tool.title`、`annotations.title`、MCP 工具名                                                               |
| `description`    | `tool.description`；缺失时使用 `MCP tool "<tool>" from "<server>"`                                                 |
| `parameters`     | MCP 的 `inputSchema` 直接复用——MCP schema 本身就是 JSON Schema，pi-agent-core / TypeBox 运行时同样使用 JSON Schema |
| `execute()`      | 用 `arguments`、调用方的 `signal` 与配置的 `timeout` 转发到该 Server 的 `tools/call`                               |

返回 `isError` 的调用会抛错，错误信息取自返回的文本内容（没有文本时取 `structuredContent`，再退回 `MCP tool execution failed`）。成功的结果会转换为 `AgentToolResult`，其 `details` 携带 `{ server, tool, structuredContent, meta }`。

MCP Content 会转换为 Agent Content：

| MCP block       | 转换结果                                                                       |
| --------------- | ------------------------------------------------------------------------------ |
| `text`          | 文本内容                                                                       |
| `image`         | 图片内容（数据 + mime type）                                                   |
| `audio`         | 文本占位符 `[MCP audio: <mimeType>]`                                           |
| `resource_link` | 描述 name、URI、description 与 mime type 的文本                                |
| 内嵌 resource   | 带 `text` 时转文本；是图片 blob 时转图片；否则转带 URI 与 mime type 的文本描述 |
| 其他            | 原始 block 的 JSON                                                             |

结果没有任何可见内容但带有 `structuredContent` 时，会把这段 JSON 渲染成文本块，模型仍然能看到载荷。

### 归属与生命周期

`mcp` 是一个 `AsyncDisposable`：`close()`（以及 `await using`）按连接的逆序关闭全部 Server 客户端，重复调用共用同一个 Promise。实例由宿主持有——多个 runtime 可以复用它，runtime 不应关闭它。打开过程中途失败时，已经连接上的客户端会被回收，不会泄漏。

## 作用范围

当前支持 stdio transport、工具发现、工具调用、多 Server、工具过滤与 namespace、环境变量、MCP Content → Agent Content、AbortSignal 与超时。

暂不处理 Resources、Prompts、Sampling、Elicitation、OAuth 和 Streamable HTTP。

## API 参考

| 导出                   | 类型     | 说明                                                                               |
| ---------------------- | -------- | ---------------------------------------------------------------------------------- |
| `createMcp`            | function | `createMcp({ cwd, configFile, required })` → `Promise<Mcp>`，等价于 `Mcp.open()`   |
| `Mcp`                  | class    | 已连接的实例：`servers`、`tools`、`close()`、`Symbol.asyncDispose`，静态 `open()`  |
| `loadMcpConfig`        | function | 读取、解析并规范化配置文件，不建立任何连接                                         |
| `McpConfig`            | type     | `{ mcpServers?: Record<string, McpServerConfig> }`                                 |
| `McpOptions`           | type     | `{ cwd: string; configFile: string; required?: boolean }`                          |
| `McpServerConfig`      | type     | 规范化后的单个 Server 配置（见上表）                                               |
| `McpStdioServerConfig` | type     | `McpServerConfig` 的来源别名；只支持 `type: 'stdio'`                               |
| `McpServer`            | type     | `{ name, client, config }`，`client` 是 `@modelcontextprotocol/client` 的 `Client` |
| `McpRuntime`           | type     | `McpTools` 加上 `servers` 与 `close()`，即 runtime 消费的形态                      |
| `McpTools`             | type     | `{ readonly tools: readonly AgentTool[] }`                                         |
| `McpToolDetails`       | type     | `{ server, tool, structuredContent?, meta? }`，出现在每个工具结果上                |

## 设计取舍

工具在启动时发现，而不是调用时才发现：连接阶段每个 Server 只列一次工具，Agent 因此看到稳定的工具列表，Server 变更工具后需要重新连接。MCP 的 `inputSchema` 原样复用为参数 schema，而不是重新构建，校验行为因此与 Server 的声明完全一致。

重名直接报错，因为静默覆盖工具名会让 Agent 调用到不可预测的 Server；重名会中止启动并提示配置 `prefix`。服务器只来自配置——`createMcp()` 要求显式传入 `cwd` 与 `configFile`，不自行搜索目录，所以任何工程结构都能用。生命周期归宿主：`Mcp` 主动连接、显式关闭，一个 runtime 因此可以把同一实例共享给多个 Agent。

## 开发

```bash
vp check        # 格式化、lint 与类型检查
vp test --run   # 单元测试
vp run build    # 构建本包
```

测试位于 `tests/lifecycle.test.ts`，覆盖 connect 与 listTools 失败时的客户端回收、逆序关闭、重复关闭共享 Promise，以及清理错误被抑制的场景。`packages/mcp/package.json` 定义了 `check`（`vp check`）与 `prepublishOnly`（`vp run build`）脚本；`build`（`vp pack`）与 `test` 任务本身来自 `vite.config.ts`。
