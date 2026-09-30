import type { Storage } from '@cieljs/storage';
import type { VectorService } from '@cieljs/vector';

export type { EmbeddingOptions, EmbeddingProvider } from '@cieljs/model-kit';

export type MemoryLayer = 'global.long_term' | 'space.long_term' | 'space.daily';
export type SpaceMemoryLayer = 'space.long_term' | 'space.daily';
export type MemoryKind = 'event' | 'fact' | 'preference' | 'summary';
export type MemoryStatus = 'active' | 'archived';
export type MemorySource = string;

interface MemoryEntryFields {
  id: string;
  revision: number;
  kind: MemoryKind;
  content: string;
  sources: MemorySource[];
  status: MemoryStatus;
  occurredAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MemoryEntry = MemoryEntryFields &
  (
    | { layer: 'global.long_term'; spaceId: null; date: null }
    | { layer: 'space.long_term'; spaceId: string; date: null }
    | { layer: 'space.daily'; spaceId: string; date: string }
  );

export type MemoryEntryFor<Layer extends MemoryLayer> = Extract<MemoryEntry, { layer: Layer }>;
export type SpaceMemoryEntry = Extract<MemoryEntry, { spaceId: string }>;

interface RememberFields {
  content: string;
  kind?: MemoryKind;
  occurredAt?: Date;
  expiresAt?: Date | null;
  sources?: MemorySource[];
}

export type LongTermRememberInput = RememberFields;

export interface DailyRememberInput extends RememberFields {
  /** 省略时根据 occurredAt 和 manager.timeZone 计算 */
  date?: string;
}

/** @internal */
export interface ScopedRememberInput extends RememberFields {
  layer: MemoryLayer;
  date?: string;
}

export interface UpdateMemoryInput {
  expectedRevision: number;
  content?: string;
  kind?: MemoryKind;
  expiresAt?: Date | null;
  sources?: MemorySource[];
}

export interface ArchiveMemoryOptions {
  expectedRevision: number;
}

export interface MemoryRevision {
  memoryId: string;
  revision: number;
  kind: MemoryKind;
  content: string;
  sources: MemorySource[];
  occurredAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface MemoryHistoryOptions {
  limit?: number;
  beforeRevision?: number;
}

export interface MemoryReadOptions {
  includeArchived?: boolean;
  includeExpired?: boolean;
}

export interface MemoryListOptions extends MemoryReadOptions {
  kind?: MemoryKind;
  limit?: number;
  offset?: number;
}

export interface SpaceMemoryListOptions extends MemoryListOptions {
  layers?: SpaceMemoryLayer[];
  dateFrom?: string;
  dateTo?: string;
}

export type MemorySearchMode = 'hybrid' | 'full_text' | 'trigram' | 'vector';
export type MemorySearchMatch = 'full_text' | 'trigram' | 'vector';

export interface MemorySearchOptions extends MemoryReadOptions {
  mode?: MemorySearchMode;
  kind?: MemoryKind;
  limit?: number;
  offset?: number;
  candidateLimit?: number;
  minVectorSimilarity?: number;
  signal?: AbortSignal;
}

export interface SpaceMemorySearchOptions extends MemorySearchOptions {
  layers?: SpaceMemoryLayer[];
  dateFrom?: string;
  dateTo?: string;
}

export interface SearchAllMemoryOptions extends MemorySearchOptions {
  layers?: MemoryLayer[];
  dateFrom?: string;
  dateTo?: string;
}

export interface MemorySearchHit<Layer extends MemoryLayer = MemoryLayer> {
  memory: MemoryEntryFor<Layer>;
  excerpt: string;
  /** 排名分数，不表示概率 */
  score: number;
  matches: MemorySearchMatch[];
}

export type MemorySourceSearchMode = 'auto' | 'exact' | 'text';

export interface MemorySourceSearchOptions extends MemoryReadOptions {
  mode?: MemorySourceSearchMode;
  includeHistory?: boolean;
  layers?: MemoryLayer[];
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export interface SpaceMemorySourceSearchOptions extends Omit<MemorySourceSearchOptions, 'layers'> {
  layers?: SpaceMemoryLayer[];
}

export interface MemorySourceSearchHit<Layer extends MemoryLayer = MemoryLayer> {
  memoryId: string;
  revision: number;
  spaceId: MemoryEntryFor<Layer>['spaceId'];
  layer: Layer;
  date: MemoryEntryFor<Layer>['date'];
  matchedSources: MemorySource[];
  excerpt: string;
  score: number;
}

export interface FindMemorySpacesOptions {
  mode?: MemorySourceSearchMode;
  layers?: SpaceMemoryLayer[];
  limit?: number;
  signal?: AbortSignal;
}

export interface MemorySpaceSourceHit {
  spaceId: string;
  score: number;
  matchedSources: MemorySource[];
  memories: Array<{
    id: string;
    revision: number;
    layer: SpaceMemoryLayer;
    excerpt: string;
  }>;
}

export interface MemoryManagerOptions {
  storage: Storage;
  timeZone: string;
  vectors?: VectorService;
  tokenize?: (text: string) => string[];
  onIndexError?: (error: unknown) => void;
}

export interface MemoryIndexStatus {
  pending: number;
  ready: number;
  failed: number;
}
