import path from 'node:path';

export const SAMPLE_RATE = 16_000;
export const VAD_WINDOW_SIZE = 256;
export const DEFAULT_BUFFER_SECONDS = 30;
export const DEFAULT_SPEAKER_THRESHOLD = 0.6;
export const DEFAULT_MAX_SPEAKERS = 8;

export const ASR_DIR = 'asr' as const;
export const VAD_DIR = 'vad' as const;
export const SPEAKER_DIR = 'speaker' as const;
export const TOKENIZER_DIR = 'tokenizer' as const;

export const ASR_MODEL_SUBDIR = 'qwen3-asr-1.7b-int8' as const;
export const ASR_CONV_FRONTEND = 'conv_frontend.onnx' as const;
export const ASR_ENCODER = 'encoder.int8.onnx' as const;
export const ASR_DECODER = 'decoder.int8.onnx' as const;
export const VAD_MODEL = 'ten-vad.int8.onnx' as const;
export const SPEAKER_MODEL = 'model.onnx' as const;

export const TOKENIZER_FILES = ['merges.txt', 'tokenizer_config.json', 'vocab.json'] as const;

export function resolveAsrPath(modelsPath: string): string {
  return path.join(modelsPath, ASR_DIR, ASR_MODEL_SUBDIR);
}

export function resolveVadPath(modelsPath: string): string {
  return path.join(modelsPath, VAD_DIR, VAD_MODEL);
}

export function resolveSpeakerPath(modelsPath: string): string {
  return path.join(modelsPath, SPEAKER_DIR, SPEAKER_MODEL);
}

export function resolveModelPaths(modelsPath: string) {
  return {
    asr: resolveAsrPath(modelsPath),
    vad: resolveVadPath(modelsPath),
    speaker: resolveSpeakerPath(modelsPath),
  } as const;
}
