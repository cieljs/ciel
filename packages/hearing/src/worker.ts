import { createInterface } from 'node:readline';

import { NativeASR } from './asr.ts';
import { NativeKWS } from './kws.ts';
import type { ASRWorkerCommand, ASRWorkerEvent } from './process-protocol.ts';
let stream: NativeASR | NativeKWS | undefined;
let operationError: Error | undefined;
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  let command: ASRWorkerCommand;

  try {
    command = JSON.parse(line) as ASRWorkerCommand;
  } catch {
    continue;
  }

  operationError = undefined;

  try {
    if (command.type === 'init') {
      if (stream) {
        throw new Error('Worker already initialized');
      }

      if (command.kind === 'kws') {
        const kws = new NativeKWS(command.options);

        kws.on('wake', data => {
          void send({ type: 'wake', data: { ...data, at: data.at.toISOString() } });
        });

        stream = kws;
      } else {
        const asr = new NativeASR(command.options);

        asr.on('result', data => {
          void send({
            type: 'result',
            data: {
              ...data,
              startAt: data.startAt.toISOString(),
              endAt: data.endAt.toISOString(),
              tokens: data.tokens?.map(token => ({
                ...token,
                startAt: token.startAt.toISOString(),
                endAt: token.endAt.toISOString(),
              })),
            },
          });
        });

        asr.on('speechstart', at => {
          void send({ type: 'speechstart', at: at.toISOString() });
        });

        asr.on('speechend', at => {
          void send({ type: 'speechend', at: at.toISOString() });
        });

        stream = asr;
      }

      if (stream instanceof NativeASR) {
        stream.on('error', error => {
          operationError = error;
        });
      } else {
        stream.on('error', error => {
          operationError = error;
        });
      }
    } else {
      if (!stream) {
        throw new Error('Worker not initialized');
      }

      if (command.type === 'write') {
        stream.write({
          ...command,
          data: Buffer.from(command.data, 'base64'),
          startAt: new Date(command.startAt),
        });
      } else if (command.type === 'set-model') {
        setModel(stream, command.model);
      } else if (command.type === 'flush') {
        stream.flush();
      } else {
        await stream.close();
      }
    }

    if (operationError) {
      throw operationError;
    }

    await send({ type: 'ack', id: command.id });
  } catch (error) {
    await send({
      type: 'ack',
      id: command.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (command.type === 'close') {
    input.close();
    break;
  }
}

await stream?.close();

function setModel(
  currentStream: NativeASR | NativeKWS,
  model: Extract<ASRWorkerCommand, { type: 'set-model' }>['model'],
): void {
  if (!(currentStream instanceof NativeASR)) {
    throw new Error('Only ASR supports model switching');
  }

  currentStream.setModel(model);
}

function send(event: ASRWorkerEvent): Promise<void> {
  return new Promise((resolve, reject) =>
    process.stdout.write(`${JSON.stringify(event)}\n`, error =>
      error ? reject(error) : resolve(),
    ),
  );
}
