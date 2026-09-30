import { homedir } from 'node:os';
import { join } from 'node:path';

import type { QwenEmbeddingOptions } from 'cieljs/embed';
import type { SpeakerProfile } from 'cieljs/perception';

import type { DeviceSelector } from './audio/types.ts';

export interface VoiceAgentAudioInputConfig {
  device?: DeviceSelector;
  sampleRate: number;
  channels: number;
}

export interface VoiceAgentAudioOutputConfig {
  device?: DeviceSelector;
}

export interface VoiceAgentConversationConfig {
  spaceId: string;
  sessionId: string;
  sources: string[];
  minimumThinkIntervalMs: number;
}

export interface VoiceAgentPerceptionConfig {
  asr: {
    speaker: SpeakerProfile[];
    speakerThreshold: number;
    maxSpeakers: number;
  };
  retentionMs: number;
}

export interface VoiceAgentTtsConfig {
  provider: 'xiaomi';
  model: 'mimo-v2.5-tts';
  voice: string;
  format: 'wav';
  instructions: string;
}

export interface VoiceAgentConfig {
  embedding?: QwenEmbeddingOptions;
  mcp: {
    enabled: boolean;
    required?: boolean;
  };
  audio: {
    input: VoiceAgentAudioInputConfig;
    output: VoiceAgentAudioOutputConfig;
  };
  conversation: VoiceAgentConversationConfig;
  perception: VoiceAgentPerceptionConfig;
  tts: VoiceAgentTtsConfig;
}

export const defaultVoiceAgentConfig: VoiceAgentConfig = {
  embedding: {
    cacheDir: join(homedir(), '.ciel', 'cache', 'embedding'),
  },
  mcp: {
    enabled: true,
  },
  audio: {
    input: {
      sampleRate: 48_000,
      channels: 1,
    },
    output: {},
  },
  conversation: {
    spaceId: 'voice-chat',
    sessionId: 'local-group',
    sources: ['voice-chat:local-group'],
    minimumThinkIntervalMs: 2_000,
  },
  perception: {
    asr: {
      speaker: [],
      speakerThreshold: 0.6,
      maxSpeakers: 8,
    },
    retentionMs: 60_000,
  },
  tts: {
    provider: 'xiaomi',
    model: 'mimo-v2.5-tts',
    voice: '冰糖',
    format: 'wav',
    instructions: '自然、轻松，像正在和熟人聊天；语速适中。',
  },
};

export function defineVoiceAgentConfig(config: VoiceAgentConfig): VoiceAgentConfig {
  validateVoiceAgentConfig(config);

  return config;
}

function validateVoiceAgentConfig(config: VoiceAgentConfig) {
  if (config.embedding?.cacheDir !== undefined) {
    assertNonEmpty(config.embedding.cacheDir, 'embedding.cacheDir');
  }

  if (typeof config.mcp.enabled !== 'boolean') {
    throw new Error('mcp.enabled 必须是 boolean');
  }

  assertFiniteInteger(
    config.conversation.minimumThinkIntervalMs,
    'conversation.minimumThinkIntervalMs',
    0,
  );

  assertPositiveFinite(config.audio.input.sampleRate, 'audio.input.sampleRate');
  assertPositiveInteger(config.audio.input.channels, 'audio.input.channels');

  assertDeviceSelector(config.audio.input.device, 'audio.input.device');
  assertDeviceSelector(config.audio.output.device, 'audio.output.device');

  assertNonEmpty(config.conversation.spaceId, 'conversation.spaceId');
  assertNonEmpty(config.conversation.sessionId, 'conversation.sessionId');

  for (const [index, source] of config.conversation.sources.entries()) {
    assertNonEmpty(source, `conversation.sources[${index}]`);
  }

  for (const [index, profile] of config.perception.asr.speaker.entries()) {
    assertNonEmpty(profile.name, `perception.asr.speaker[${index}].name`);
    assertNonEmpty(profile.file, `perception.asr.speaker[${index}].file`);
  }

  const speakerThreshold = config.perception.asr.speakerThreshold;

  if (!Number.isFinite(speakerThreshold) || speakerThreshold <= 0 || speakerThreshold > 1) {
    throw new Error('perception.asr.speakerThreshold 必须是大于 0 且不超过 1 的有限数字');
  }

  assertPositiveInteger(config.perception.asr.maxSpeakers, 'perception.asr.maxSpeakers');
  assertPositiveFinite(config.perception.retentionMs, 'perception.retentionMs');

  assertNonEmpty(config.tts.voice, 'tts.voice');
  assertNonEmpty(config.tts.instructions, 'tts.instructions');
}

function assertFiniteInteger(value: number, name: string, minimum?: number) {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} 必须是有限整数`);
  }

  if (minimum !== undefined && value < minimum) {
    throw new Error(`${name} 必须大于等于 ${minimum}`);
  }
}

function assertPositiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} 必须是正整数`);
  }
}

function assertPositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} 必须是大于 0 的有限数字`);
  }
}

function assertNonEmpty(value: string, name: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} 不能为空`);
  }
}

function assertDeviceSelector(selector: DeviceSelector | undefined, name: string) {
  if (selector === undefined) {
    return;
  }

  if (typeof selector === 'number') {
    if (!Number.isInteger(selector) || selector < 0) {
      throw new Error(`${name} 必须是大于等于 0 的整数设备索引`);
    }

    return;
  }

  if (typeof selector === 'string') {
    assertNonEmpty(selector, name);

    return;
  }

  assertNonEmpty(selector.id, `${name}.id`);
}
