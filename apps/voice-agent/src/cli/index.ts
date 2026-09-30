import config from '../../voice-agent.config.ts';
import { createAudioInput } from '../audio/input.ts';
import { createAudioOutput } from '../audio/output.ts';
import type { VoiceAgentEvent } from '../conversation/scheduler.ts';
import { resolveVoiceAgentModel } from '../index.ts';
import { createVoiceAgent } from '../runtime.ts';

async function main(): Promise<void> {
  loadLocalEnv();

  const args = process.argv.slice(2);

  switch (args[0]) {
    case 'list-devices':

    case 'devices': {
      await listDevices();

      return;
    }

    case 'start':

    case undefined: {
      await start();

      return;
    }

    case 'help':
    case '--help':

    case '-h': {
      printHelp();

      return;
    }

    default: {
      printHelp();
      process.exitCode = 2;
    }
  }
}

function loadLocalEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // 没有 .env 时忽略，依赖真实环境变量
  }
}

async function listDevices(): Promise<void> {
  const input = createAudioInput({
    sampleRate: config.audio.input.sampleRate,
    channels: config.audio.input.channels,
  });

  const output = createAudioOutput({ sampleRate: config.audio.input.sampleRate });

  const [inputs, outputs] = await Promise.all([input.devices(), output.devices()]);

  process.stdout.write('输入设备：\n');

  for (const device of inputs) {
    process.stdout.write(
      `  index=${device.index}  name="${device.name}"  maxInputChannels=${device.maxInputChannels}  rate=${device.defaultSampleRate}${device.isDefault ? '  (默认)' : ''}\n`,
    );

    process.stdout.write(`    id=${device.id}\n`);
  }

  process.stdout.write('输出设备：\n');

  for (const device of outputs) {
    process.stdout.write(
      `  index=${device.index}  name="${device.name}"  maxOutputChannels=${device.maxOutputChannels}  rate=${device.defaultSampleRate}${device.isDefault ? '  (默认)' : ''}\n`,
    );

    process.stdout.write(`    id=${device.id}\n`);
  }
}

async function start(): Promise<void> {
  const voiceAgent = createVoiceAgent({
    config,
    model: resolveVoiceAgentModel(),
  });

  voiceAgent.onEvent(event => logEvent(event));

  await voiceAgent.start();
  process.stdout.write('Voice Agent 已启动，Ctrl+C 退出。\n');

  let closing = false;

  const shutdown = async () => {
    if (closing) {
      return;
    }

    closing = true;
    await voiceAgent.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const hasColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const BLUE = '\u001b[34m';
const MAGENTA = '\u001b[35m';

function paint(text: string, color: string): string {
  return hasColor ? `${color}${text}${RESET}` : text;
}

function log(label: string, content: string): void {
  process.stdout.write(`${label} ${content}\n`);
}

function describeArgs(args: unknown): string {
  if (args === undefined || args === null) {
    return '';
  }

  try {
    const json = JSON.stringify(args);

    return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch {
    return '';
  }
}

// oxlint-disable-next-line eslint/complexity -- CLI 输出按事件联合类型穷举，分支之间没有共享业务逻辑。
function logEvent(event: VoiceAgentEvent): void {
  switch (event.type) {
    case 'speech_end': {
      if (event.content) {
        log(paint('识别', GREEN), `${event.speaker ?? '未知说话人'}：${event.content}`);
      }

      return;
    }

    case 'self_echo_ignored': {
      log(paint('忽略', DIM), '检测到自身回声，跳过');

      return;
    }

    case 'think_started': {
      log(paint('思考', BLUE), `处理 ${event.window.speechEndCount} 段语音`);

      return;
    }

    case 'think_finished': {
      log(
        paint('思考', DIM),
        event.spoke ? `决定发言（${event.durationMs}ms）` : `保持沉默（${event.durationMs}ms）`,
      );

      return;
    }

    case 'tool_call_started': {
      log(
        paint('工具', YELLOW),
        event.args === undefined ? event.name : `${event.name} ${describeArgs(event.args)}`,
      );

      return;
    }

    case 'tool_call_finished': {
      log(
        paint('工具', event.isError ? RED : DIM),
        event.isError ? `${event.name} 失败` : `${event.name} 完成`,
      );

      return;
    }

    case 'tts_started': {
      log(paint('朗读', MAGENTA), event.text);

      return;
    }

    case 'tts_finished': {
      log(paint('朗读', DIM), `合成完成（${event.durationMs}ms）`);

      return;
    }

    case 'playback_started': {
      log(paint('播放', MAGENTA), describeSelector(event.device));

      return;
    }

    case 'playback_finished': {
      log(paint('播放', DIM), `${event.durationMs}ms`);

      return;
    }

    case 'error': {
      process.stderr.write(`${paint('错误', RED)} [${event.stage}] ${event.error.message}\n`);

      return;
    }

    case 'pending_created':

    case 'pending_merged': {
      return;
    }
  }
}

function printHelp(): void {
  process.stdout.write(
    `${[
      '用法：',
      '  oxnode ./src/cli/index.ts list-devices   列出输入/输出设备与设备 ID',
      '  oxnode ./src/cli/index.ts start           启动 Voice Agent（读取 voice-agent.config.ts 与 XIAOMI_API_KEY）',
      '',
      '在 voice-agent.config.ts 中设置设备：省略 device 使用系统默认，或使用 index / 名称子串 / { id } 稳定 ID。',
    ].join('\n')}\n`,
  );
}

function describeSelector(selector: number | string | { id: string } | undefined): string {
  if (selector === undefined) {
    return '默认';
  }

  if (typeof selector === 'number') {
    return `index=${selector}`;
  }

  if (typeof selector === 'string') {
    return `"${selector}"`;
  }

  return `id=${selector.id}`;
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
