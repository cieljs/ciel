import type { MemorySelector } from './query.ts';
import type { MemoryRepository } from './repository.ts';
import type { MemoryRetrieval } from './retrieval.ts';
import type {
  DailyRememberInput,
  ArchiveMemoryOptions,
  LongTermRememberInput,
  MemoryEntryFor,
  MemoryHistoryOptions,
  MemoryLayer,
  MemoryListOptions,
  MemoryReadOptions,
  MemoryRevision,
  MemorySearchHit,
  MemorySearchOptions,
  MemorySourceSearchHit,
  MemorySourceSearchOptions,
  SpaceMemoryEntry,
  SpaceMemoryListOptions,
  SpaceMemorySearchOptions,
  SpaceMemorySourceSearchOptions,
  UpdateMemoryInput,
} from './types.ts';

export interface MemoryLayerStore<Layer extends MemoryLayer, RememberInput> {
  readonly layer: Layer;

  remember(input: RememberInput): Promise<MemoryEntryFor<Layer>>;
  get(id: string, options?: MemoryReadOptions): Promise<MemoryEntryFor<Layer> | null>;
  list(options?: MemoryListOptions): Promise<MemoryEntryFor<Layer>[]>;
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchHit<Layer>[]>;
  searchBySource(
    query: string,
    options?: Omit<MemorySourceSearchOptions, 'layers'>,
  ): Promise<MemorySourceSearchHit<Layer>[]>;
  update(id: string, input: UpdateMemoryInput): Promise<MemoryEntryFor<Layer>>;
  archive(id: string, options: ArchiveMemoryOptions): Promise<void>;
  history(id: string, options?: MemoryHistoryOptions): Promise<MemoryRevision[]>;
  getRevision(id: string, revision: number): Promise<MemoryRevision | null>;
}

export interface GlobalLongTermMemory extends MemoryLayerStore<
  'global.long_term',
  LongTermRememberInput
> {}

export interface SpaceMemory {
  readonly spaceId: string;
  readonly longTerm: MemoryLayerStore<'space.long_term', LongTermRememberInput>;
  readonly daily: MemoryLayerStore<'space.daily', DailyRememberInput>;

  get(id: string, options?: MemoryReadOptions): Promise<SpaceMemoryEntry | null>;
  list(options?: SpaceMemoryListOptions): Promise<SpaceMemoryEntry[]>;
  search(
    query: string,
    options?: SpaceMemorySearchOptions,
  ): Promise<MemorySearchHit<'space.long_term' | 'space.daily'>[]>;
  searchBySource(
    query: string,
    options?: SpaceMemorySourceSearchOptions,
  ): Promise<MemorySourceSearchHit<'space.long_term' | 'space.daily'>[]>;
  update(id: string, input: UpdateMemoryInput): Promise<SpaceMemoryEntry>;
  archive(id: string, options: ArchiveMemoryOptions): Promise<void>;
  history(id: string, options?: MemoryHistoryOptions): Promise<MemoryRevision[]>;
  getRevision(id: string, revision: number): Promise<MemoryRevision | null>;
}

export interface MemoryStoreServices {
  repository: MemoryRepository;
  retrieval: MemoryRetrieval;
  operate<T>(operation: () => Promise<T>): Promise<T>;
}

class MemoryLayerStoreImplementation<
  Layer extends MemoryLayer,
  RememberInput extends LongTermRememberInput | DailyRememberInput,
