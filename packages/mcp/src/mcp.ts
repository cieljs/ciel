import { resolve } from 'node:path';

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Client, type Tool } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { loadMcpConfig } from './config.ts';
import { convertMcpContent, mcpErrorMessage } from './content.ts';
import type {
  McpOptions,
  McpRuntime,
  McpServer,
  McpServerConfig,
  McpToolDetails,
} from './types.ts';

export class Mcp implements McpRuntime, AsyncDisposable {
  private readonly servers = new Map<string, McpServer>();
  private readonly toolList: AgentTool[] = [];

  private readonly disposables = new AsyncDisposableStack();
  private closing: Promise<void> | undefined;

  private constructor(private readonly cwd: string) {}

  get serverNames(): readonly string[] {
    return [...this.servers.keys()];
  }

  get tools(): readonly AgentTool[] {
    return this.toolList;
  }

  static async open(options: McpOptions): Promise<Mcp> {
    const loaded = await loadMcpConfig(options);
    await using disposables = new AsyncDisposableStack();
    const mcp = disposables.use(new Mcp(loaded.cwd));

    await mcp.connectServers(loaded.config.mcpServers ?? {});
    disposables.move();

    return mcp;
  }

  close(): Promise<void> {
    this.closing ??= this.closeResources();

    return this.closing;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private async closeResources(): Promise<void> {
    this.servers.clear();
    this.toolList.length = 0;

    await this.disposables.disposeAsync();
  }

  private async connectServers(configs: Record<string, McpServerConfig>): Promise<void> {
    for (const [name, config] of Object.entries(configs)) {
      if (config.enabled === false) {
        continue;
      }

      await this.connectServer(name, config);
    }

    assertUniqueToolNames(this.toolList);
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    const client = new Client({
      name: `ciel:${name}`,
      version: '0.0.1',
    });

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: resolveServerCwd(this.cwd, config.cwd),
      env: config.env,
    });

    this.disposables.defer(() => client.close());

    await client.connect(transport, {
      timeout: config.timeout,
    });

    const { tools } = await client.listTools(undefined, {
      timeout: config.timeout,
    });

    const server: McpServer = {
      name,
      client,
      config,
    };

    this.servers.set(name, server);

    for (const tool of tools) {
      if (!shouldExposeTool(tool.name, config)) {
        continue;
      }

      this.toolList.push(createAgentTool(server, tool));
    }
  }
}

export async function createMcp(options: McpOptions): Promise<Mcp> {
  return Mcp.open(options);
}

function createAgentTool(server: McpServer, tool: Tool): AgentTool {
  const name = resolveToolName(server.name, tool.name, server.config.prefix);

  return {
    name,
    label: tool.title ?? tool.annotations?.title ?? tool.name,

    description: tool.description ?? `MCP tool "${tool.name}" from "${server.name}"`,

    /**
     * MCP inputSchema 本身就是 JSON Schema。
     *
     * pi-agent-core / TypeBox 运行时同样使用 JSON Schema，
     * 所以这里无需重新构建 schema。
     */
    parameters: tool.inputSchema as AgentTool['parameters'],

    async execute(_toolCallId, params, signal): Promise<AgentToolResult<McpToolDetails>> {
      const result = await server.client.callTool(
        {
          name: tool.name,
          arguments: params as Record<string, unknown>,
        },
        {
          signal,
          timeout: server.config.timeout,
          toolDefinition: tool,
        },
      );

      if (result.isError) {
        throw new Error(mcpErrorMessage(result));
      }

      return {
        content: convertMcpContent(result),

        details: {
          server: server.name,
          tool: tool.name,
          structuredContent: result.structuredContent,
          meta: result._meta,
        },
      };
    },
  };
}

function shouldExposeTool(name: string, config: McpServerConfig): boolean {
  const allowList = config.tools;

  const excluded = config.excludeTools?.includes(name) ?? false;

  if (excluded) {
    return false;
  }

  if (!allowList) {
    return true;
  }

  return allowList.includes(name);
}

function resolveToolName(
  serverName: string,
  toolName: string,
  prefix: boolean | string | undefined,
): string {
  if (!prefix) {
    return toolName;
  }

  const namespace = typeof prefix === 'string' ? prefix : serverName;

  return `${namespace}__${toolName}`;
}

function resolveServerCwd(projectCwd: string, serverCwd: string | undefined): string | undefined {
  if (!serverCwd) {
    return projectCwd;
  }

  return resolve(projectCwd, serverCwd);
}

function assertUniqueToolNames(tools: AgentTool[]): void {
  const names = new Set<string>();

  for (const tool of tools) {
    const duplicated = names.has(tool.name);

    if (duplicated) {
      throw new Error(
        [`MCP tool name 冲突: "${tool.name}"`, '', '请为对应 MCP Server 配置 prefix。'].join('\n'),
      );
    }

    names.add(tool.name);
  }
}
