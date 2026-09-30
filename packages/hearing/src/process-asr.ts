import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import type { KWSOptions } from './kws.ts';
import type { ASRWorkerCommand, ASRWorkerEvent } from './process-protocol.ts';
import type { ASRModelId } from './registry.ts';
import type { ASREventMap, ASROptions, ASRSegment, Unsubscribe } from './types.ts';
type Command = ASRWorkerCommand extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never;
export class ProcessASR {
  private readonly emitter = new EventEmitter();
  private readonly process: ChildProcessWithoutNullStreams;
  private output = '';
  private diagnostics = '';
  private sequence = 0;
  private failure?: Error;
  private closing?: Promise<void>;
  private readonly pending = new Map<
    number,
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly ready: Promise<void>;
  private readonly exited: Promise<void>;
  constructor(
    options: ASROptions | KWSOptions,
    kind: 'asr' | 'kws' = 'asr',
    worker = new URL('./worker.mjs', import.meta.url),
  ) {
    this.process = spawn(
      process.env.CIEL_NODE_EXECUTABLE?.trim() || 'node',
      [fileURLToPath(worker)],
      { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );

    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', chunk => this.consume(String(chunk)));

    this.process.stderr.on('data', chunk => {
      this.diagnostics = (this.diagnostics + String(chunk)).slice(-4000);
    });

    this.process.stdin.on('error', error => this.fail(error));
    this.process.on('error', error => this.fail(error));

    this.exited = new Promise(resolve =>
      this.process.once('close', () => {
        if (!this.closing || this.pending.size) {
          this.fail(
            new Error(
              `Hearing worker exited before completing requests${
                this.diagnostics ? `: ${this.diagnostics}` : ''
              }`,
            ),
          );
        }

        resolve();
      }),
    );

    const init: Command =
      kind === 'kws'
        ? { type: 'init', kind, options: options as KWSOptions }
        : { type: 'init', kind, options: options as ASROptions };

    this.ready = this.request(init);
    void this.ready.catch(error => this.fail(error));
  }
  write(chunk: ASRSegment): Promise<void> {
    if (this.closing) {
      return Promise.reject(new Error('Hearing worker is closing'));
    }

    return this.request({
      ...chunk,
      type: 'write',
      data: chunk.data.toString('base64'),
      startAt: chunk.startAt.toISOString(),
    });
  }
  flush(): Promise<void> {
    return this.closing ?? this.request({ type: 'flush' });
  }
  setModel(model: ASRModelId): Promise<void> {
    if (this.closing) {
      return Promise.reject(new Error('Hearing worker is closing'));
    }

    return this.request({ type: 'set-model', model });
  }
  on<K extends keyof ASREventMap>(event: K, listener: ASREventMap[K]): Unsubscribe {
    this.emitter.on(event, listener);

    return () => this.emitter.off(event, listener);
  }
  close(): Promise<void> {
    this.closing ??= this.finish();

    return this.closing;
  }
  private async finish(): Promise<void> {
    try {
      await this.ready;
      await this.request({ type: 'close' });
    } finally {
      this.process.stdin.end();
      const timer = setTimeout(() => this.process.kill(), 5_000);

      try {
        await this.exited;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  private request(command: Command): Promise<void> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }

    if (this.pending.size >= 32 || this.process.stdin.writableLength > 8 * 1024 * 1024) {
      return Promise.reject(new Error('Hearing worker queue is full; await write()'));
    }

    const id = ++this.sequence;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('Hearing worker request timed out'));
        this.process.kill();
      }, 120_000);

      this.pending.set(id, { resolve, reject, timer });

      this.process.stdin.write(`${JSON.stringify({ ...command, id })}\n`, error => {
        if (error) {
          this.fail(error);
        }
      });
    });
  }
  private fail(error: Error): void {
    this.failure ??= error;

    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(this.failure);
    }

    this.pending.clear();

    if (this.emitter.listenerCount('error')) {
      this.emitter.emit('error', this.failure);
    }
  }
  private consume(chunk: string): void {
    this.output += chunk;
    let newline: number;

    while ((newline = this.output.indexOf('\n')) >= 0) {
      const line = this.output.slice(0, newline);
      this.output = this.output.slice(newline + 1);

      if (!line.trim()) {
        continue;
      }

      try {
        this.handle(JSON.parse(line) as ASRWorkerEvent);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  private handle(event: ASRWorkerEvent): void {
    if (event.type === 'ack') {
      const request = this.pending.get(event.id);

      if (!request) {
        return;
      }

      this.pending.delete(event.id);
      clearTimeout(request.timer);

      if (event.error) {
        request.reject(new Error(event.error));
      } else {
        request.resolve();
      }
    } else if (event.type === 'result') {
      this.emitter.emit('result', {
        ...event.data,
        startAt: new Date(event.data.startAt),
        endAt: new Date(event.data.endAt),
        tokens: event.data.tokens?.map(token => ({
          ...token,
          startAt: new Date(token.startAt),
          endAt: new Date(token.endAt),
        })),
      });
    } else if (event.type === 'wake') {
      this.emitter.emit('wake', { ...event.data, at: new Date(event.data.at) });
    } else {
      this.emitter.emit(event.type, new Date(event.at));
    }
  }
}