> implements MemoryLayerStore<Layer, RememberInput> {
  private readonly selector: MemorySelector;

  constructor(
    private readonly services: MemoryStoreServices,
    readonly layer: Layer,
    spaceId?: string,
  ) {
    this.selector = { layers: [layer], spaceId };
  }

  remember(input: RememberInput): Promise<MemoryEntryFor<Layer>> {
    return this.services.operate(() =>
      this.services.repository.remember(this.selector, { ...input, layer: this.layer }),
    ) as Promise<MemoryEntryFor<Layer>>;
  }

  get(id: string, options?: MemoryReadOptions): Promise<MemoryEntryFor<Layer> | null> {
    return this.services.operate(() =>
      this.services.repository.get(this.selector, id, options),
    ) as Promise<MemoryEntryFor<Layer> | null>;
  }

  list(options?: MemoryListOptions): Promise<MemoryEntryFor<Layer>[]> {
    return this.services.operate(() =>
      this.services.repository.list(this.selector, options),
    ) as Promise<MemoryEntryFor<Layer>[]>;
  }

  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchHit<Layer>[]> {
    return this.services.operate(() =>
      this.services.retrieval.search(this.selector, query, options),
    ) as unknown as Promise<MemorySearchHit<Layer>[]>;
  }

  searchBySource(
    query: string,
    options?: Omit<MemorySourceSearchOptions, 'layers'>,
  ): Promise<MemorySourceSearchHit<Layer>[]> {
    return this.services.operate(() =>
      this.services.retrieval.searchBySource(this.selector, query, options),
    ) as unknown as Promise<MemorySourceSearchHit<Layer>[]>;
  }

  update(id: string, input: UpdateMemoryInput): Promise<MemoryEntryFor<Layer>> {
    return this.services.operate(() =>
      this.services.repository.update(this.selector, id, input),
    ) as Promise<MemoryEntryFor<Layer>>;
  }

  archive(id: string, options: ArchiveMemoryOptions): Promise<void> {
    return this.services.operate(() =>
      this.services.repository.archive(this.selector, id, options.expectedRevision),
    );
  }

  history(id: string, options?: MemoryHistoryOptions): Promise<MemoryRevision[]> {
    return this.services.operate(() =>
      this.services.repository.history(this.selector, id, options),
    );
  }

  getRevision(id: string, revision: number): Promise<MemoryRevision | null> {
    return this.services.operate(() =>
      this.services.repository.getRevision(this.selector, id, revision),
    );
  }
}

export function createGlobalMemory(services: MemoryStoreServices): GlobalLongTermMemory {
  return new MemoryLayerStoreImplementation(services, 'global.long_term');
}

export function createSpaceMemory(services: MemoryStoreServices, spaceId: string): SpaceMemory {
  const selector: MemorySelector = {
    layers: ['space.long_term', 'space.daily'],
    spaceId,
  };

  return {
    spaceId,
    longTerm: new MemoryLayerStoreImplementation(services, 'space.long_term', spaceId),
    daily: new MemoryLayerStoreImplementation(services, 'space.daily', spaceId),
    get: (id, options) =>
      services.operate(() =>
        services.repository.get(selector, id, options),
      ) as Promise<SpaceMemoryEntry | null>,
    list: (options = {}) => {
      const { layers = selector.layers, ...filter } = options;

      return services.operate(() =>
        services.repository.list({ ...selector, layers }, filter),
      ) as Promise<SpaceMemoryEntry[]>;
    },
    search: (query, options = {}) => {
      const { layers = selector.layers, ...filter } = options;

      return services.operate(() =>
        services.retrieval.search({ ...selector, layers }, query, filter),
      ) as Promise<MemorySearchHit<'space.long_term' | 'space.daily'>[]>;
    },
    searchBySource: (query, options = {}) => {
      const { layers = selector.layers, ...filter } = options;

      return services.operate(() =>
        services.retrieval.searchBySource({ ...selector, layers }, query, filter),
      ) as Promise<MemorySourceSearchHit<'space.long_term' | 'space.daily'>[]>;
    },
    update: (id, input) =>
      services.operate(() =>
        services.repository.update(selector, id, input),
      ) as Promise<SpaceMemoryEntry>,
    archive: (id, options) =>
      services.operate(() => services.repository.archive(selector, id, options.expectedRevision)),
    history: (id, options) =>
      services.operate(() => services.repository.history(selector, id, options)),
    getRevision: (id, revision) =>
      services.operate(() => services.repository.getRevision(selector, id, revision)),
  };
}
