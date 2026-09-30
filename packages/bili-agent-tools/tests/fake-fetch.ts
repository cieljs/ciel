import type { AgentTool } from '@earendil-works/pi-agent-core';

const WBI_IMG_KEY = '7cd084941338484aae1ad9425b84077c';
const WBI_SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45';

/** nav 接口即使未登录也会返回 wbi_img，用于生成签名口令。 */
export function navResponse() {
  return {
    code: -101,
    message: '账号未登录',
    data: {
      wbi_img: {
        img_url: `https://i0.hdslb.com/bfs/wbi/${WBI_IMG_KEY}.png`,
        sub_url: `https://i0.hdslb.com/bfs/wbi/${WBI_SUB_KEY}.png`,
      },
    },
  };
}

export function createFakeFetch(handler: (url: URL) => unknown) {
  const calls: URL[] = [];

  const fetchImpl = async (input: string) => {
    const url = new URL(input);

    calls.push(url);

    return new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

export function getTool(tools: AgentTool[], name: string) {
  const tool = tools.find(candidate => candidate.name === name);

  if (!tool) {
    throw new Error(`没有名为 ${name} 的工具`);
  }

  return tool;
}
