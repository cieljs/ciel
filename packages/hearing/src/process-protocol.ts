import type { KWSOptions, WakeEvent } from './kws.ts';
import type { ASRModelId } from './registry.ts';
import type { ASROptions, ASRResult } from './types.ts';
export type ASRWorkerCommand = { id: number } & (
  | { type: 'init'; kind: 'asr'; options: ASROptions }
  | { type: 'init'; kind: 'kws'; options: KWSOptions }
  | {
      type: 'write';
      data: string;
      startAt: string;
      sampleRate?: number;
      channels?: number;
      format?: 's16le';
    }
  | { type: 'flush' | 'close' }
  | { type: 'set-model'; model: ASRModelId }
);
export type ASRWorkerEvent =
  | { type: 'ack'; id: number; error?: string }
  | {
      type: 'result';
      data: Omit<ASRResult, 'startAt' | 'endAt' | 'tokens'> & {
        startAt: string;
        endAt: string;
        tokens?: readonly { content: string; startAt: string; endAt: string }[];
      };
    }
  | { type: 'wake'; data: Omit<WakeEvent, 'at'> & { at: string } }
  | { type: 'speechstart' | 'speechend'; at: string };
