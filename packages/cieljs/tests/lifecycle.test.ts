import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Runtime } from '@cieljs/runtime';
import { registerFauxProvider } from '@earendil-works/pi-ai/compat';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { Ciel, openCielData, type CielData } from '../src/index.ts';

const dataInstances: CielData[] = [];

afterEach(async () => {
  vi.restoreAllMocks();

  for (const data of dataInstances.splice(0)) {
    await data.close();
  }
});

test('关闭 Ciel 后复用同一个数据层启动新实例', async () => {
  const data = await openCielData({ dataDir: 'memory://', timeZone: 'Asia/Shanghai' });
  dataInstances.push(data);

  const faux = registerFauxProvider();

  try {
    const first = new Ciel({ data, model: faux.getModel(), systemPrompt: 'first' });
    await first.start();
    await first.close();

    expect(data.isClosed).toBe(false);
    expect(data.sessions.space('room')).toBeDefined();

    const second = new Ciel({ data, model: faux.getModel(), systemPrompt: 'second' });
    await second.start();
    expect(second.status).toBe('running');
    await second.close();
  } finally {
    faux.unregister();
  }
});

test('运行层启动失败后数据层仍可复用', async () => {
  const data = await openCielData({ dataDir: 'memory://', timeZone: 'Asia/Shanghai' });
  dataInstances.push(data);

  const faux = registerFauxProvider();
  const failure = new Error('runtime start');
  const start = vi.spyOn(Runtime.prototype, 'start').mockRejectedValueOnce(failure);

  try {
    const ciel = new Ciel({ data, model: faux.getModel(), systemPrompt: 'test' });

    await expect(ciel.start()).rejects.toBe(failure);
    expect(ciel.status).toBe('idle');
    expect(data.isClosed).toBe(false);

    start.mockRestore();
    await ciel.start();
    await ciel.close();
  } finally {
    faux.unregister();
  }
});

test('数据层关闭后拒绝启动新 Ciel', async () => {
  const data = await openCielData({ dataDir: 'memory://', timeZone: 'Asia/Shanghai' });
  dataInstances.push(data);
  await data.close();

  const faux = registerFauxProvider();

  try {
    const ciel = new Ciel({ data, model: faux.getModel(), systemPrompt: 'test' });
    await expect(ciel.start()).rejects.toThrow('CielData 已关闭');
    await ciel.close();
  } finally {
    faux.unregister();
  }
});

test('数据层初始化失败后释放数据库，允许从同一目录重新打开', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'ciel-data-rollback-'));

  try {
    await expect(openCielData({ dataDir, timeZone: 'Invalid/Zone' })).rejects.toThrow('timeZone');

    const data = await openCielData({ dataDir, timeZone: 'Asia/Shanghai' });
    dataInstances.push(data);

    expect(data.sessions.space('room')).toBeDefined();
    await data.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
