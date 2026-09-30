import type { TraceSession } from '@cieljs/trace/protocol';

export function traceSessionLabel(session: TraceSession) {
  const time = new Date(session.startedAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const roomId = sourceValue(session.sources, 'bilibili:room:') ?? roomIdFromSessionId(session.id);
  const streamerName = decodeSource(sourceValue(session.sources, 'bilibili:streamer-name:'));
  const parts = [time];

  if (roomId) {
    parts.push(roomId);
  }

  if (streamerName) {
    parts.push(streamerName);
  }

  if (session.title) {
    parts.push(session.title);
  }

  return parts.join('·');
}

function sourceValue(sources: string[] | undefined, prefix: string) {
  return sources?.find(source => source.startsWith(prefix))?.slice(prefix.length);
}

function roomIdFromSessionId(sessionId: string) {
  return /^bilibili:room:(\d+)(?::|$)/u.exec(sessionId)?.[1];
}

function decodeSource(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
