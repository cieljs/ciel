import type { SpeechAudio } from '../tts/types.ts';

export interface AudioDevice {
  index: number;
  id: string;
  name: string;
  defaultSampleRate: number;
  isDefault: boolean;
}

export interface AudioInputDevice extends AudioDevice {
  maxInputChannels: number;
}

export interface AudioOutputDevice extends AudioDevice {
  maxOutputChannels: number;
}

export type DeviceSelector = number | string | { id: string };

export interface AudioInputChunk {
  data: Buffer;
  capturedAt: Date;
  sampleRate: number;
  channels: number;
  format: 's16le' | 'f32le';
}

export interface AudioInput {
  devices(): Promise<readonly AudioInputDevice[]>;
  start(options: { device?: DeviceSelector; signal?: AbortSignal }): AsyncIterable<AudioInputChunk>;
  pushAecReference(data: Buffer): void;
  close(): Promise<void>;
}

export interface AudioOutput {
  devices(): Promise<readonly AudioOutputDevice[]>;
  play(
    audio: SpeechAudio,
    options: {
      device?: DeviceSelector;
      signal?: AbortSignal;
      onAecReference?: (pcm: Buffer) => void;
    },
  ): Promise<void>;
  stop(): Promise<void>;
  close(): Promise<void>;
}

export function resolveDevice<T extends AudioDevice>(
  devices: readonly T[],
  selector: DeviceSelector,
): T | undefined {
  if (typeof selector === 'number') {
    return devices.find(device => device.index === selector);
  }

  if (typeof selector === 'string') {
    const query = selector.toLowerCase();

    return devices.find(device => device.name.toLowerCase().includes(query));
  }

  return devices.find(device => device.id === selector.id);
}
