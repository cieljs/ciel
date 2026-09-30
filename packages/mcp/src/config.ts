import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { McpConfig, McpOptions, McpServerConfig } from './types.ts';

export interface LoadedMcpConfig {
  config: McpConfig;
  cwd: string;
  configFile: string;
}

export async function loadMcpConfig(options: McpOptions): Promise<LoadedMcpConfig> {
  const cwd = resolve(options.cwd);

  const configFile = resolveConfigFile(cwd, options.configFile);

  let text: string;

  try {
    text = await readFile(configFile, 'utf8');
  } catch (error) {
    const isMissing = error instanceof Error && 'code' in error && error.code === 'ENOENT';

    if (isMissing && !options.required) {
      return {
        config: {
          mcpServers: {},
        },
        cwd,
        configFile,
      };
    }

    throw error;
  }

  const raw = JSON.parse(text) as unknown;
  const config = parseMcpConfig(raw);

  return {
    config,
    cwd,
    configFile,
  };
}

function resolveConfigFile(cwd: string, configFile: string): string {
  if (isAbsolute(configFile)) {
    return configFile;
  }

  return resolve(cwd, configFile);
}

function parseMcpConfig(value: unknown): McpConfig {
  if (!isRecord(value)) {
    throw new Error('MCP 配置必须是 JSON object');
  }

  const rawServers = value.mcpServers;

  if (rawServers === undefined) {
    return {
      mcpServers: {},
    };
  }

  if (!isRecord(rawServers)) {
    throw new Error('mcpServers 必须是 JSON object');
  }

  const mcpServers: Record<string, McpServerConfig> = {};

  for (const [name, server] of Object.entries(rawServers)) {
    mcpServers[name] = parseServerConfig(name, server);
  }

  return {
    mcpServers,
  };
}

function parseServerConfig(name: string, value: unknown): McpServerConfig {
  if (!isRecord(value)) {
    throw new Error(`MCP Server "${name}" 配置必须是 object`);
  }

  if (typeof value.command !== 'string' || !value.command.trim()) {
    throw new Error(`MCP Server "${name}" 缺少 command`);
  }

  if (value.type !== undefined && value.type !== 'stdio') {
    throw new Error(`MCP Server "${name}" 暂不支持 transport "${JSON.stringify(value.type)}"`);
  }

  return {
    type: 'stdio',
    enabled: readBoolean(value.enabled, true),
    command: value.command,
    args: readStringArray(value.args, `${name}.args`),
    cwd: readOptionalString(value.cwd, `${name}.cwd`),
    env: readEnv(value.env, name),
    tools: readStringArray(value.tools, `${name}.tools`),
    excludeTools: readStringArray(value.excludeTools, `${name}.excludeTools`),
    prefix: readPrefix(value.prefix, name),
    timeout: readOptionalNumber(value.timeout, `${name}.timeout`),
  };
}

function readEnv(value: unknown, serverName: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error(`${serverName}.env 必须是 object`);
  }

  const env: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== 'string') {
      throw new Error(`${serverName}.env.${key} 必须是 string`);
    }

    env[key] = expandEnvironmentVariables(rawValue);
  }

  return env;
}

function expandEnvironmentVariables(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name: string) => {
    const envValue = process.env[name];

    if (envValue === undefined) {
      throw new Error(`MCP 配置引用了未定义的环境变量 "${name}"`);
    }

    return envValue;
  });
}

function readStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`${name} 必须是 string[]`);
  }

  return value;
}

function readOptionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${name} 必须是 string`);
  }

  return value;
}

function readOptionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} 必须是 number`);
  }

  return value;
}

function readBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error('enabled 必须是 boolean');
  }

  return value;
}

function readPrefix(value: unknown, serverName: string): boolean | string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const valid = typeof value === 'boolean' || (typeof value === 'string' && value.length > 0);

  if (!valid) {
    throw new Error(`${serverName}.prefix 必须是 boolean 或非空 string`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
