import { afterEach, expect, test, vi } from 'vite-plus/test';

import { Mcp } from '../src/mcp.ts';

const { clients, connect, listTools, close } = vi.hoisted(() => ({
  clients: [] as string[],
  connect: vi.fn(async () => {}),
  listTools: vi.fn(async () => ({ tools: [] })),
  close: vi.fn(async (_name: string) => {}),
}));

const options = { cwd: '.', configFile: 'mcp.json' };

vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    constructor(private readonly options: { name: string }) {
      clients.push(options.name);
    }
    connect = connect;
    listTools = listTools;
    close() {
      return close(this.options.name);
    }
  },
}));

vi.mock('@modelcontextprotocol/client/stdio', () => ({ StdioClientTransport: class {} }));

vi.mock('../src/config.ts', () => ({
  loadMcpConfig: async () => ({
    cwd: '.',
    config: {
      mcpServers: { first: { command: 'test' }, second: { command: 'test' } },
    },
  }),
}));

afterEach(() => {
  clients.length = 0;
  connect.mockReset();
  listTools.mockReset();
  listTools.mockResolvedValue({ tools: [] });
  close.mockReset();
});

test.each(['connect', 'listTools'])('%s 失败时回收尚未登记的客户端', async stage => {
  const failure = new Error(stage);
  const method = stage === 'connect' ? connect : listTools;
  method.mockRejectedValueOnce(failure);
  await expect(Mcp.open(options)).rejects.toBe(failure);
  expect(close).toHaveBeenCalledExactlyOnceWith('ciel:first');
});

test('逆序关闭且失败不阻断其他客户端，重复调用共享 Promise', async () => {
  const mcp = await Mcp.open(options);
  expect(close).not.toHaveBeenCalled();
  const failure = new Error('close');
  close.mockRejectedValueOnce(failure);
  const closing = mcp.close();
  expect(mcp.close()).toBe(closing);
  expect(mcp[Symbol.asyncDispose]()).toBe(closing);
  await expect(closing).rejects.toBe(failure);
  expect(close.mock.calls).toEqual([['ciel:second'], ['ciel:first']]);
  expect(mcp.serverNames).toEqual([]);
});

test('第二个服务启动失败时回收全部客户端，并保留清理错误', async () => {
  const openingError = new Error('list tools');
  const closingError = new Error('close');
  listTools.mockResolvedValueOnce({ tools: [] }).mockRejectedValueOnce(openingError);
  close.mockRejectedValueOnce(closingError);

  await expect(Mcp.open(options)).rejects.toMatchObject({
    name: 'SuppressedError',
    error: closingError,
    suppressed: openingError,
  });

  expect(close.mock.calls).toEqual([['ciel:second'], ['ciel:first']]);
});

test('重复关闭会等待正在进行的客户端清理', async () => {
  const mcp = await Mcp.open(options);

  let release = () => {};

  const pending = new Promise<void>(resolve => {
    release = resolve;
  });

  close.mockReturnValueOnce(pending);
  const closing = mcp.close();
  expect(mcp.close()).toBe(closing);
  expect(close.mock.calls).toEqual([['ciel:second']]);
  release();
  await closing;
  expect(close.mock.calls).toEqual([['ciel:second'], ['ciel:first']]);
});
