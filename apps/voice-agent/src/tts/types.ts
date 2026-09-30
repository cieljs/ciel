export type SpeechAudioFormat = 'wav' | 'pcm_s16le';

export interface SpeechSynthesisRequest {
  text: string;
  voice: string;
  instructions?: string;
  format: SpeechAudioFormat;
  signal?: AbortSignal;
}

export interface SpeechAudio {
  data: Buffer;
  format: SpeechAudioFormat;
  mimeType: string;
  sampleRate?: number;
  channels?: number;
  durationMs?: number;
}

export interface TextToSpeech {
  readonly id: string;

  synthesize(request: SpeechSynthesisRequest): Promise<SpeechAudio>;
  close(): Promise<void>;
}
