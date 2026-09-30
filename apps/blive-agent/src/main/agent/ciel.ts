import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { Ciel, type CielData } from 'cieljs';
import type { McpTools } from 'cieljs/mcp';

import type { WatchMode } from '../../shared/types.ts';
import { createSystemPrompt } from '../prompts/index.ts';

const EXPLORATION_SYSTEM_PROMPT = `你负责从宿主提供的真实 Bilibili 直播间候选中选择一个房间。可通过只读工具检索其他房间的 Session 与 Memory，结合来源判断；不编造候选，最终只返回指定 JSON。离开一个房间后的 30 分钟内不要重进同一个房间，也不要因为某个房间的资料最多就优先选它——重复观看同一个房间等于没有换直播间；宿主标注为「冷却中的房间」的候选，只有确实没有更合适的选择时才考虑。`;

/** 共享数据库由宿主维护；工具闭包由宿主维护当前房间和发送权限。 */
export function createWatchCiel(options: {
  data: CielData;
  model: Model<Api>;
  apiKey?: string;
  mode: WatchMode;
  mcp?: McpTools;
  biliTools?: AgentTool[];
  danmakuTool?: AgentTool;
  streamerTools?: AgentTool[];
}) {
  return new Ciel({
    model: options.model,
    apiKey: options.apiKey,
    systemPrompt: createSystemPrompt(options.mode),
    tools: [
      ...(options.danmakuTool ? [options.danmakuTool] : []),
      ...(options.streamerTools ?? []),
      ...(options.biliTools ?? []),
    ],
    data: options.data,
    investigation: {
      systemPrompt: EXPLORATION_SYSTEM_PROMPT,
    },
    mcp: options.mcp,
  });
}
