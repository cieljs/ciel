import type { GlobalLongTermMemory, SpaceMemory } from '../memory-store.ts';
import type { MemoryEntry } from '../types.ts';
import type { MemorySourceProviderContext, ResolvedToolOptions } from './types.ts';

export interface SpaceToolOptions {
  space: SpaceMemory;
  resolved: ResolvedToolOptions;
}

export interface LongTermRememberToolOptions {
  name: string;
  label: string;
  memory: SpaceMemory['longTerm'] | GlobalLongTermMemory;
  resolved: ResolvedToolOptions;
}

export interface UpdateToolOptions {
  name: string;
  label: string;
  memory: Pick<SpaceMemory, 'get' | 'update'> | GlobalLongTermMemory;
  resolved: ResolvedToolOptions;
}

export interface ArchiveToolOptions {
  name: string;
  label: string;
  memory: Pick<SpaceMemory, 'archive'> | GlobalLongTermMemory;
}

export interface ReadToolOptions {
  name: string;
  label: string;
  get: (id: string) => Promise<MemoryEntry | null>;
  resolved: ResolvedToolOptions;
}

export function sourceContext(
  context: { toolCallId: string; signal?: AbortSignal },
  action: MemorySourceProviderContext['action'],
): MemorySourceProviderContext {
  return { toolCallId: context.toolCallId, signal: context.signal, action };
}
