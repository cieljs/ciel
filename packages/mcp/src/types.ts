import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Client } from '@modelcontextprotocol/client';

export interface McpStdioServerConfig {
  /**
   * 当前 v0 只支持 stdio。
   */
  type?: 'stdio';

  /**
   * 是否启用当前 MCP Server。
   *
   * 默认 true。
   */
  enabled?: boolean;

  /**
   * MCP Server 启动命令。
   */
  command: string;

  /**
   * 启动参数。
   */
  args?: string[];

  /**
   * MCP Server 工作目录。
   *
   * 相对路径相对于 Ciel 项目 cwd。
   */
  cwd?: string;

  /**
   * 传递给 MCP Server 的环境变量。
   *
   * 支持：
   *
   * ${BOCHA_API_KEY}
   */
  env?: Record<string, string>;

  /**
   * 只暴露指定 MCP tools。
   *
   * 不设置表示全部暴露。
   */
  tools?: string[];

  /**
   * 排除指定 MCP tools。
   */
  excludeTools?: string[];

  /**
   * 给 tool name 添加 namespace。
   *
   * false:
   *   web_search
   *
   * true:
   *   search__web_search
   *
   * "web":
   *   web__web_search
   *
   * 默认 false。
   */
  prefix?: boolean | string;

  /**
   * MCP 请求超时时间。
   */
  timeout?: number;
}

export type McpServerConfig = McpStdioServerConfig;

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface McpOptions {
  /**
   * Ciel 项目根目录。
   *
   */
  cwd: string;

  /**
   * MCP 配置路径。
   *
   */
  configFile: string;

  /**
   * 配置不存在时是否报错。
   *
   * 默认 false。
   */
  required?: boolean;
}

export interface McpToolDetails {
  server: string;
  tool: string;
  structuredContent?: unknown;
  meta?: unknown;
}

export interface McpServer {
  name: string;
  client: Client;
  config: McpServerConfig;
}

export interface McpTools {
  readonly tools: readonly AgentTool[];
}

export interface McpRuntime extends McpTools, AsyncDisposable {
  readonly serverNames: readonly string[];

  close(): Promise<void>;
}
