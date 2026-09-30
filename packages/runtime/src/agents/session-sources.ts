import type { Session } from '@cieljs/session';

export function createSessionSourceSync(
  session: Session,
  initial: string[],
  resolve: () => string[],
  onUpdated?: (session: Awaited<ReturnType<Session['update']>>) => void,
) {
  let sourcesKey = JSON.stringify(initial);

  async function refreshSources(sources: string[]) {
    const nextKey = JSON.stringify(sources);

    if (nextKey === sourcesKey) {
      return;
    }

    // 写入成功后才推进缓存，失败时下一次调用仍会重试。
    const updated = await session.update({ sources });
    sourcesKey = nextKey;
    onUpdated?.(updated);
  }

  async function resolveAndRefreshSources(): Promise<undefined> {
    await refreshSources(resolve());
  }

  return { refreshSources, resolveAndRefreshSources };
}
