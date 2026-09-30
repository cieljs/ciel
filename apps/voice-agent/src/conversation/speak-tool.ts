import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool } from 'cieljs/agent-kit';
import { Type } from 'typebox';

import type { AudioOutput, DeviceSelector } from '../audio/types.ts';
import type { SpeechAudio, SpeechAudioFormat, TextToSpeech } from '../tts/types.ts';
import type { VoiceAgentEvent } from './scheduler.ts';

export type SpeakResult =
  | { status: 'delivered'; startedAt: string; endedAt: string }
  | { status: 'superseded'; reason: 'new_speech' };

export interface ThinkRunGate {
  readonly revision: number;
  readonly signal: AbortSignal;

  markSpoke(): boolean;
  recordDelivered(): void;
}

interface ActiveRun {
  controller: AbortController;
  spoke: boolean;
  delivered: boolean;
}

export class SpeakController {
  private revision = 0;
  private active?: { gate: ThinkRunGate; state: ActiveRun };

  beginRun(): ThinkRunGate {
    const controller = new AbortController();
    const revision = this.revision;
    const state: ActiveRun = { controller, spoke: false, delivered: false };

    const gate: ThinkRunGate = {
      revision,
      signal: controller.signal,
      markSpoke() {
        if (state.spoke) {
          return false;
        }

        state.spoke = true;

        return true;
      },
      recordDelivered() {
        state.delivered = true;
      },
    };

    this.active = { gate, state };

    return gate;
  }

  noteSpeech(): void {
    this.revision += 1;
    this.active?.state.controller.abort();
  }

  endRun(): { spoke: boolean; delivered: boolean } {
    const state = this.active?.state;

    this.active = undefined;

    return { spoke: state?.spoke ?? false, delivered: state?.delivered ?? false };
  }

  currentGate(): ThinkRunGate | undefined {
    return this.active?.gate;
  }

  currentRevision(): number {
    return this.revision;
  }
}

export interface SpeakToolOptions {
  controller: SpeakController;
  tts: TextToSpeech;
  output: AudioOutput;
  voice: string;
  format: SpeechAudioFormat;
  instructions?: string;
  outputDevice?: DeviceSelector;
  emit: (event: VoiceAgentEvent) => void;
  onDelivered?: (delivery: { text: string; startedAt: Date; endedAt: Date }) => void;
  onAecReference?: (pcm: Buffer) => void;
}

const speechInstructionsSchema = Type.String({
  maxLength: 1_000,
  description: '这一句话的语气、情绪或节奏；缺省时使用全局 TTS 配置。',
});

export const createSpeakTool = defineTool(
  Type.Object({
    text: Type.String({
      minLength: 1,
      maxLength: 4_000,
      description: '要朗读的最终口语文本，不含 Markdown、列表、网址或舞台说明。',
    }),
    instructions: Type.Optional(speechInstructionsSchema),
  }),
  (options: SpeakToolOptions) => ({
    name: 'speak',
    label: '发言',
    description:
      '把 text 合成语音并通过扬声器播放。一轮思考最多调用一次；思考期间出现新语音时会返回 superseded，表示这句话没有被播放。',
    execute: (params, { signal }) => executeSpeak(params, options, signal),
  }),
);

async function executeSpeak(
  params: { text: string; instructions?: string },
  options: SpeakToolOptions,
  agentSignal?: AbortSignal,
): Promise<AgentToolResult<SpeakResult>> {
  const gate = options.controller.currentGate();

  if (!gate) {
    throw new Error('speak 只能在一次思考运行期间调用');
  }

  if (!gate.markSpoke()) {
    throw new Error('本轮已经调用过 speak，同一轮只能发言一次');
  }

  const text = params.text.trim();

  if (!text) {
    throw new Error('text 不能为空');
  }

  if (options.controller.currentRevision() !== gate.revision) {
    return speakResult({ status: 'superseded', reason: 'new_speech' });
  }

  const signal = agentSignal ? AbortSignal.any([gate.signal, agentSignal]) : gate.signal;

  options.emit({ type: 'tts_started', text, characterCount: text.length });
  const ttsStartedAt = Date.now();

  let audio: SpeechAudio;

  try {
    audio = await options.tts.synthesize({
      text,
      voice: options.voice,
      instructions: params.instructions ?? options.instructions,
      format: options.format,
      signal,
    });
  } catch (error) {
    if (gate.signal.aborted) {
      return speakResult({ status: 'superseded', reason: 'new_speech' });
    }

    throw error;
  }

  options.emit({ type: 'tts_finished', durationMs: Date.now() - ttsStartedAt });

  if (options.controller.currentRevision() !== gate.revision) {
    return speakResult({ status: 'superseded', reason: 'new_speech' });
  }

  const startedAt = new Date();

  options.emit({ type: 'playback_started', device: options.outputDevice });

  await options.output.play(audio, {
    device: options.outputDevice,
    onAecReference: options.onAecReference,
  });

  const endedAt = new Date();

  options.emit({ type: 'playback_finished', durationMs: endedAt.getTime() - startedAt.getTime() });

  gate.recordDelivered();

  options.onDelivered?.({ text, startedAt, endedAt });

  return speakResult({
    status: 'delivered',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
  });
}

function speakResult(result: SpeakResult): AgentToolResult<SpeakResult> {
  const message =
    result.status === 'delivered'
      ? '这句话已经通过扬声器播放。'
      : '这句话没有播放：思考期间出现了新语音，已由下一轮重新判断。';

  return {
    content: [{ type: 'text', text: `${message}\n${JSON.stringify(result)}` }],
    details: result,
  };
}
