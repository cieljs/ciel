import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { MemoryManager } from '../memory-manager.ts';
import type { GlobalLongTermMemory, SpaceMemory } from '../memory-store.ts';
import type { MemoryEntry, MemorySource } from '../types.ts';

export interface MemorySourceProviderContext {
  toolCallId: string;
  action: 'remember' | 'update';
  signal?: AbortSignal;
}

export type MemorySourceProvider = (
  context: MemorySourceProviderContext,
) => MemorySource[] | Promise<MemorySource[]>;

export type CrossSpaceMemoryAccess = 'related' | 'all';

export interface CrossSpaceMemoryOptions {
  manager: MemoryManager;
  access: CrossSpaceMemoryAccess;
}

export interface MemoryToolsOptions {
  space: SpaceMemory;
  sources?: MemorySource[] | MemorySourceProvider;
  sourcesMode?: 'append' | 'replace';
  rememberDaily?: boolean;
  rememberLongTerm?: boolean;
  update?: boolean;
  archive?: boolean;
  searchLimit?: number;
  maxReadChars?: number;
  crossSpace?: CrossSpaceMemoryOptions;
}

export interface GlobalMemoryToolsOptions {
  memory: GlobalLongTermMemory;
  sources?: MemorySource[] | MemorySourceProvider;
  sourcesMode?: 'append' | 'replace';
  remember?: boolean;
  update?: boolean;
  archive?: boolean;
  maxReadChars?: number;
}

export interface LoadMemoryContextOptions {
  manager: MemoryManager;
  space: SpaceMemory;
  globalLongTermTokens?: number;
  spaceLongTermTokens?: number;
  dailyTokens?: number;
  recentDays?: number;
  query?: string;
  countTokens?: (text: string) => number;
  signal?: AbortSignal;
}

export interface MemoryContextSection {
  text: string;
  memories: MemoryEntry[];
  tokens: number;
}

export interface LoadedMemoryContext {
  globalLongTerm: MemoryContextSection;
  spaceLongTerm: MemoryContextSection;
  daily: MemoryContextSection;
}

/** @internal */
export interface ResolvedToolOptions {
  maxReadChars: number;
  searchLimit: number;
  sourcesMode: 'append' | 'replace';
  resolveSources(context: MemorySourceProviderContext): Promise<MemorySource[]>;
}

/** @internal */
export type MemoryTool = AgentTool;
