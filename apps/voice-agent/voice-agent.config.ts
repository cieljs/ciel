import { defaultVoiceAgentConfig, defineVoiceAgentConfig } from './src/config.ts';

export default defineVoiceAgentConfig({
  embedding: defaultVoiceAgentConfig.embedding,
  mcp: {
    enabled: true,
  },
  audio: {
    input: {
      sampleRate: 48_000,
      channels: 1,
      // device: 4,
    },
    output: {
      // device: 2,
    },
  },
  conversation: {
    spaceId: 'voice-chat',
    sessionId: 'local-group',
    sources: ['voice-chat:local-group'],
    minimumThinkIntervalMs: 200,
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
});
