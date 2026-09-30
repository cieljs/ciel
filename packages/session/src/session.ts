import type { RuntimeEvent, RuntimeMetadata } from '@cieljs/agent-kit/protocol';
import type { Storage } from '@cieljs/storage';
import type { VectorIndex } from '@cieljs/vector';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { findCompactionBoundary } from './compaction.ts';
import { SessionNotFoundError } from './errors.ts';
import type { SessionRepository } from './repository.ts';
import type { SessionRetrieval } from './retrieval.ts';
import { estimateContextTokens } from './tokens.ts';
import type {
  CompactionOptions,
  SessionInfo,
  SessionMessageListOptions,
  SessionSearchOptions,
  UpdateSessionInput,
} from './types.ts';

export interface SessionServices {
  namespace: string;
  storage: Storage;
  repository: SessionRepository;
  retrieval: SessionRetrieval;
  embeddingIndex: VectorIndex;
  compactions: Map<string, Promise<void>>;
  operate<T>(operation: () => Promise<T>): Promise<T>;
}

export class Session {
  constructor(
    private readonly services: SessionServices,
    readonly id: string,
    readonly spaceId: string,
  ) {}

  getInfo(): Promise<SessionInfo> {
    return this.services.operate(async () => {
      const info = await this.services.repository.getInfo(this.selector);

      if (!info) {
        throw new SessionNotFoundError();
      }

      return info;
    });
  }

  update(input: UpdateSessionInput): Promise<SessionInfo> {
    return this.services.operate(() => this.services.repository.update(this.selector, input));
  }

  delete(): Promise<void> {
    return this.services.operate(async () => {
      await this.services.embeddingIndex.flush();
      await this.services.repository.delete(this.selector);
    });
  }

  recordEvent(event: RuntimeEvent, metadata?: RuntimeMetadata) {
    return this.services.operate(async () => {
      const record = await this.services.storage.journal.record(
        this.id,
        event,
        metadata,
        async (transaction, record) => {
          if (record.event.type === 'message_end') {
            await this.services.repository.projectMessage(transaction, this.selector, record);
          }
        },
      );

      this.services.embeddingIndex.enqueue();

      return record;
    });
  }

  appendMessage(message: AgentMessage) {
    return this.services.operate(() =>
      this.services.repository.appendMessage(this.selector, message),
    );
  }

  getMessages(options: SessionMessageListOptions = {}) {
    return this.services.operate(() =>
      this.services.repository.getMessages(this.selector, options),
    );
  }

  getMessagesRange(fromSeq: number, toSeq: number) {
    return this.services.operate(() =>
      this.services.repository.getMessagesRange(this.selector, fromSeq, toSeq),
    );
  }

  getMessage(messageId: string) {
    return this.services.operate(() =>
      this.services.repository.getMessage(this.selector, messageId),
    );
  }

  getLatestCompaction() {
    return this.services.operate(() => this.services.repository.getLatestCompaction(this.selector));
  }

  context(): Promise<AgentMessage[]> {
    return this.services.operate(async () => {
      const compaction = await this.services.repository.getLatestCompaction(this.selector);

      const rows = await this.services.repository.getMessages(this.selector, {
        afterSeq: compaction?.throughSeq ?? 0,
      });

      const messages = rows.map(row => row.message);

      return compaction
        ? [createSummaryMessage(compaction.summary, compaction.createdAt.getTime()), ...messages]
        : messages;
    });
  }

  compact(options: CompactionOptions) {
    return this.services.operate(() => this.compactInternal(options));
  }

  search(query: string, options: SessionSearchOptions = {}) {
    return this.services.operate(() =>
      this.services.retrieval.search(this.selector, query, options),
    );
  }

  rebuildIndexes(): Promise<void> {
    return this.services.operate(async () => {
      await this.services.embeddingIndex.flush();
      await this.services.repository.rebuildChunks(this.selector);
      await this.services.embeddingIndex.flush();
    });
  }

  private get selector() {
    return { namespace: this.services.namespace, spaceId: this.spaceId, sessionId: this.id };
  }

  private async compactInternal(options: CompactionOptions) {
    const previous = this.services.compactions.get(this.id) ?? Promise.resolve();

    // oxlint-disable-next-line eslint/complexity -- 压缩操作在单一串行事务中处理阈值、边界、摘要与事实记录。
    const operation = previous.then(async () => {
      options.signal?.throwIfAborted();
      const latest = await this.services.repository.getLatestCompaction(this.selector);

      const rows = await this.services.repository.getMessages(this.selector, {
        afterSeq: latest?.throughSeq ?? 0,
      });

      const usageStartIndex = latest
        ? rows.findIndex(row => row.createdAt.getTime() > latest.createdAt.getTime())
        : 0;

      const boundary = findCompactionBoundary(
        { summary: latest?.summary ?? null, messages: rows.map(row => row.message) },
        options,
        usageStartIndex < 0 ? rows.length : usageStartIndex,
      );

      if (!boundary) {
        return null;
      }

      const summary = await options.summarize({
        sessionId: this.id,
        summary: latest?.summary ?? null,
        messages: rows.slice(0, boundary).map(row => row.message),
        signal: options.signal,
      });

      options.signal?.throwIfAborted();

      const compaction = await this.services.repository.appendCompaction(this.selector, {
        summary: summary.trim(),
        throughSeq: rows[boundary - 1]!.seq,
        expectedThroughSeq: latest?.throughSeq ?? 0,
      });

      // 压缩后的当前上下文 = 摘要 + 保留的原文。保留消息里的旧 usage 反映的是压缩前的
      // 大上下文，这里按纯文本估算，等下一次真实请求再覆盖。
      const retained = rows.slice(boundary);

      const contextTokens = estimateContextTokens(
        { summary: compaction.summary, messages: retained.map(row => row.message) },
        retained.length,
      ).tokens;

      // 压缩也要进事实流水，Trace 与其他消费者才能看到这一步并回放。
      await this.recordEvent({
        type: 'session_compaction',
        summary: compaction.summary,
        throughSeq: compaction.throughSeq,
        createdAt: compaction.createdAt.getTime(),
        contextTokens,
      });

      return compaction;
    });

    const settled = operation.then(
      () => {},
      () => {},
    );

    this.services.compactions.set(this.id, settled);

    try {
      return await operation;
    } finally {
      if (this.services.compactions.get(this.id) === settled) {
        this.services.compactions.delete(this.id);
      }
    }
  }
}

function createSummaryMessage(summary: string, timestamp: number): AgentMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: [
          '<session_summary>',
          '以下内容是此前会话历史的压缩摘要。',
          '它代表更早的对话历史，应作为已有上下文使用，而不是新的用户请求。',
          '',
          summary,
          '</session_summary>',
        ].join('\n'),
      },
    ],
    timestamp,
  };
}
