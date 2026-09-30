import type { WebContents } from 'electron';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vite-plus/test';

import { executePage, isAllowedPageUrl } from './page-executor.ts';

describe('executePage', () => {
  it('包装异步 IIFE 并校验结果', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({ title: '直播' });

    const contents = {
      executeJavaScript,
      getURL: () => 'https://live.bilibili.com/1',
      isDestroyed: () => false,
    } as unknown as WebContents;

    const resultSchema = Type.Object({ title: Type.String() });

    await expect(
      executePage(contents, '({ title: document.title })', resultSchema),
    ).resolves.toEqual({ title: '直播' });

    expect(executeJavaScript).toHaveBeenCalledWith(
      '(async () => await (({ title: document.title })))()',
    );
  });

  it('拒绝旧 generation 的结果', async () => {
    const contents = {
      executeJavaScript: vi.fn().mockResolvedValue('ok'),
      getURL: () => 'https://live.bilibili.com/1',
      isDestroyed: () => false,
    } as unknown as WebContents;

    await expect(
      executePage(contents, '"ok"', Type.String(), {
        generation: 1,
        currentGeneration: () => 2,
      }),
    ).rejects.toThrow('页面已切换');
  });
});

describe('isAllowedPageUrl', () => {
  it('只允许 Bilibili HTTPS 页面和 about:blank', () => {
    expect(isAllowedPageUrl('about:blank')).toBe(true);
    expect(isAllowedPageUrl('https://live.bilibili.com/1')).toBe(true);
    expect(isAllowedPageUrl('http://live.bilibili.com/1')).toBe(false);
    expect(isAllowedPageUrl('https://bilibili.com.example.com/1')).toBe(false);
  });
});
