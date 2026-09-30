import type { McpTools } from '@cieljs/mcp';
import type { MemoryManagerOptions } from '@cieljs/memory';
import type { OpenRuntimeSessionOptions, RuntimeSession, RuntimeStatus } from '@cieljs/runtime';
import type { SessionManagerOptions } from '@cieljs/session';
import type { StorageModule } from '@cieljs/storage';
import type { VectorOptions } from '@cieljs/vector';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { CielData } from './resources.ts';

export interface CielDataOptions {
  dataDir: string;
  timeZone: string;
  modules?: readonly StorageModule[];
  vector?: Omit<VectorOptions, 'storage'>;
  session?: Omit<SessionManagerOptions, 'storage' | 'vectors' | 'namespace'> & {
    namespace?: string;
  };
  investigation?: Omit<SessionManagerOptions, 'storage' | 'vectors' | 'namespace'> & {
    namespace?: string;
  };
  memory?: Omit<MemoryManagerOptions, 'storage' | 'vectors' | 'timeZone'>;
}

export interface CielOptions {
  data: CielData;
  model: Model<Api>;
  /** 请求级 API key，不写入全局环境变量或持久化存储。 */
  apiKey?: string;
  systemPrompt: string;
  tools?: AgentTool[];
  mcp?: McpTools;
  investigation?: {
    systemPrompt?: string;
    tools?: AgentTool[];
  };
}

export type CielSession = RuntimeSession;
export type CielStatus = RuntimeStatus;
export type OpenSessionOptions = OpenRuntimeSessionOptions;

export type { InvestigateOptions, InvestigationResult, InvestigationTarget } from '@cieljs/runtime';
export type { SessionSources } from '@cieljs/runtime';
