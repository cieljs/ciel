import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  acceptedFiles: [] as string[],
  averagedEmbeddings: [] as Float32Array[],
  readFiles: [] as string[],
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

vi.mock('sherpa-onnx-node', () => ({
  default: {
    SpeakerEmbeddingExtractor: class {
      readonly dim = 2;

      createStream() {
        return {
          acceptWaveform: (wave: { file: string }) => mocks.acceptedFiles.push(wave.file),
        };
      }

      isReady(): boolean {
        return true;
      }

      compute(): Float32Array {
        return Float32Array.of(1, 0);
      }
    },
    readWave: (file: string) => {
      mocks.readFiles.push(file);

      return {
        file,
        sampleRate: 16_000,
        samples: new Float32Array(48_000),
      };
    },
  },
}));

vi.mock('../src/models.ts', () => ({
  createAudioConfig: () => ({ speaker: {} }),
}));

vi.mock('../src/voiceprint.ts', () => ({
  averageEmbeddings: (embeddings: Float32Array[]) => {
    mocks.averagedEmbeddings = embeddings;

    return Float32Array.of(1, 0);
  },
  writeVoiceprint: () => '.ciel/voiceprints/alice.voiceprint',
}));

vi.mock('../src/cli/utils/index.ts', () => ({
  loading: () => () => undefined,
}));

const { createVoiceprint } = await import('../src/cli/voiceprint.ts');

describe('createVoiceprint', () => {
  beforeEach(() => {
    mocks.acceptedFiles = [];
    mocks.averagedEmbeddings = [];
    mocks.readFiles = [];
  });

  it('使用所有传入的 WAV 样本生成一个声纹', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await createVoiceprint([
        '--models-path',
        '/models',
        '--output',
        'alice.voiceprint',
        '1.wav',
        '2.wav',
        '3.wav',
      ]);
    } finally {
      write.mockRestore();
    }

    expect(mocks.readFiles).toEqual(['1.wav', '2.wav', '3.wav']);
    expect(mocks.acceptedFiles).toEqual(['1.wav', '2.wav', '3.wav']);
    expect(mocks.averagedEmbeddings).toHaveLength(3);
  });
});
