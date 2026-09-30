import type { RuntimeEvent } from '@cieljs/agent-kit/protocol';
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';

import type { TraceEntry, TraceEvent } from '../protocol/index.ts';
import { messageContent } from './trace-content.ts';

/** 每个原始事件对应一个不可变步骤，sequence 同时用于分页与客户端去重。 */
export function createTraceStep(
  trace: TraceEvent,
  tools?: Array<Omit<Agent['state']['tools'][number], 'execute'>>,
  model?: Agent['state']['model'],
): TraceEntry {
  const step: TraceEntry = {
    id: `step:${trace.sequence}`,
    sequence: trace.sequence,
    sessionId: trace.sessionId,
    runId: trace.runId,
    parentRunId: trace.parentRunId,
    turnId: trace.turnId,
    messageId: trace.messageId,
    toolCallId: trace.toolCallId,
    kind: eventKind(trace.event),
    name: trace.event.type,
    status: 'completed',
    startedAt: trace.timestamp,
    endedAt: trace.timestamp,
    raw: { id: trace.id, preview: trace.event.type },
    revision: trace.sequence,
  };

  if (trace.event.type.endsWith('_start') || trace.event.type.endsWith('_update')) {
    step.status = 'running';
    step.endedAt = undefined;
  }

  attachContentReferences(step, trace);

  // 压缩不是 Agent 事件，但同样需要一行可读的轨迹与摘要。
  if (trace.event.type === 'session_compaction') {
    step.label = '上下文压缩';
    step.text = trace.event.summary;
  }

  const errorPath = eventErrorPath(trace.event);

  if (errorPath) {
    step.status = 'error';
    step.error = { id: trace.id, path: ['event', ...errorPath], preview: '错误详情' };
  }

  attachDisplayMetadata(step, trace.event, tools, model);

  return step;
}

function eventErrorPath(event: RuntimeEvent): string[] | undefined {
  if (event.type === 'tool_execution_end' && event.isError) {
    return ['result'];
  }

  if ('message' in event && messageFailed(event.message)) {
    return ['message'];
  }

  if (event.type === 'turn_end' && event.toolResults.some(messageFailed)) {
    return ['toolResults'];
  }

  if (event.type === 'agent_end' && event.messages.some(messageFailed)) {
    return ['messages'];
  }
}

function messageFailed(message: Extract<AgentEvent, { type: 'message_end' }>['message']) {
  if (message.role === 'assistant') {
    return message.stopReason === 'error';
  }

  return message.role === 'toolResult' && message.isError;
}

function eventKind(event: RuntimeEvent): TraceEntry['kind'] {
  if (event.type.startsWith('tool_')) {
    return 'tool';
  }

  if (event.type.startsWith('message_')) {
    return 'message';
  }

  return 'event';
}

function attachContentReferences(step: TraceEntry, trace: TraceEvent) {
  // 引用指向事件快照中的字段，避免在步骤中再次复制图片和完整消息。
  const outputKey = ['message', 'result', 'partialResult', 'messages'].find(
    key => key in trace.event,
  );

  if (outputKey) {
    step.output = { id: trace.id, path: ['event', outputKey], preview: '完整内容' };
  }

  if ('args' in trace.event) {
    step.input = { id: trace.id, path: ['event', 'args'], preview: '参数' };
  }

  if ('message' in trace.event) {
    const content = messageContent(trace.event.message);
    step.text = content.text;
    step.thinking = content.thinking;
  }
}

// oxlint-disable-next-line eslint/complexity -- 展示元数据按不同运行时事件的可用字段渐进补齐。
function attachDisplayMetadata(
  step: TraceEntry,
  event: RuntimeEvent,
  tools?: Array<Omit<Agent['state']['tools'][number], 'execute'>>,
  model?: Agent['state']['model'],
) {
  if ('toolName' in event) {
    const toolIndex = tools?.findIndex(tool => tool.name === event.toolName) ?? -1;
    const tool = tools?.[toolIndex];
    step.label = tool?.label ?? event.toolName;
    step.description = tool?.description;

    if (toolIndex >= 0 && tool && 'parameters' in tool) {
      step.schema = {
        id: step.raw!.id,
        path: ['metadata', 'tools', String(toolIndex), 'parameters'],
        preview: '工具参数 Schema',
      };
    }
  }

  if ('message' in event) {
    step.label = event.message.role;

    if (event.message.role === 'assistant') {
      step.label = 'Ciel';
    }
  }

  if (model) {
    const { id, name, provider } = model;
    step.model = { id, name, provider };
  }
}
