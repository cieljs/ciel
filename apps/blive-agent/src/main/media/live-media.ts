import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

import type { KWS } from 'cieljs/hearing';
import type { Perception } from 'cieljs/perception';

import { browserUserAgent } from '../user-agent.ts';

export interface LiveMediaOptions {
  roomId: number;
  input: string;
  live: boolean;
  perception: Perception;
  kws?: Pick<KWS, 'write'>;
  ffmpegPath?: string;
  onError?: (error: Error) => void;
  onStopped?: (error?: Error) => void;
  onProgress?: (processedSeconds: number, totalSeconds?: number) => void;
}

export class LiveMedia {
  private child?: ChildProcess;
  private exited?: Promise<void>;
  private jpegBuffer = Buffer.alloc(0);
  private sampleCount = 0;
  private startedAt = 0;
  private imageCount = 0;
  private progressBuffer = '';
  private totalSeconds?: number;
  private readonly writes = new Set<Promise<void>>();

  constructor(private readonly options: LiveMediaOptions) {}

  get endAt() {
    const imageTime = Math.max(0, this.imageCount - 1) * (60_000 / 9);

    return new Date(this.startedAt + Math.max(this.sampleCount / 16, imageTime));
  }

  start(): void {
    if (this.child) {
      throw new Error('直播媒体已经启动');
    }

    const executable = this.options.ffmpegPath ?? (process.env.FFMPEG_PATH?.trim() || 'ffmpeg');

    const child = spawn(
      executable,
      ffmpegArguments(this.options.roomId, this.options.input, this.options.live),
      {
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    this.child = child;
    this.exited = new Promise(resolveExit => child.once('close', () => resolveExit()));
    this.startedAt = Date.now();
    this.sampleCount = 0;

    child.stdout?.on('data', (chunk: Buffer) => this.writeAudio(child, Buffer.from(chunk)));
    // 必须消费 stderr，否则 FFmpeg 错误输出积压会阻塞媒体进程。
    child.stderr?.on('data', (chunk: Buffer) => this.readProgress(String(chunk)));

    (child.stdio[3] as Readable | null)?.on('data', (chunk: Buffer) => {
      this.writeImages(child, Buffer.from(chunk));
    });

    let processError: Error | undefined;

    child.once('error', error => {
      processError = error;
    });

    child.once('close', (code, signal) => {
      // 主动关闭会先清空 child；仅自然结束或崩溃需要宿主做状态判断。
      if (this.child !== child) {
        return;
      }

      this.child = undefined;
      let error = processError;

      if (!error && code !== 0) {
        error = new Error(`FFmpeg 异常退出（code=${String(code)}, signal=${String(signal)}）`);
      }

      if (this.options.onStopped) {
        this.options.onStopped(error);
      } else if (error) {
        this.options.onError?.(error);
      }
    });
  }

  async close(): Promise<void> {
    const child = this.child;

    this.child = undefined;

    if (child && !child.killed) {
      child.kill('SIGTERM');
    }

    // kill 只发出信号；等进程退出后再允许下一房间创建媒体资源。
    await this.exited;
    await Promise.allSettled(this.writes);

    this.jpegBuffer = Buffer.alloc(0);
  }

  private writeAudio(child: ChildProcess, data: Buffer): void {
    if (this.child !== child) {
      return;
    }

    const startAt = new Date(this.startedAt + this.sampleCount / 16);

    this.sampleCount += Math.floor(data.byteLength / 2);
    const audio = child.stdout;

    if (audio && 'pause' in audio) {
      audio.pause();
    }

    // 同一份 PCM 持续送入 ASR 和独立 KWS，不启用 ASR 唤醒门控。
    const write = Promise.allSettled([
      this.options.perception.asr.write({ data, startAt }),
      this.options.kws?.write({ data, startAt }),
    ]).then(results => {
      const failures = results.filter(result => result.status === 'rejected');

      if (failures.length) {
        throw new AggregateError(
          failures.map(result => result.reason),
          '音频处理失败',
        );
      }
    });

    this.writes.add(write);

    void write
      .catch(error =>
        this.options.onError?.(error instanceof Error ? error : new Error(String(error))),
      )
      .finally(() => {
        this.writes.delete(write);

        if (this.child === child && audio && 'resume' in audio) {
          audio.resume();
        }
      });
  }

  private writeImages(child: ChildProcess, data: Buffer): void {
    if (this.child !== child) {
      return;
    }

    this.jpegBuffer = Buffer.concat([this.jpegBuffer, data]);

    while (true) {
      const start = this.jpegBuffer.indexOf(Buffer.from([0xff, 0xd8]));

      if (start < 0) {
        this.jpegBuffer = Buffer.alloc(0);

        return;
      }

      const end = this.jpegBuffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);

      if (end < 0) {
        this.jpegBuffer = this.jpegBuffer.subarray(start);

        return;
      }

      const image = this.jpegBuffer.subarray(start, end + 2);

      this.jpegBuffer = this.jpegBuffer.subarray(end + 2);

      // 加速解码时使用媒体时间，不能让所有帧挤在同一个墙上时间窗口。
      const at = this.options.live
        ? new Date()
        : new Date(this.startedAt + this.imageCount * (60_000 / 9));

      this.imageCount += 1;

      this.trackWrite(
        this.options.perception.image?.write({
          source: `bilibili:room:${this.options.roomId}`,
          data: image,
          at,
        }),
      );
    }
  }

  private trackWrite(write: Promise<void> | undefined): void {
    if (!write) {
      return;
    }

    const guarded = write.catch((error: unknown) => this.options.onError?.(toError(error)));

    this.writes.add(guarded);
    void guarded.finally(() => this.writes.delete(guarded));
  }

  private readProgress(chunk: string) {
    this.progressBuffer += chunk;
    const lines = this.progressBuffer.split(/\r?\n/u);
    this.progressBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const duration = line.match(/Duration: (\d+):(\d+):([\d.]+)/u);

      if (duration) {
        this.totalSeconds =
          Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      }

      if (line.startsWith('out_time_us=')) {
        const seconds = Number(line.slice('out_time_us='.length)) / 1_000_000;

        if (Number.isFinite(seconds)) {
          this.options.onProgress?.(Math.max(0, seconds), this.totalSeconds);
        }
      }
    }
  }
}

export function ffmpegArguments(roomId: number, input: string, live: boolean): string[] {
  const inputArguments = live
    ? [
        '-reconnect',
        '1',
        '-reconnect_at_eof',
        '1',
        '-reconnect_on_network_error',
        '1',
        '-reconnect_on_http_error',
        '4xx,5xx',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5',
        '-user_agent',
        browserUserAgent,
        '-referer',
        `https://live.bilibili.com/${roomId}`,
        '-headers',
        'Origin: https://live.bilibili.com\r\n',
      ]
    : [];

  return [
    '-hide_banner',
    '-loglevel',
    live ? 'error' : 'info',
    ...(!live ? ['-progress', 'pipe:2', '-nostats'] : []),
    ...inputArguments,
    '-i',
    input,
    '-map',
    '0:a:0?',
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    's16le',
    'pipe:1',
    '-map',
    '0:v:0?',
    '-an',
    '-vf',
    'fps=9/60,scale=1280:-2',
    '-q:v',
    '4',
    '-f',
    'image2pipe',
    '-vcodec',
    'mjpeg',
    'pipe:3',
  ];
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
