import type { AgentEvent } from '@earendil-works/pi-agent-core';

import type { TraceEntry, TraceEvent, ValueRef } from '../protocol/index.ts';
import { messageContent } from './trace-content.ts';

export type { RuntimeMetadata as AgentTraceMetadata } from '@cieljs/agent-kit/protocol';
import type { RuntimeMetadata as AgentTraceMetadata } from '@cieljs/agent-kit/protocol';

interface TraceRecorder {
  createEntry: (sessionId: string, kind: TraceEntry['kind'], name: string) => TraceEntry;
  saveEntry: (entry: TraceEntry) => void;
  storeValue: (id: string, value: unknown) => ValueRef;
}

type MessageEvent = Extract<
  AgentEvent,
  { type: 'message_start' | 'message_update' | 'message_end' }
>;
type ToolUpdateEvent = Extract<
  AgentEvent,
  { type: 'tool_execution_update' | 'tool_execution_end' }
>;

/** 每个观察对象独享关联状态，交错到达的不同 Agent 事件不会串到同一轮运行。 */
export class AgentTrace {
  private run?: TraceEntry;
  private turn?: TraceEntry;
  private message?: TraceEntry;
  private readonly tools = new Map<string, TraceEntry>();
  private readonly callMessages = new Map<string, string>();

  constructor(
    private readonly sessionId: string,
    private readonly recorder: TraceRecorder,
  ) {}

  receive(trace: TraceEvent): TraceEvent {
    if (trace.event.type === 'agent_start') {
      this.run = undefined;
      this.turn = undefined;
      this.message = undefined;
      this.tools.clear();
      this.callMessages.clear();
    }

    this.handleEvent(trace, trace.metadata);

    if (trace.event.type === 'message_end') {
      this.message = undefined;
    }

    return trace;
  }

  private handleEvent(trace: TraceEvent, metadata: AgentTraceMetadata) {
    const event = trace.event;

    switch (event.type) {
      case 'session_compaction': {
        return;
      }

      case 'agent_start':

      case 'turn_start': {
        this.startLifecycle(trace, metadata);

        return;
      }

      case 'agent_end':

      case 'turn_end': {
        this.endLifecycle(trace, metadata);

        return;
      }

      case 'message_start':
      case 'message_update':

      case 'message_end': {
        this.updateMessage(event, trace, metadata);

        return;
      }

      case 'tool_execution_start': {
        this.startTool(event, trace, metadata);

        return;
      }

      case 'tool_execution_update':

      case 'tool_execution_end': {
        this.updateTool(event, trace, metadata);
      }
    }
  }

  private startLifecycle(trace: TraceEvent, metadata: AgentTraceMetadata) {
    const entry = this.recorder.createEntry(this.sessionId, 'event', trace.event.type);

    if (trace.event.type === 'agent_start') {
      this.run = entry;
    } else {
      this.turn = entry;
    }

    this.saveEntry(entry, trace, metadata);
  }

  private endLifecycle(trace: TraceEvent, metadata: AgentTraceMetadata) {
    let entry = this.turn;

    if (trace.event.type === 'agent_end') {
      entry = this.run;
    }

    // 中途挂接观察器时可能缺少 start，仍保留结束事件与完整输出。
    entry ??= this.recorder.createEntry(this.sessionId, 'event', trace.event.type);
    entry.status = 'completed';
    entry.endedAt = trace.timestamp;
    entry.output = this.recorder.storeValue(`${entry.id}:output`, trace.event);
    this.saveEntry(entry, trace, metadata);
  }

  // oxlint-disable-next-line eslint/complexity -- 消息生命周期投影按角色和阶段补齐关联字段。
  private updateMessage(event: MessageEvent, trace: TraceEvent, metadata: AgentTraceMetadata) {
    if (event.type === 'message_start' || !this.message) {
      this.message = this.recorder.createEntry(this.sessionId, 'message', event.message.role);
      this.message.id = trace.messageId!;
    }

    const entry = this.message;
    entry.messageId = entry.id;

    if (event.message.role === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'toolCall') {
          this.callMessages.set(block.id, entry.id);
        }
      }
    }

    if (event.message.role === 'toolResult') {
      entry.toolCallId = event.message.toolCallId;
    }

    const content = messageContent(event.message);
    entry.text = content.text;
    entry.thinking = content.thinking;
    entry.output = this.recorder.storeValue(`${entry.id}:output`, event.message);

    if (event.type === 'message_end') {
      const failed =
        (event.message.role === 'assistant' && event.message.stopReason === 'error') ||
        (event.message.role === 'toolResult' && event.message.isError);

      entry.status = failed ? 'error' : 'completed';

      if (failed) {
        entry.error = entry.output;
      }

      entry.endedAt = trace.timestamp;
    }

    this.saveEntry(entry, trace, metadata);
  }

  private startTool(
    event: Extract<AgentEvent, { type: 'tool_execution_start' }>,
    trace: TraceEvent,
    metadata: AgentTraceMetadata,
  ) {
    const entry = this.recorder.createEntry(this.sessionId, 'tool', event.toolName);
    const tool = metadata.tools?.find(tool => tool.name === event.toolName);

    entry.toolCallId = event.toolCallId;
    entry.messageId = this.callMessages.get(event.toolCallId);
    entry.label = tool?.label;
    entry.description = tool?.description;
    entry.input = this.recorder.storeValue(`${entry.id}:input`, event.args);

    this.tools.set(event.toolCallId, entry);
    this.saveEntry(entry, trace, metadata);
  }

  private updateTool(event: ToolUpdateEvent, trace: TraceEvent, metadata: AgentTraceMetadata) {
    const entry = this.tools.get(event.toolCallId);

    // 缺失 start 时无法构造完整工具摘要，但 receive 仍返回原始事件供宿主持久化。
    if (!entry) {
      return;
    }

    if (event.type === 'tool_execution_end') {
      entry.output = this.recorder.storeValue(`${entry.id}:output`, event.result);
      entry.status = event.isError ? 'error' : 'completed';

      if (event.isError) {
        entry.error = entry.output;
      }

      entry.endedAt = trace.timestamp;
      this.tools.delete(event.toolCallId);
    } else {
      entry.output = this.recorder.storeValue(`${entry.id}:output`, event.partialResult);
    }

    this.saveEntry(entry, trace, metadata);
  }

  private saveEntry(entry: TraceEntry, trace: TraceEvent, metadata: AgentTraceMetadata) {
    entry.runId = trace.runId;
    entry.turnId = trace.turnId;
    entry.parentRunId = trace.parentRunId;
    entry.revision = trace.sequence;
    entry.raw = { id: trace.id, preview: trace.event.type };

    if (metadata.model) {
      const { id, name, provider } = metadata.model;
      entry.model = { id, name, provider };
    }

    this.recorder.saveEntry(entry);
  }
}
