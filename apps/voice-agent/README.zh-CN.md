<h1 align="center">@cieljs/voice-agent</h1>

<p align="center">多人语音聊天参与者：持续感知、择机思考、通过 TTS 发言并播放的纯 Node.js 应用。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概览">概览</a> ·
  <a href="#边界与非目标">边界与非目标</a> ·
  <a href="#环境要求与安装">环境要求与安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#运行方式">运行方式</a> ·
  <a href="#配置">配置</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#目录结构">目录结构</a> ·
  <a href="#开发">开发</a> ·
  <a href="#尚未验证的决策">尚未验证的决策</a>
</p>

## 概览

`@cieljs/voice-agent` 是一个纯 Node.js 应用。它从本机输入设备采集音频，归一化为固定的 16 kHz / 单声道 / s16le 契约后交给 [`@cieljs/perception`](../../packages/perception/README.zh-CN.md)，把产生的多人语音快照交给 Ciel Session（`cieljs` / [`@cieljs/runtime`](../../packages/runtime/README.zh-CN.md)），让 Agent 判断是否加入对话，并通过小米 MiMo TTS 在指定输出设备上说出回复。

| 能力                                   | 实现                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 采集与播放                             | [`decibri`](https://decibri.com)（`Microphone` / `Speaker`），N-API 预编译二进制                                                              |
| VAD、ASR、说话人标签、冻结快照         | [`@cieljs/perception`](../../packages/perception/README.zh-CN.md)（音频部分交由 [`@cieljs/hearing`](../../packages/hearing/README.zh-CN.md)） |
| Session、Memory、工具与 Agent 生命周期 | `cieljs`，构建于 [`@cieljs/runtime`](../../packages/runtime/README.zh-CN.md) 之上                                                             |
| 语音结束事件的调度与合并               | `ConversationScheduler`（本包）                                                                                                               |
| 决定「要不要说」和「说什么」           | 一个带门控的 `speak` 工具（本包）                                                                                                             |
| 语音合成                               | 小米 `mimo-v2.5-tts` adapter（本包）                                                                                                          |

设计不变量：

- 任意时刻最多一个 `session.agent.prompt()` 正在运行；`speechend` 是唯一的自动思考触发器。
- 每个 `speechend` 都产生一份冻结的、时间不重叠的增量快照，因此后到的语音不会悄悄修改正在运行的那一次思考的输入。
- Agent 决定时机；调度器决定这个时机是否仍然成立；宿主负责合成方式与播放设备。
- 沉默是正常且一等的结果，不算失败，也不会调用 TTS。

## 边界与非目标

`@cieljs/voice-agent` 刻意**不是**：

- 浏览器或桌面 UI。没有 Web Audio、没有 `setSinkId()`、没有权限流程，也没有运行时可视化配置页面——配置就是类型化的 `voice-agent.config.ts`。
- 每检测到一句话就必须回答的问答机器人。`speechend` 调度的是一次*判断*，不是一次回答。
- ASR → Agent → TTS 强行串成同步请求的流水线。ASR 的中间结果只进入 Perception 时间线，不会直接调用 Agent。
- 某个具体聊天平台（Discord、QQ 等）的 transport。平台接入以后作为外层 transport 添加，不进入感知、思考或 TTS 的通用契约。
- 视觉输入的消费者。Voice Agent 只用 `asr` + `retentionMs` 创建 perception，因此 `perception.image` 为 `undefined`，只喂入音频。
- 流式 ASR 或流式 TTS 系统。TTS 契约返回完整音频；`StreamingTextToSpeech` 能力检测被明确推迟。
- 音色设计或音色克隆的前端。MiMo 的 voice design、voice clone 与唱歌能力不进入通用配置。
- 多 Agent 宿主。同一时刻只运行一个固定的群聊 Session，思考采用 single-flight。
- 自研 AEC/DSP 栈。回声消除来自音频后端，Voice Agent 只负责启用它、喂入远端参考，并保留一层文本近似兜底。
- FIFO 播放队列。尚未开始播放的回复被新语音 supersede，而不是排队等待。
- 运行期热切换声纹或模型的界面。

## 环境要求与安装

| 要求     | 说明                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js  | `>=24.11.1`（仓库根 `engines`）                                                                                                                                           |
| 包管理器 | pnpm `12.4.1`（仓库根 `devEngines.packageManager`）                                                                                                                       |
| 工具链   | Vite+ CLI `vp`——脚本通过 `vp run <script>` 执行                                                                                                                           |
| 原生音频 | `decibri` `^5.7.0`（**不使用** `naudiodon2`、PortAudio、node-gyp 或 MSVC）；预编译 N-API 二进制覆盖 `win32`（x64/arm64）、`darwin`（arm64）与 `linux`（x64/arm64，glibc） |
| 凭据     | `XIAOMI_API_KEY`（Agent 模型 provider 与 MiMo TTS adapter 共用）                                                                                                          |
| 实机运行 | 一个可用输入设备和一个可用输出设备                                                                                                                                        |

```bash
# 在仓库根目录
vp install
```

本包在 monorepo 内以源码方式消费（`@cieljs/voice-agent`，ESM，`exports["."] = ./dist/index.mjs`）。不存在运行时配置界面：所有配置都写在 `voice-agent.config.ts` 或程序化选项里。

## 快速开始

```ts
import {
  createVoiceAgent,
  defaultVoiceAgentConfig,
  resolveVoiceAgentModel,
} from '@cieljs/voice-agent';

const voiceAgent = createVoiceAgent({
  config: defaultVoiceAgentConfig,
  model: resolveVoiceAgentModel(),
});

const unsubscribe = voiceAgent.onEvent(event => console.log(event));

await voiceAgent.start();

process.on('SIGINT', async () => {
  unsubscribe();
  await voiceAgent.close();
});
```

`resolveVoiceAgentModel()` 只是模型 registry 的一层薄封装——它返回 `models.getModel('xiaomi', 'mimo-v2.5')`，registry 中不存在该模型时抛出 `未找到 Xiaomi mimo-v2.5 模型`。Xiaomi provider 与 TTS adapter 读取同一个 `XIAOMI_API_KEY`。

`src/cli/index.ts` 做的正是上面这些事，只是把 `defaultVoiceAgentConfig` 换成了 `voice-agent.config.ts`。

### `createVoiceAgent(options)`

| 选项         | 类型                                    | 说明                                                                     |
| ------------ | --------------------------------------- | ------------------------------------------------------------------------ |
| `config`     | `VoiceAgentConfig`                      | 必填。由 `defineVoiceAgentConfig` 校验。                                 |
| `model`      | `Model<Api>`（`@earendil-works/pi-ai`） | 必填。原样传给 `defineCiel`。                                            |
| `dataDir`    | `string`                                | 默认 `join(homedir(), '.ciel')`，随后被 `resolve()` 绝对化。             |
| `input`      | `AudioInput`                            | 可选覆盖，跳过 decibri adapter（测试与嵌入方使用）。此时也跳过设备校验。 |
| `output`     | `AudioOutput`                           | 可选覆盖，规则同上。                                                     |
| `tts`        | `TextToSpeech`                          | 可选覆盖。省略时创建 Xiaomi adapter，`XIAOMI_API_KEY` 变成必需。         |
| `perception` | `Perception`                            | 可选覆盖，便于确定性地伪造音频链路。                                     |

### 返回的 `VoiceAgent`

| 成员                | 行为                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `status`            | `'idle' \| 'starting' \| 'running' \| 'closing' \| 'closed'`                                                    |
| `scheduler`         | 当前 `SchedulerState`；运行中而调度器尚未创建时报告 `{ status: 'idle' }`，其余情况报告 `{ status: 'closed' }`。 |
| `start()`           | 已在运行时立即 resolve，正在启动时返回同一个 promise，其他状态以 `Voice Agent 当前不可用：<status>` 拒绝。      |
| `close()`           | 幂等——重复调用返回同一个 promise。启动过程中关闭会先等启动结束，然后仍释放宿主持有的资源（包括 MCP）。          |
| `onEvent(listener)` | 订阅 `VoiceAgentEvent`，返回取消订阅函数。                                                                      |

工作数据放在 `dataDir` 下：`<dataDir>/storage`（包含 session、memory、vector 模块的 Storage）、`<dataDir>/models`（`@cieljs/perception` 消费的 ASR/VAD/speaker 模型）、`<dataDir>/mcp.json`（`mcp.enabled` 时的 MCP 配置）。

## 运行方式

`package.json` 中的脚本：

| 脚本             | 命令                                     | 用途                            |
| ---------------- | ---------------------------------------- | ------------------------------- |
| `dev`            | `oxnode ./src/cli/index.ts start`        | 启动应用                        |
| `list-devices`   | `oxnode ./src/cli/index.ts list-devices` | 列出输入/输出设备               |
| `start`          | `oxnode ./src/cli/index.ts start`        | 启动应用（与 `dev` 同一条命令） |
| `check`          | `vp check`                               | 格式化、lint 与类型检查         |
| `prepublishOnly` | `vp run build`                           | 发布前构建                      |

> [!NOTE]
> `dev` 与 `start` 执行完全相同的命令——没有 watch 模式。`vp run dev` 与 `vp run start` 可以互换使用。

```bash
cd apps/voice-agent

vp run list-devices   # 列出每个设备的 index、稳定 id、声道数与默认采样率
vp run start          # 读取 voice-agent.config.ts 与 XIAOMI_API_KEY 后启动
```

CLI 参数（`process.argv.slice(2)`）：

| 参数                      | 行为                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list-devices`、`devices` | 先打印输入设备，再打印输出设备。每行包含 `index`、`name`、`maxInputChannels`/`maxOutputChannels`、`rate` 以及 `(默认)` 标记；稳定 `id` 打印在缩进的第二行。 |
| `start`、_（无参数）_     | 启动 Voice Agent，随后打印 `Voice Agent 已启动，Ctrl+C 退出。`                                                                                              |
| `help`、`--help`、`-h`    | 打印用法。                                                                                                                                                  |
| 其他任意参数              | 打印用法并设置 `process.exitCode = 2`。                                                                                                                     |

环境变量：

| 变量             | 作用                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `XIAOMI_API_KEY` | 除非注入 `tts` 覆盖，否则 `start` 必需。MiMo TTS adapter 以 Bearer token 使用它，Xiaomi 模型 provider 同样读取它。只从 `process.env` 读取，绝不写入配置文件、日志、错误详情或 Session。缺失时启动失败并报 `缺少 XIAOMI_API_KEY 环境变量`。 |
| `.env`（可选）   | CLI 在解析参数前调用 `process.loadEnvFile()`；文件不存在时静默忽略，因此真实环境变量仍然优先。                                                                                                                                             |
| `NO_COLOR`       | 关闭 ANSI 颜色。stdout 不是 TTY 时颜色也会自动关闭。                                                                                                                                                                                       |

> [!WARNING]
> 小米公开示例常用 `MIMO_API_KEY`。本项目按项目约定**只**读取 `XIAOMI_API_KEY`。

CLI 把事件渲染成带中文标签的行——`识别`（转写与说话人）、`忽略`（自身回声）、`思考`（语音段数，然后是发言/沉默与耗时）、`工具`（工具调用与结果）、`朗读`（文本，然后是合成耗时）、`播放`（设备选择器，然后是时长）以及 `错误`（stage + 消息，输出到 stderr）。`SIGINT` 与 `SIGTERM` 会触发 `voiceAgent.close()` 并 `process.exit(0)`；开始关闭后再次收到的信号被忽略。

## 配置

配置就是一个类型化模块：`defineVoiceAgentConfig()` 校验并返回对象，`defaultVoiceAgentConfig` 是内置基线。

```ts
// apps/voice-agent/voice-agent.config.ts
import { defaultVoiceAgentConfig, defineVoiceAgentConfig } from '@cieljs/voice-agent';

export default defineVoiceAgentConfig({
  embedding: defaultVoiceAgentConfig.embedding,
  mcp: {
    enabled: true,
  },
  audio: {
    input: {
      sampleRate: 48_000,
      channels: 1,
      // device: 4,
    },
    output: {
      // device: 2,
    },
  },
  conversation: {
    spaceId: 'voice-chat',
    sessionId: 'local-group',
    sources: ['voice-chat:local-group'],
    minimumThinkIntervalMs: 200,
  },
  perception: {
    asr: {
      speaker: [],
      speakerThreshold: 0.6,
      maxSpeakers: 8,
    },
    retentionMs: 60_000,
  },
  tts: {
    provider: 'xiaomi',
    model: 'mimo-v2.5-tts',
    voice: '冰糖',
    format: 'wav',
    instructions: '自然、轻松，像正在和熟人聊天；语速适中。',
  },
});
```

`defaultVoiceAgentConfig` 与仓库中这份文件有两处不同：`embedding.cacheDir` 是 `join(homedir(), '.ciel', 'cache', 'embedding')`（文件直接复用该默认值），`conversation.minimumThinkIntervalMs` 是 `2_000`（文件里用的是 `200`）。

### `embedding`

提供 `embedding` 时，Voice Agent 会创建以 `qwen(config.embedding)` 为后端的 `VectorService`，参数为 `providerId: 'qwen'`、`revision: '1'`、`granularity: 'chunk'`、`inputConfig: 'qwen-default'`；省略时 `vectors` 保持 `undefined`，不加载 embedding provider。

### `mcp`

必填的 `mcp.enabled`（boolean）与可选的 `mcp.required` 会传给 `createMcp({ cwd: dataDir, configFile: '<dataDir>/mcp.json', required })`。该实例由宿主持有：Voice Agent 与 runtime 共享它，并且只在所有会话消失之后才关闭它。它的工具会追加在 `speak` 之后的 Session 工具集中。

| 键           | 默认值                         | 说明                                                           |
| ------------ | ------------------------------ | -------------------------------------------------------------- |
| `cacheDir`   | —（设置 `embedding` 时必填）   | 必须是非空字符串。仓库中的配置使用 `~/.ciel/cache/embedding`。 |
| `dimensions` | `1024`（来自 `@cieljs/embed`） | Qwen3-Embedding-0.6B 的 MRL 截断维度。                         |
| `batchSize`  | `32`（来自 `@cieljs/embed`）   | 单次推理最大文本数。                                           |
| `dtype`      | `'q8'`（来自 `@cieljs/embed`） | ONNX 权重精度。                                                |
| `device`     | 运行时默认设备                 | `'wasm' \| 'webgpu'`。                                         |

### `audio`

| 键                 | 类型             | 默认值                     | 说明                                                                                                             |
| ------------------ | ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `input.device`     | `DeviceSelector` | `undefined` = 系统默认设备 | 见[设备选择](#设备选择)。                                                                                        |
| `input.sampleRate` | `number`         | `48_000`                   | 大于 0 的有限数字。采集设备以该采样率打开；归一化后 Perception 仍收到 16 kHz。该值同时作为输出设备的播放采样率。 |
| `input.channels`   | `number`         | `1`                        | 正整数。被选中的输入设备必须满足 `maxInputChannels >= channels`。                                                |
| `output.device`    | `DeviceSelector` | `undefined` = 系统默认设备 | 被选中的设备必须满足 `maxOutputChannels > 0`。                                                                   |

### `conversation`

| 键                       | 类型       | 默认值                       | 说明                                                    |
| ------------------------ | ---------- | ---------------------------- | ------------------------------------------------------- |
| `spaceId`                | `string`   | `'voice-chat'`               | 非空。传给 `ciel.session()`。                           |
| `sessionId`              | `string`   | `'local-group'`              | 非空。固定的群聊 Session。                              |
| `sources`                | `string[]` | `['voice-chat:local-group']` | 每一项非空并单独校验。用于 Session 发现与 Memory 归属。 |
| `minimumThinkIntervalMs` | `number`   | `2_000`（仓库配置为 `200`）  | 有限整数且 `>= 0`；相邻两次思考*开始*时间的最小间隔。   |

### `perception`

| 键                     | 类型               | 默认值   | 说明                                                                                      |
| ---------------------- | ------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `asr.speaker`          | `SpeakerProfile[]` | `[]`     | 已知声纹，每项为 `{ name, file }`，两者都必须非空。未知说话人继续由聚类器给出稳定标签。   |
| `asr.speakerThreshold` | `number`           | `0.6`    | 有限数字，`> 0` 且 `<= 1`。                                                               |
| `asr.maxSpeakers`      | `number`           | `8`      | 正整数；动态说话人数量上限。                                                              |
| `retentionMs`          | `number`           | `60_000` | 大于 0 的有限数字。传给 `createPerception`；必须覆盖快照仍处于 pending 状态的最长语音段。 |

Voice Agent 自己会向 `asr` 注入 `modelsPath: join(dataDir, 'models')`——它刻意不进入配置表面。

### `tts`

| 键             | 类型              | 默认值                                       | 说明                                                      |
| -------------- | ----------------- | -------------------------------------------- | --------------------------------------------------------- |
| `provider`     | `'xiaomi'`        | `'xiaomi'`                                   | 本版本唯一的 provider。                                   |
| `model`        | `'mimo-v2.5-tts'` | `'mimo-v2.5-tts'`                            | 字面量类型。                                              |
| `voice`        | `string`          | `'冰糖'`                                     | 非空，provider 定义的稳定音色 ID。                        |
| `format`       | `'wav'`           | `'wav'`                                      | 字面量类型。                                              |
| `instructions` | `string`          | `'自然、轻松，像正在和熟人聊天；语速适中。'` | 非空。全局风格指令；`speak.instructions` 参数按句覆盖它。 |

### 设备选择

`DeviceSelector = number | string | { id: string }`：

| 选择器           | 解析规则                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| _（省略）_       | 系统默认设备。启动只要求存在*某个*带输入（或输出）声道的设备。                                  |
| `number`         | 匹配 `list-devices` 输出的 `device.index`。必须是 `>= 0` 的整数。                               |
| `string`         | 对 `device.name` 做大小写不敏感的**子串**匹配，取第一个命中（例如 `"USB"`）。                   |
| `{ id: string }` | 与稳定的 per-host `id` 精确匹配（例如 `'wasapi:{...}'`），跨设备枚举与重启有效。`id` 必须非空。 |

> [!WARNING]
> 系统设备集合变化时，设备索引会漂移。需要长期稳定请优先用 `{ id }`，并在更换驱动或硬件后用 `list-devices` 重新确认。显式指定的设备无法解析时启动直接失败——Voice Agent 不会静默回退到默认设备。

### 校验规则

`defineVoiceAgentConfig()` 抛出带路径的中文错误。必填字符串为空（包括 `embedding.cacheDir`、`spaceId`、`sessionId`、每个 `sources[i]`、每个 `asr.speaker[i].name` / `.file`、`tts.voice` 与 `tts.instructions`）报 `<路径> 不能为空`；`mcp.enabled` 必须是 boolean；`audio.input.channels`、`asr.maxSpeakers` 与整数设备选择器各有自己的整数下界（`>= 1`、`>= 1`、`>= 0`）；`sampleRate`、`retentionMs`、`minimumThinkIntervalMs` 必须是有限数字（最后一个还要 `>= 0`）；`speakerThreshold` 必须落在 `(0, 1]` 内；其余取值必须匹配上表中的字面量类型——例如 `conversation.minimumThinkIntervalMs 必须是有限整数`、`perception.asr.speakerThreshold 必须是大于 0 且不超过 1 的有限数字`、`audio.input.device 必须是大于等于 0 的整数设备索引`。

## 工作原理

```mermaid
flowchart LR
  Mic["decibri Microphone<br/>aec: 'tau'"] --> Norm["AudioNormalizer<br/>单声道 / 16 kHz / s16le"]
  Norm --> Perception["@cieljs/perception<br/>VAD · ASR · 说话人"]
  Perception -- "speechend" --> Echo{"自身回声？"}
  Echo -- "是" --> Skip["skipThrough(at)<br/>只推进游标"]
  Echo -- "否" --> Scheduler["ConversationScheduler"]
  Scheduler -- "snapshot(capturedThrough + 1 .. at)" --> Pending["pending window"]
  Pending --> Agent["session.agent.prompt()"]
  Agent --> Speak["speak 工具（带门控）"]
  Speak --> TTS["XiaomiTextToSpeech"]
  TTS --> Out["AudioOutput.play()"]
  Out -. "onAecReference(pcm)" .-> Mic
```

### 调度状态机

```ts
type SchedulerState =
  | { status: 'idle' }
  | { status: 'waiting'; pending: PendingWindow; eligibleAt: Date }
  | { status: 'thinking'; run: ThinkRun; pending?: PendingWindow }
  | { status: 'closed' };

interface PendingWindow {
  startInclusive: Date;
  endInclusive: Date;
  speechEndCount: number;
  snapshots: Promise<PerceptionSnapshot>[];
}
```

`startInclusive` 是窗口的第一毫秒，`endInclusive` 是已合并窗口中最新的 `speechend.at`。窗口一旦交给一次思考就不可变；合并总是产生新对象。

```text
idle     + speechend  ── 已满足最小间隔 ──► thinking
idle     + speechend  ── 未满足最小间隔 ──► waiting（pending_created）
waiting  + speechend  ────────────────────► 扩展 pending.endInclusive（pending_merged）
waiting  + 到达 eligibleAt ───────────────► thinking
thinking + speechend，无 pending ─────────► 创建 pending（pending_created）
thinking + speechend，已有 pending ───────► 扩展 pending（pending_merged）
thinking + 完成，无 pending ──────────────► idle
thinking + 完成，有 pending 且已满足间隔 ─► thinking（下一轮）
thinking + 完成，有 pending 但未满足间隔 ─► waiting
thinking + Agent 报错 ────────────────────► 窗口并回 + waiting（退避）
close() ──────────────────────────────────► closed（不再启动新的思考）
```

最小间隔定义在思考的*开始*时间上：

```ts
nextEligibleAt = lastThinkStartedAt + minimumThinkIntervalMs;
```

因为锚点在开始时刻，一次已经超过最小间隔的慢速模型调用结束后可以立即处理 pending window，而不必再机械等待一整段间隔。

### 增量快照与游标提交

Perception 按闭区间筛选转写，因此调度器维护 `capturedThrough`，并在每个 `speechend` 到达时捕获不重叠的增量切片：

```ts
const startAt = new Date(this.capturedThrough + 1);
const snapshot = this.options.perception.snapshot({ startAt, endAt: at });

this.capturedThrough = at.getTime();
```

在推进游标之前先保存 Promise，因此再慢的思考也不会因为保留窗口清理而丢失切片。执行窗口时按顺序等待全部快照、逐个调用 `snapshot.compose()`，再把扁平的 `AgentMessage[]` 一次性交给 `session.agent.prompt()`——多个 `speechend` 只触发一次思考，同时保留每段语音的原始时间与说话人。

捕获与处理是分离的：`capturedThrough`（去重）与 `processedThrough`（思考成功后提交为 `inFlight.endInclusive`）互不相同。**空**的合并窗口会跳过 `agent.prompt()`，但仍推进 `processedThrough`——它表示 VAD 结束却没有可消费的转写。

### 重试

`agent.prompt()` 失败时会以 `pending_created` 重新发出该窗口，与失败期间新积累的窗口合并，然后进入 `waiting`。退避从 `1_000` ms 开始，每次失败翻倍，上限 `30_000` ms；一次成功的思考会把退避重置为 `1_000` ms。同一时刻只存在一个重试计时器，因此服务故障不会形成重试风暴。`close()` 会清除计时器并停止新的思考。

### `speak` 门控

「要不要说」由 Agent 决定，「是否仍然适合说」由实时调度状态决定。一个 `speak` 工具（label 为 `发言`）覆盖合成、播放与门控。

| 参数           | 类型     | 约束                                                                            |
| -------------- | -------- | ------------------------------------------------------------------------------- |
| `text`         | `string` | 必填，1–4000 字符。最终朗读文本：不含 Markdown、列表、网址或舞台说明。          |
| `instructions` | `string` | 可选，≤1000 字符。这一句话的语气、情绪或节奏；缺省时回退到 `tts.instructions`。 |

```ts
type SpeakResult =
  | { status: 'delivered'; startedAt: string; endedAt: string }
  | { status: 'superseded'; reason: 'new_speech' };
```

一次工具调用内部的门控顺序：

1. 没有正在运行的思考 → 工具错误（`speak 只能在一次思考运行期间调用`）。
2. `markSpoke()` 返回 false → 工具错误（`本轮已经调用过 speak，同一轮只能发言一次`）。每轮思考最多一次有效调用。
3. `text` 全为空白 → 工具错误（`text 不能为空`）。
4. 本轮 revision 已经过期 → 立即返回 `superseded`，不发起 TTS 请求。
5. 思考门控的 signal 与 Agent 自身调用的 signal 用 `AbortSignal.any` 合并，随后发出 `tts_started` 并调用 `synthesize()`。
6. 合成期间被中止 → `superseded`；其他合成错误原样抛出。
7. `tts_finished` 之后再次检查 revision：已过期则丢弃音频并返回 `superseded`（不播放任何内容）。
8. 否则开始播放（`playback_started`），PCM 分块同时喂给输入的 AEC 参考回调，并且只有在 `play()` resolve 之后——即音频真正播放完毕之后——才返回 `delivered`。`playback_finished`、`gate.recordDelivered()` 与自身回声播放窗口都在此刻记录。

回复永远不会在 FIFO 队列中等待。任意时刻最多一个正在合成或播放的发言；尚未开始播放的回复被 supersede 而不是排队；已经开始的播放一定播放完，同期新语音继续进入下一个 pending window。`AudioOutput` 内部会串行化写入，但这不是业务队列。`superseded` 会明确告诉 Agent 这句话没有被听到，只有 `delivered` 的文本才算真实发言——其余 assistant 文本只是内部控制记录。

### 音频链路

采集链路：

```text
decibri Microphone（aec: 'tau'，dtype int16）
  → capturedAt = 首帧墙钟 + 累计样本数 / sampleRate
  → AudioNormalizer：混合为单声道、线性插值到 16 kHz、钳位为 s16le
  → perception.asr.write({ data, startAt: chunk.capturedAt })
```

播放链路：

```text
SpeechAudio（wav）→ parseWav 校验 → decodeWavToPcm16
  → resampleS16le(...) 到设备采样率（相同时直接返回原 Buffer）
  → Speaker.open → 以 16 KiB 分块 writeAsync（遵守 backpressure）
  → 每个分块先调用 onAecReference(chunk) → drainAsync()
```

需要知道的细节：

- `AudioNormalizer` 是有状态的：残留样本与分数重采样位置跨分块保留，因此分块边界不会引入杂音。
- `parseWav` 校验 RIFF/WAVE，要求存在 `fmt` 与 `data` 块，支持 8/16/24/32 位 PCM 以及 32 位浮点；WAV header 绝不会被写进设备流。
- 播放采样率是 `audio.input.sampleRate`；`AudioOutput` 通过 `createAudioOutput({ sampleRate: config.audio.input.sampleRate })` 创建。
- `AudioInput.start()` 是 `AudioInputChunk`（`data`、`capturedAt`、`sampleRate`、`channels`、`format`）的异步可迭代对象；`AudioOutput.play(audio, { device, signal, onAecReference })` 只有在音频排空后才 resolve。
- `audio/input.ts` 与 `audio/output.ts` 是唯一导入 `decibri` 的模块；其余模块只依赖 `audio/types.ts` 中的接口，这也是测试可以完全脱离设备的原因。

### VAD / AEC 的职责划分

| 关注点                                  | 负责方                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VAD、ASR、说话人聚类、转写时间戳        | [`@cieljs/perception`](../../packages/perception/README.zh-CN.md) → [`@cieljs/hearing`](../../packages/hearing/README.zh-CN.md)                              |
| 固定的 16 kHz / 单声道 / s16le 输入契约 | `AudioNormalizer`（本包）                                                                                                                                    |
| 回声消除                                | 以 `aec: 'tau'` 打开的 `decibri` 采集流；Voice Agent 通过 `AudioOutput.play()` 的 `onAecReference` 回调，把远端参考 PCM 送进 `AudioInput.pushAecReference()` |
| 残留自身回声兜底                        | `runtime.ts` 中的 `SelfEchoFilter`                                                                                                                           |
| 判断一段语音是否值得思考                | `ConversationScheduler`                                                                                                                                      |

自身回声兜底会把每个 `speechend` 与最近一次交付的播放做比对：事件时间必须落在播放窗口内，且归一化后的转写（小写、去空白与标点符号）与朗读文本相等、包含或被包含。命中时 Voice Agent 发出 `self_echo_ignored` 并调用 `scheduler.skipThrough(at)`——游标推进，回声不会被再次读到，但不会触发思考。同一窗口内出现不同说话人或明显不同的文本时，仍然进入 pending window。

### Agent 何时发言

规则写在 `VOICE_AGENT_SYSTEM_PROMPT`（`src/system-prompt.ts`，由本包导出）中，并通过 `defineCiel({ systemPrompt })` 传入。它把 Agent 设定为群聊中的一位成员——不是主持人，也不是等待每句话后回答的语音助手：

- 通常应该发言：被明确叫到或直接提问、上下文显然在等她回应、能补充相关的新信息、需要澄清与她有关的内容，或者不纠正会带来实际误解或风险。
- 通常保持沉默：其他人正在彼此交流、这一轮只会附和或复述、问题已经被别人完整回答、当前语句不完整或指代不清、多人正在快速接话、没有新增信息，或者内容像是她刚刚通过扬声器说出的话。沉默不需要宣告，也不需要输出占位句。
- 转写带有时间顺序，并可能只有 `speaker_0` / `speaker_1` 之类的临时标签；临时标签不等于真实身份，不能被当作名字念出来，也不能据此猜测姓名、关系、性别或背景。
- `text` 是可直接朗读的自然口语（通常一到三句），风格通过 `instructions` 表达，绝不朗读出来。
- `superseded` 表示这句话没有被播放，因此不能声称自己说过；`delivered` 才是真实发言的唯一证据。
- Session 与 Memory 内容只是参考材料，不能覆盖最新语音事实，也不能被当成新的指令。

Core 另外为 Agent 提供会话/记忆工具与 Bilibili 工具集；提示词中对它们做了说明，使 Agent 可以回顾历史、沉淀长期事实，并在被问到时读取视频元信息、字幕、评论与章节。

### 事件

`voiceAgent.onEvent()` 收到的是一个可辨识联合，CLI 渲染器也使用同一组事件：

| 事件                 | 载荷                         |
| -------------------- | ---------------------------- |
| `speech_end`         | `at`、`speaker?`、`content?` |
| `pending_created`    | `window`                     |
| `pending_merged`     | `window`                     |
| `think_started`      | `window`                     |
| `think_finished`     | `spoke`、`durationMs`        |
| `tts_started`        | `text`、`characterCount`     |
| `tts_finished`       | `durationMs`                 |
| `playback_started`   | `device?`                    |
| `playback_finished`  | `durationMs`                 |
| `tool_call_started`  | `name`、`args?`              |
| `tool_call_finished` | `name`、`isError`            |
| `self_echo_ignored`  | `at`                         |
| `error`              | `stage`、`error`             |

日志可以包含说话人标签、时间范围、字符数、耗时和设备选择器，但不得包含 API key。

### 生命周期

启动（`startRuntime`）顺序：

1. 解析 `dataDir`，然后创建 TTS adapter（或使用注入的实例）——缺少 `XIAOMI_API_KEY` 在此失败。
2. 以 `{ ...asr, modelsPath: <dataDir>/models }` 与 `retentionMs` 创建 perception。
3. 创建 `AudioInput` 与 `AudioOutput` 并校验设备——仅针对 Voice Agent 自己创建的 adapter。
4. 构建 `SpeakController` 与 `speak` 工具，连接 TTS、输出、音色、格式、指令、输出设备、事件发射器、自身回声记录与 AEC 参考钩子。
5. 以 session、memory、vector 模块打开 `Storage`；可选创建以 `qwen` 为后端的 `VectorService`；可选创建 MCP。
6. `defineCiel({ model, systemPrompt: VOICE_AGENT_SYSTEM_PROMPT, storage, vectors, tools: [speakTool], mcp })`，随后 `await ciel.start()`。
7. 以 `{ sessionId, spaceId, sources }` 打开固定的 Session，然后订阅 Agent 事件，用于 `tool_call_started` / `tool_call_finished`。
8. 以 `startedAt = new Date()` 创建 `ConversationScheduler`，订阅 perception 的 `speechend`，启动音频泵并设置 `status = 'running'`。

启动过程中任何失败都会释放已建好的全部资源，把 `status` 重置为 `'idle'` 后再抛出，因此 `start()` 可以重试。

关闭（`close()` → `dispose()`）顺序：取消订阅 `speechend` 与 Agent 监听 → `input.close()` → `scheduler.close()`（停止新思考并等待当前 run）→ `perception.close()`（flush，可能产生最后一个 `speechend`）→ `output.stop()` → `output.close()` → `tts.close()` → `session.close()` → `ciel.close()` → `vectors.close()` → `storage.close()`，最后 `mcp.close()`（宿主持有，等所有会话消失后才释放）→ `status = 'closed'`。每一步都幂等。

### 失败处理

| 失败                                                  | 行为                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| 缺少 `XIAOMI_API_KEY`                                 | `start()` 以 `缺少 XIAOMI_API_KEY 环境变量` 拒绝；不会留下半可用运行时     |
| 显式输入设备不存在 / 声道不足                         | `start()` 拒绝（`输入设备不存在：…` / `输入设备声道数不足：…`）            |
| 显式输出设备不存在 / 不是输出设备                     | `start()` 拒绝（`输出设备不存在：…` / `设备不是输出设备：…`）              |
| 未指定设备且没有可用设备                              | `start()` 拒绝（`未找到可用的输入设备` / `未找到可用的输出设备`）          |
| 启动阶段任意错误                                      | 完整 `dispose()`，状态回到 `'idle'`，错误重新抛出                          |
| `agent.prompt()` 抛错                                 | `error` 事件（`stage: 'agent'`），窗口并回 pending，按有上限的指数退避重试 |
| Agent 没有调用 `speak`                                | 正常沉默，`think_finished.spoke === false`                                 |
| `speak` 没有运行中的思考、同一轮第二次调用或空白 text | 工具报错；不合成也不播放                                                   |
| 合成期间出现新语音                                    | `AbortSignal` 取消请求，工具返回 `superseded`                              |
| 合成完成后、播放前出现新语音                          | 丢弃音频，工具返回 `superseded`                                            |
| 播放失败                                              | 错误从 `output.play()` 抛回工具调用；本轮不会被标记为 delivered            |
| 空快照                                                | 不调用 `agent.prompt()`，游标仍然推进                                      |
| 运行期输入流错误                                      | `error` 事件（`stage: 'input'`）；调度器对后续到达的数据继续工作           |

## 目录结构

```text
apps/voice-agent/
├── package.json          # 脚本、exports、decibri 与 workspace 依赖
├── voice-agent.config.ts      # CLI 消费的仓库内类型化配置
├── vite.config.ts        # Vite+ 任务：test（透传 XIAOMI_API_KEY）与 build（vp pack）
├── README.md
├── README.zh-CN.md
├── src/
│   ├── index.ts          # 公共入口：配置、提示词、运行时、调度器、音频、TTS
│   ├── config.ts         # VoiceAgentConfig 类型、defaultVoiceAgentConfig、校验
│   ├── runtime.ts        # createVoiceAgent：生命周期、设备校验、自身回声过滤
│   ├── system-prompt.ts  # VOICE_AGENT_SYSTEM_PROMPT
│   ├── cli/
│   │   └── index.ts      # list-devices / start / help 与事件渲染
│   ├── conversation/
│   │   ├── scheduler.ts  # ConversationScheduler、PendingWindow、VoiceAgentEvent
│   │   └── speak-tool.ts # SpeakController、ThinkRunGate 与带门控的 speak 工具
│   ├── audio/
│   │   ├── types.ts      # AudioInput/AudioOutput 接口、DeviceSelector、resolveDevice
│   │   ├── normalizer.ts # 单声道 / 16 kHz / s16le 归一化
│   │   ├── resample.ts   # resampleS16le：TTS → 设备采样率
│   │   ├── input.ts      # decibri Microphone adapter（aec: 'tau'）
│   │   ├── output.ts     # decibri Speaker adapter（AEC 参考分发）
│   │   └── wav.ts        # parseWav / decodeWavToPcm16
│   └── tts/
│       ├── types.ts      # SpeechAudio、SpeechSynthesisRequest、TextToSpeech
│       └── xiaomi.ts     # createXiaomiTextToSpeech（MiMo chat/completions）
└── tests/
    ├── scheduler.test.ts
    ├── speak-tool.test.ts
    ├── system-prompt.test.ts
    ├── tts-xiaomi.test.ts
    └── runtime.test.ts
```

包导出：`"."` → `./dist/index.mjs`，`"./package.json"` → `./package.json`。

### 公共 API

配置：`createVoiceAgent`/`VoiceAgentOptions`/`VoiceAgent`/`VoiceAgentStatus`、`defaultVoiceAgentConfig`、`defineVoiceAgentConfig`、`VoiceAgentConfig` 及各分段配置类型、`VOICE_AGENT_SYSTEM_PROMPT`。调度：`ConversationScheduler`、`VoiceAgentEvent`、`PendingWindow`、`SchedulerState`。发言门控：`createSpeakTool`、`SpeakController`、`SpeakResult`、`SpeakToolOptions`、`ThinkRunGate`。音频：`createAudioInput`、`createAudioOutput`、`AudioNormalizer`、`resampleS16le`、`decodeWavToPcm16`、`parseWav`、`resolveDevice`，以及 `ParsedWav`、`DecodedPcm`、`AudioDevice`、`AudioInput`、`AudioInputChunk`、`AudioInputDevice`、`AudioOutput`、`AudioOutputDevice`、`DeviceSelector` 类型。TTS：`createXiaomiTextToSpeech`、`XiaomiTextToSpeechOptions`、`SpeechAudio`、`SpeechAudioFormat`、`SpeechSynthesisRequest`、`TextToSpeech`。模型辅助函数：`resolveVoiceAgentModel()`。

## 开发

```bash
# 仓库根目录
vp install

cd apps/voice-agent
vp run check     # vp check —— 格式化、lint、类型检查
vp run test      # vite.config.ts 中的 test 任务 → vp test，透传 XIAOMI_API_KEY
vp run build     # vite.config.ts 中的 build 任务 → vp pack（先构建声明依赖）
vp run start     # 按 voice-agent.config.ts 运行应用
```

仓库根还提供 `vp run -r test`、`vp run -r build` 与 `vp ready`（`vp check && vp run -r test && vp run -r build`）。

`vite.config.ts` 定义了两个 Vite+ 任务：`test`（`vp test`，`env: ['XIAOMI_API_KEY']`，忽略 `dist/**` 与 `*.tsbuildinfo`）与 `build`（`vp pack`，`dependsOn` 依赖包的 `build` 任务）。`pack` 通过 `tsgo` 生成声明文件并推导 `exports`。

测试是确定性的、不依赖设备的：`runtime.test.ts` mock 了 `decibri`、`@cieljs/perception` 与 `@cieljs/embed`，注册 faux `pi-ai` provider，并注入伪造的 `input` / `output` / `tts` / `perception` 与临时 `dataDir`。`scheduler.test.ts` 与 `speak-tool.test.ts` 使用内存 fake，并用 `vi.useFakeTimers()` 断言节奏与退避。`tts-xiaomi.test.ts` stub 了 `fetch`，断言请求映射、WAV 校验、中止行为，以及错误路径的请求体里绝不出现密钥。跑完整套测试不需要 ASR 模型或音频硬件。

目前测试固化的行为：

- `idle` 时第一个 `speechend` 启动思考；`thinking` 期间连续三个 `speechend` 只合并成一个 pending window（`speechEndCount === 3`）；增量快照互不重叠（每个 `startAt` 都是上一个 `endAt + 1 ms`）；
- `thinking` 期间产生的第二个窗口在间隔满足后立即开始；prompt 失败后恰好 `1_000 ms` 重试，且不会重复 snapshot；空快照推进 `processedThrough` 但不调用 Agent；`close()` 之后不再启动新的思考；
- `speak` 在播放完成后返回 `delivered`，在合成前或合成期间出现新语音时返回 `superseded`，拒绝同一轮的第二次调用、拒绝空白 text、拒绝在思考之外调用；
- 缺少 `XIAOMI_API_KEY` 与显式指定但不存在的输入设备都会让 `start()` 失败。

## 尚未验证的决策

以下事项在设计上已经固定，但在第一次实机联调前仍需要真实环境确认，因此在这里刻意标注为未验证：

1. **decibri AEC 的实际效果。** 采集端启用了 `aec: 'tau'`，播放端会推送远端参考，但它在真实全双工设备（同机扬声器 + 麦克风）上的回声消除质量尚未测量。文本近似的 `SelfEchoFilter` 仍作为兜底保留，`aecMetrics()` 可用于诊断。
2. **Xiaomi 模型 registry 的稳定性。** `resolveVoiceAgentModel()` 从 `@cieljs/model-kit/models` 读取 `models.getModel('xiaomi', 'mimo-v2.5')`；该 registry 是否会作为受支持的公共入口长期保留（而不是让 Voice Agent 自行注册 provider）尚未确定。
3. **MiMo 预置音色 ID。** `tts.voice` 暂定默认为 `冰糖`，最终音色 ID 尚未确认。

一个相关的开放问题属于*配置选择*而非设计决策：仓库中的 `voice-agent.config.ts` 使用 `minimumThinkIntervalMs: 200`，而 `defaultVoiceAgentConfig` 与设计基线使用 `2_000`。真实多人对话下的合适取值尚未在硬件上调参。

外部依据：

- [小米 MiMo V2.5 语音模型发布说明](https://platform.xiaomimimo.com/docs/en-US/news/previous-news/v2.5-tts-release)
- [小米官方 `mimo-v2.5-tts` 调用示例](https://github.com/XiaomiMiMo/MiMo-Skills/blob/main/skills/mimo-v2-5-tts/scripts/mimo_tts.py)
- [`decibri` 主页](https://decibri.com)
