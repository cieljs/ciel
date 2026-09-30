<h1 align="center">@cieljs/bili-agent-tools</h1>

<p align="center">通过哔哩哔哩 Web API 查询搜索结果、用户动态、投稿和直播间的 Agent 工具。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#工具列表">工具列表</a> ·
  <a href="#cookie-与-electron">Cookie 与 Electron</a> ·
  <a href="#选项">选项</a> ·
  <a href="#api-参考">API 参考</a>
</p>

`@cieljs/bili-agent-tools` 基于 [`@cieljs/agent-kit`](../agent-kit/README.zh-CN.md) 创建六个只读 `AgentTool`。默认使用 Node.js `fetch`；宿主可以替换 HTTP 实现，并在需要登录态时提供哔哩哔哩会话，无需启动 MCP 服务。

## 安装

```bash
pnpm add @cieljs/bili-agent-tools
```

在本仓库中，依赖方使用 `workspace:` 协议。

## 快速开始

```ts
import { createBiliAgentTools } from '@cieljs/bili-agent-tools';

const tools = createBiliAgentTools({
  cookie: 'SESSDATA=...; bili_jct=...; buvid3=...',
});

// tools 可以和其他 AgentTool[] 一起交给 Agent。
```

`cookie` 可以省略。缺少登录态时，部分接口只能返回公开数据，或直接拒绝请求。工厂返回的工具可以直接交给 Agent，不需要再转换工具格式。

## 工具列表

| 工具                        | 输入与结果                                                           |
| --------------------------- | -------------------------------------------------------------------- |
| `search_bili`               | 按 `keyword` 搜索视频、专栏、直播间或用户；`type` 默认是 `video`     |
| `get_bili_user_dynamics`    | 按 `uid` 查询最近动态；继续翻页时把返回的 `nextOffset` 传给 `offset` |
| `get_bili_dynamic_detail`   | 按字符串 `id` 或 opus 页面地址读取单条动态的完整正文和图片           |
| `get_bili_pinned_dynamic`   | 按 `uid` 查询置顶动态；没有置顶时返回 `dynamic: null`                |
| `get_bili_user_submissions` | 按 `uid` 分页查询视频或专栏投稿；不支持音频投稿                      |
| `get_bili_live_room`        | 按 `roomId` 查询直播间，或通过主播 `uid` 反查直播间                  |

搜索、动态和投稿查询默认最多返回 10 条。每个工具的参数 Schema 描述了翻页方式与数量上限。这些工具返回元数据和公开动态正文，不提供视频字幕、评论或章节。

## Cookie 与 Electron

Node.js `fetch` 接受 `credentials: 'include'`，但没有可自动读取哔哩哔哩登录态的浏览器 Cookie 会话。可传入 `cookie` 字符串，或注入使用宿主 Cookie 会话的 `fetch`。本包每次请求都会设置 `credentials: 'include'`。

如果 Electron webview 使用 `partition="persist:blive-agent"`，工具也应使用同一分区：

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

移除本包生成的 `Cookie` 请求头后，Electron 会使用当前会话中的 Cookie，包括登录或退出后的变化。用户动态接口尤其容易在未登录时拒绝请求。

## 选项

`createBiliAgentTools(options)` 和 `createBiliClient(options)` 使用相同的可选配置：

| 选项        | 类型                                                     | 默认值          | 说明                                            |
| ----------- | -------------------------------------------------------- | --------------- | ----------------------------------------------- |
| `cookie`    | `string`                                                 | 无              | 手动管理会话时使用的初始哔哩哔哩 Cookie 请求头  |
| `fetch`     | `(url: string, init?: RequestInit) => Promise<Response>` | Node.js `fetch` | 宿主的 HTTP 实现，例如 Electron `session.fetch` |
| `timeoutMs` | `number`                                                 | `15_000`        | 单次 HTTP 请求的超时时间，单位毫秒              |
| `userAgent` | `string`                                                 | 浏览器风格 UA   | 请求中的 User-Agent                             |

客户端会把响应的 `Set-Cookie` 读入内部 Cookie 映射，供手动会话中的后续请求使用。Electron 适配时应像上例一样移除该请求头，让浏览器会话成为 Cookie 的唯一来源。

## API 参考

| 导出                    | 类型 | 用途                                                                 |
| ----------------------- | ---- | -------------------------------------------------------------------- |
| `createBiliAgentTools`  | 函数 | 创建六个 `AgentTool`                                                 |
| `createBiliClient`      | 函数 | 创建底层客户端，提供 `request<T>(url, { query?, signed?, signal? })` |
| `BiliApiError`          | 类   | 哔哩哔哩返回非零 `code` 时抛出，包含 `code` 和 `url`                 |
| `BiliAgentToolsOptions` | 类型 | 工具工厂选项，是 `BiliClientOptions` 的别名                          |
| `BiliClientOptions`     | 接口 | Cookie、fetch、超时和 User-Agent 配置                                |
| `BiliClient`            | 类型 | `createBiliClient` 的返回类型                                        |
| `BiliApiRequest`        | 接口 | 查询参数、WBI 签名开关和中止信号                                     |

需要 WBI 签名的接口会从哔哩哔哩 `nav` 接口获取口令，并缓存六小时。HTTP 请求失败会抛错；返回非零 `code` 时抛出 `BiliApiError`。工具结果会整理为供 Agent 使用的文本内容和结构化 `details`。

## 开发

在本包目录运行：

```bash
vp check      # 格式、Lint 与类型检查
vp test       # 使用本地伪造 fetch，不请求真实哔哩哔哩接口
vp run build  # 通过 Vite+ 任务构建
```
