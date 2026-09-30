import { MemoryManager, memoryStorage } from '@cieljs/memory';
import { SessionManager, sessionStorage } from '@cieljs/session';
import { Storage, type StorageModule } from '@cieljs/storage';
import { VectorService, vectorStorage, type VectorOptions } from '@cieljs/vector';

import type { CielDataOptions } from './types.ts';

export class CielData implements AsyncDisposable {
  private closing?: Promise<void>;

  private constructor(
    private readonly disposables: AsyncDisposableStack,
    readonly storage: Storage,
    readonly sessions: SessionManager,
    readonly investigations: SessionManager,
    readonly memories: MemoryManager,
    readonly vectors?: VectorService,
  ) {}

  static async open(options: CielDataOptions): Promise<CielData> {
    const sessionNamespace = options.session?.namespace ?? 'session';
    const investigationNamespace = options.investigation?.namespace ?? 'investigation';

    if (sessionNamespace === investigationNamespace) {
      throw new TypeError('Session 与 Investigation namespace 不能相同');
    }

    await using disposables = new AsyncDisposableStack();
    const modules: StorageModule[] = [sessionStorage, memoryStorage];

    if (options.vector) {
      modules.push(vectorStorage);
    }

    modules.push(...(options.modules ?? []));

    const storage = disposables.use(await Storage.open({ dataDir: options.dataDir, modules }));

    const vectors = options.vector
      ? disposables.use(new VectorService({ ...options.vector, storage } satisfies VectorOptions))
      : undefined;

    const sessions = disposables.use(
      await SessionManager.open({
        ...options.session,
        storage,
        namespace: sessionNamespace,
        vectors,
      }),
    );

    const investigations = disposables.use(
      await SessionManager.open({
        ...options.investigation,
        storage,
        namespace: investigationNamespace,
        vectors,
      }),
    );

    const memories = disposables.use(
      await MemoryManager.open({
        ...options.memory,
        timeZone: options.timeZone,
        storage,
        vectors,
      }),
    );

    return new CielData(disposables.move(), storage, sessions, investigations, memories, vectors);
  }

  get isClosed(): boolean {
    return this.closing !== undefined;
  }

  close(): Promise<void> {
    this.closing ??= this.disposables.disposeAsync();

    return this.closing;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

export function openCielData(options: CielDataOptions): Promise<CielData> {
  return CielData.open(options);
}
