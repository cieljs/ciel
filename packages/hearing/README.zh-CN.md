<h1 align="center">@cieljs/hearing</h1>

<p align="center">纯 Node 的流式语音感知：基于 sherpa-onnx 完成 PCM 缓冲、VAD 分段、离线转写、片段时间戳与说话人识别。</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="#概览">概览</a> ·
  <a href="#安装">安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#事件与时间戳">事件与时间戳</a> ·
  <a href="#分段vad-选项">分段</a> ·
  <a href="#转写行为">转写行为</a> ·
  <a href="#说话人与声纹">说话人</a> ·
  <a href="#多模型">多模型</a> ·
  <a href="#模型配置与-cli">模型配置与 CLI</a> ·
  <a href="#api-参考">API 参考</a> ·
  <a href="#开发">开发</a>
</p>

## 概览

`@cieljs/hearing` 通过 [`sherpa-onnx-node`](https://github.com/k2-fsa/sherpa-onnx) 把语音感知完全放在 Node 里完成。三条管线共用一个事件流：TEN-VAD 把 PCM 缓冲切成语音片段，ASR 模型转写每个结束的片段，3D-Speaker ERes2Net base 提取声纹并聚成说话人。默认识别模型是 Qwen3-ASR 1.7B INT8。

音频以 16 kHz、单声道、16 位有符号小端 PCM（`s16le`）输入，其它采样率与声道数由包内重采样。时间信息止步于 VAD 片段——没有词级时间戳，也没有置信度——而且所有时间戳都由调用者传入的 `startAt` 推导，包本身从不读系统时钟。

`ASR` 是后端之上的一层门面：普通 Node 直接使用原生绑定，Electron 下同一套 API 会把推理移入独立的 Node 进程，事件语义完全一致。对外导出两个运行时：`ASR`（转写、说话人、可选唤醒门控）和 `KWS`（独立关键词唤醒）。声纹是放在代码之外的二进制资产，由 CLI 生成；[`@cieljs/perception`](../perception/README.zh-CN.md) 则在本包之上叠加视觉采样与 Agent 快照。

## 安装

```bash
vp install   # 或：pnpm install
```

`sherpa-onnx-node`（预编译原生绑定）和 `pinyin-pro` 都是普通依赖，因此既不需要 Python，也不用自己装 ONNX runtime。

模型不会被包进来，而是下载到调用者传入的 `modelsPath` 目录里，位置和生命周期都归调用者：

| 目录                                                         | 模型                            | 来源                                                              |
| ------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------- |
| `asr/qwen3-asr-1.7b-int8/`                                   | Qwen3-ASR 1.7B INT8 + tokenizer | ModelScope `zengshuishui/Qwen3-ASR-onnx`（社区转换）              |
| `asr/sensevoice-small/`                                      | SenseVoiceSmall INT8 + tokens   | ModelScope `pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue` |
| `vad/ten-vad.int8.onnx`                                      | TEN-VAD                         | sherpa-onnx GitHub release（`asr-models`）                        |
| `speaker/model.onnx`                                         | 3D-Speaker ERes2Net base        | sherpa-onnx GitHub release（`speaker-recongition-models`）        |
| `kws/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01/` | Zipformer WenetSpeech KWS 3.3M  | sherpa-onnx GitHub release（`kws-models`）                        |

有三种获取方式：

```bash
# 1. CLI
vp run @cieljs/hearing#install-model -- --models-path ./models
```

```ts
// 2. 显式安装
import { installModels } from '@cieljs/hearing';
await installModels({ modelsPath: './models' });

// 3. 工厂函数按所选选项装好需要的文件，再构造实例
import { createASR, createKWS } from '@cieljs/hearing';
```

已经存在且非空的文件会被跳过，除非设置 `force`（CLI 上是 `--force`）。

> [!NOTE]
> 下载用普通 `fetch` 加 `.part` 临时文件，成功后改名；默认重试 2 次（`retries`、`retryDelayMs`），连接超时 30 秒、传输超时 30 分钟。同一进程内并发安装同一个解析后的目标，会共用一次下载。

## 快速开始

```ts
import { ASR } from '@cieljs/hearing';

const asr = new ASR({
  modelsPath: '/path/to/models',
  bufferSeconds: 30,
  vad: {
    minSilenceDuration: 0.5,
    maxSpeechDuration: 10,
  },
  speakerThreshold: 0.6,
  maxSpeakers: 8,
});

asr.on('result', result => {
  console.log(result.content, result.speaker, result.startAt, result.endAt);
});

asr.write({ data: pcm16le, startAt: new Date() });
await asr.flush();

await asr.close();
```

`write()` 接收一段 PCM 以及它开始的时间，`flush()` 排空缓冲并输出最后一段。这两个调用都不会抛错：PCM 格式不对、缓冲写满、worker 崩溃，统统通过 `error` 事件报告。

文件还没落盘时改用异步工厂：它先安装再返回一个已经准备好的实例。`ASR` 和 `KWS` 都实现了 `AsyncDisposable`，所以 `await using` 会替你关闭：

```ts
import { createASR } from '@cieljs/hearing';

await using asr = await createASR({
  modelsPath: '/path/to/models',
  model: 'sensevoice-small',
});
```

## 事件与时间戳

`ASR` 会发五种事件：

| 事件          | 载荷        | 含义                                     |
| ------------- | ----------- | ---------------------------------------- |
| `wake`        | `WakeEvent` | 配置了唤醒门控，且命中了关键词           |
| `speechstart` | `Date`      | 片段开始                                 |
| `result`      | `ASRResult` | 识别文本，附带语言/情绪/事件与说话人     |
| `speechend`   | `Date`      | 片段结束，包括没有产出 `result` 的片段   |
| `error`       | `Error`     | 输入有问题、缓冲写满、模型或 worker 失败 |

`on()` 返回取消订阅的函数。每个 VAD 片段都会触发 `speechstart` 与 `speechend`，而 `result` 只在后端产出了文本或音频事件时才触发。

`ASRResult` 的字段如下：

| 字段                    | 类型                     | 说明                                                                     |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `content`               | `string`                 | 去掉 `<asr_text>` 前缀（Qwen3）或 `<\|...\|>` 标签（SenseVoice）后的文本 |
| `model`                 | `ASRModelId?`            | 该片段由哪个模型产出；更早持久化的结果可能没有这个字段                   |
| `language` / `emotion`  | `string?`                | 仅 SenseVoice                                                            |
| `events`                | `readonly AudioEvent[]?` | 仅 SenseVoice，每项形如 `{ type: string }`                               |
| `speaker`               | `string?`                | 注册名或 `speaker_N`；只在有文本时才赋值                                 |
| `startAt` / `endAt`     | `Date`                   | 片段边界                                                                 |
| `confidence` / `tokens` | 可选                     | 契约的一部分，当前模型从不填充                                           |

时间戳来自流起点加采样偏移：

| 时间戳           | 推导方式              |
| ---------------- | --------------------- |
| `speechstart`    | 流起点 + 片段起始采样 |
| `result.startAt` | 片段起始采样          |
| `result.endAt`   | 片段结束采样          |
| `speechend`      | 片段结束采样          |

第一次 `write()` 的 `startAt` 会固定整条流的起点。

> [!WARNING]
> 没有词级时间戳。Qwen3-ASR 与 SenseVoice 只提供片段级对齐，`tokens` 会一直是空的。不要拿 `tokens` 做字幕时间轴。

## 分段（VAD 选项）

VAD 默认开启（`mode: 'transcription'`）。TEN-VAD 以 256 个采样（16 kHz 下约 16 毫秒）为一窗推进，每个结束的片段立刻转写。

| 选项                     | 默认值            | 含义                                     |
| ------------------------ | ----------------- | ---------------------------------------- |
| `bufferSeconds`          | `30`              | 环形缓冲容量（秒）——是容量，不是分析窗口 |
| `vad.minSilenceDuration` | `0.5`             | 静音多少秒后结束当前片段                 |
| `vad.maxSpeechDuration`  | `10`              | 单个片段的上限（秒）                     |
| `mode`                   | `'transcription'` | `'events'` 会完全绕过 VAD                |
| `eventWindowSeconds`     | `5`               | `mode: 'events'` 使用的窗口长度          |

`minSpeechDuration`（0.5 秒）和 VAD 阈值（0.25）固定在包内，不作为选项暴露。

`bufferSeconds` 决定能排队多少 PCM；缓冲写满会抛 `ASR circular buffer is full`，而不是悄悄丢采样。说话人分析不受它限制：3D-Speaker 直接跑在 VAD 片段上，不足 3 秒的片段会用零补齐到提取器要求的最小长度。

把分段放宽（更大的 `minSilenceDuration`、更大的 `maxSpeechDuration`）能少切碎句子，但会增加延迟，也可能把不同说话人并进同一段。请用真实音频验证，而不是凭感觉调。

调用方按场景覆盖。不传 `vad` 就保持 0.5 秒 / 10 秒的默认值；Blive Agent 覆盖成 `{ minSilenceDuration: 0.2, maxSpeechDuration: 5 }` 并配 `bufferSeconds: 30`，因为直播必须跟得上房间（见 `apps/blive-agent/src/main/application.ts`）。

非法选项在构造后端时就会被拒绝：

| 规则                                                                                | 错误                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 每个传入的 `vad.*` 都是有限且大于 0 的数                                            | `vad.<name> must be a positive number`                          |
| 传了 `vad` 时：`maxSpeechDuration + minSilenceDuration <= bufferSeconds`            | `VAD speech and silence durations must fit in the audio buffer` |
| `bufferSeconds >= 256 / 16000`                                                      | `bufferSeconds must hold at least one 256-sample VAD window`    |
| `Math.round(eventWindowSeconds * 16000) >= 1`，events 模式下还要 `<= bufferSeconds` | `eventWindowSeconds must fit in the audio buffer`               |
| `speakerThreshold` 落在 `(0, 1]`                                                    | `speakerThreshold must be greater than 0 and at most 1`         |
| `maxSpeakers` 是正整数                                                              | `maxSpeakers must be a positive integer`                        |

`flush()` 会把缓冲里剩下的采样用零补满一个窗口、跑一遍 VAD、发出最后一个片段，然后重置 VAD、缓冲与流起点——下一次 `write()` 开始的是新的一条流。它不关闭实例；用完请调用 `close()`（原生下很轻，Electron 下是一次 worker 关闭）。

## 转写行为

Qwen3-ASR 的输出以 `<asr_text>` 标记开头，包只保留其后的文本。`maxNewTokens` 取 64，刻意低于 sherpa 运行时 65 token 的重复保护线，好让包自己的退化检测先触发。

满足下面任一条即算退化：

- 返回的 token 数达到 `maxNewTokens`（64）；
- 文本过度重复：去掉空白、标点与符号后，某个 1–8 字符的单元至少重复 8 次，且覆盖至少一半文本（不足 32 字符的文本不会触发）。

退化结果会通过二分重试：

1. 片段一分为二，两半各自递归转写；
2. 递归最多两层，短于 4 秒（64 000 采样）的片段不再切分；
3. 拼接时只有在接缝既不是汉字也不是标点时才补一个空格；
4. 到极限仍然退化的结果会被丢弃——**不发 `result`**，但该片段的 `speechstart` / `speechend` 照常送达。

这套重试只针对 Qwen3 识别器，作用是避免长片段因为其中一半退化而整段丢失内容。

## 说话人与声纹

说话人跟踪默认开启；`speaker: false` 会完全跳过声纹模型（不下载、不提取）。

| 选项               | 默认值 | 含义                                   |
| ------------------ | ------ | -------------------------------------- |
| `speaker`          | `[]`   | 已注册的声纹，`{ name, file }`         |
| `speakerThreshold` | `0.6`  | 接受某个中心的余弦相似度阈值           |
| `maxSpeakers`      | `8`    | 动态说话人上限；注册声纹不占用这个额度 |

```ts
const asr = new ASR({
  modelsPath: '/path/to/models',
  speaker: [{ name: 'alice', file: './voiceprints/alice.voiceprint' }],
  speakerThreshold: 0.6,
  maxSpeakers: 8,
});
```

每个片段都会先提取声纹、归一化，再与最近的中心比余弦相似度。只要相似度达到阈值，注册中心就胜出，而且注册中心永不移动。否则该片段进入动态聚类：动态数量还没到 `maxSpeakers` 时新建一个标为 `speaker_0`、`speaker_1`……的中心，已有的动态中心则用滑动平均更新，权重在 20 次更新后被封顶。`maxSpeakers` 用满之后，片段会被分给最近的中心，即使相似度低于阈值。

所以调高 `speakerThreshold` 更容易把相近的嗓音拆成两个人，调低则更容易合并。

`SpeakerProfile.name` 必须非空且唯一。`file` 会原样交给文件系统，因此相对路径是相对进程工作目录解析的——包不会拿它去对自己目录下的 `voiceprints/`。向量维数必须与说话人模型一致（3D-Speaker ERes2Net base 记录为 192）；维数不对、文件损坏、名字为空或重名，都会在构造跟踪器时报错。

声纹用一个小型自定义二进制格式：

```text
magic "CIELVP01" + uint32 dimensions + float32[] embedding
```

读取时会校验 magic 与长度，然后重新归一化，因此被截断或来自别处的文件无法冒充合法声纹。

### 生成声纹

```bash
vp run @cieljs/hearing#voiceprint -- --models-path ./models --output alice.voiceprint 1.wav 2.wav 3.wav
```

`--models-path` 与 `--output` 都是必填，位置参数必须都是 16 kHz 且长到足以产出向量的 WAV。每个文件独立提取向量，再平均并归一化成一份声纹，命令最后在 stdout 打出一行 JSON：

```json
{
  "type": "voiceprint",
  "output": "…/voiceprints/alice.voiceprint",
  "samples": 3,
  "dimensions": 192
}
```

`dimensions` 由说话人模型自己报告（3D-Speaker ERes2Net base 记录为 192）。缺少 `--output`、缺少 `--models-path` 或没有样本时会以退出码 2 结束并在 stderr 给出提示。生成声纹之前必须先装好说话人模型。

## 多模型

`ASR_MODELS` 是可选的识别模型注册表：

| 模型 id               | 音频事件 | 安装位置                   |
| --------------------- | -------- | -------------------------- |
| `qwen3-asr-1.7b-int8` | 无       | `asr/qwen3-asr-1.7b-int8/` |
| `sensevoice-small`    | 有       | `asr/sensevoice-small/`    |

`DEFAULT_ASR_MODEL` 是 `qwen3-asr-1.7b-int8`。用 `model` 选择，用 `ASRResult.model` 判断某条结果是哪个模型产出的。

```ts
import { ASR_MODELS, createASR, createKWS } from '@cieljs/hearing';

console.log(Object.keys(ASR_MODELS));

await using asr = await createASR({
  modelsPath: '/path/to/models',
  model: 'sensevoice-small',
  speaker: false,
});
asr.on('result', result => console.log(result));
await asr.write({ data: pcm, sampleRate: 48_000, channels: 2, startAt: new Date() });
await asr.flush();
```

`createASR(options, prepare?)` 会按选项装好所需资源，并先跑一次 `flush()` 把实例预热；`prepare` 用来传安装器参数（`force`、`retries`、`retryDelayMs`、`onProgress`）。文件已经在手上的同步调用方，直接用 `new ASR(options)`。

运行时换模型：

```ts
await asr.setModel('sensevoice-small');
```

`setModel()` 先构建新识别器，所以失败时旧模型照常工作。之后它会等旧模型处理完尾部，再沿用已有的事件订阅与说话人跟踪。Electron 下这次切换按 worker 命令顺序排队，因此与音频写入保持有序。在 `mode: 'events'` 下选一个不支持音频事件的模型会抛错。

### PCM 输入与背压

PCM 是交错的 `s16le`；`sampleRate` 默认 16000、`channels` 默认 1，所以常见情况两者都可以不写。重采样会跨块保留插值位置，因此块边界不会累积漂移。不先 flush 就改 `sampleRate` 或 `channels` 会抛 `Flush before changing PCM format`，并且 `data` 必须包含完整的帧。

`write()` 要 await。Electron 下和唤醒门控模式下它返回 promise，上一次写入还没结束就继续送音频会被拒绝（`Await write() before sending more audio`）。队列溢出同样被拒绝，而不是无上限地缓冲（`Hearing worker queue is full; await write()`）。输入时间戳必须连续，遇到不连续的流请先 flush。

### SenseVoice 结果与音频事件

SenseVoice 的结果保留 `content`，还可能带上 `language`、`emotion` 和 `events: { type: string }[]`，统一转成小写（`zh`、`happy`、`applause`）。标签优先取自 sherpa 暴露的运行时字段，否则从原始文本的 `<|...|>` 标签里解析；两种形式都接受。不会凭空编造置信度，也不会编造事件边界。参考：[sherpa SenseVoice 实现](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-recognizer-sense-voice-impl.h)。

默认的 `mode: 'transcription'` 下，音频仍然由 VAD 把关。想对音乐、掌声这类非语音声音做出反应，就选 `mode: 'events'`：

```ts
await using asr = await createASR({
  modelsPath: '/path/to/models',
  model: 'sensevoice-small',
  mode: 'events',
  eventWindowSeconds: 5,
});
```

事件模式丢掉 VAD，连续转写一个个 `eventWindowSeconds` 窗口，因此纯事件的 `content` 可能是空的。窗口边缘、静音和很短的尾部仍可能产生误报标签，而且报告的时间跨度是输入窗口，不是声音本身的精确边界。

### 独立关键词唤醒

`KWS` 不依赖 ASR 文本，自己检测关键词并发出 `wake` 事件：

```ts
await using kws = await createKWS({
  modelsPath: '/path/to/models',
  keywords: ['你好夏尔'],
  cooldownMs: 1500,
});
const unsubscribe = kws.on('wake', ({ keyword, at }) => console.log(keyword, at));
await kws.write({ data: pcm16k, startAt: new Date() });
await kws.flush();
unsubscribe();
```

| 选项         | 默认值 | 含义                                         |
| ------------ | ------ | -------------------------------------------- |
| `keywords`   | —      | 必填且非空；字符串或 `{ text, tokens }` 对象 |
| `cooldownMs` | `1500` | 重复唤醒事件的抑制窗口                       |
| `threshold`  | `0.25` | 关键词检测阈值                               |
| `score`      | `1`    | 关键词得分                                   |
| `modelPath`  | —      | 本地模型目录；设置后跳过默认下载             |

`WakeEvent.at` 是关键词起点映射到输入音频时间轴上的位置，不是事件发出的墙上时间。中文关键词通过 `pinyin-pro` 转成带声调的声母/韵母 token；遇到多音字或特殊词可以显式传 `{ text: '法国', tokens: ['f', 'ǎ', 'g', 'uó'] }`。模型词表里没有的 token 会让初始化直接失败，空关键词列表也会被拒绝。默认模型是中文 Zipformer WenetSpeech 3.3M，不承诺其它语言。音频按 1600 采样一块解码，长录音也不会把前面的命中藏起来；`flush()` 会补一秒静音、排空尾部并开始全新的检测流。模型参考：[sherpa KWS 预训练模型](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html)。

### 唤醒门控

在 `ASROptions` 里设置 `wake`，ASR 会保持空闲直到 KWS 命中：

```ts
await using asr = await createASR({
  modelsPath: '/path/to/models',
  model: 'sensevoice-small',
  speaker: false,
  wake: {
    keywords: ['你好夏尔'],
    preRollMs: 1500,
    maxListenMs: 15000,
  },
});
asr.on('wake', event => console.log(event));
asr.on('result', result => console.log(result.content));
await asr.write({ data: pcm16k, startAt: new Date() });
```

空闲期间只有 KWS 在跑。命中后，最近 `preRollMs` 的音频会被保留并回放给 ASR，所以命令的开头不会被切掉。一个 VAD 片段结束、或超过 `maxListenMs` 之后，ASR 回到待机，这个模式下 `write()` 必须 await。连续监听（比如直播）不该设置 `wake`。`WakeOptions` 就是去掉 `modelsPath` 的 `KWSOptions`，另加 `preRollMs`（默认 1500，取值 0–30000）和 `maxListenMs`（默认 15000）。门控产生的 KWS 错误与 ASR 错误走同一个 `error` 事件。`createASR()` 会在 `wake.modelPath` 缺失时安装 KWS 模型；用 `new ASR(options)` 并带 `wake` 时，KWS 文件必须已经存在。

## 模型配置与 CLI

包的脚本都跑同一个 CLI 入口（`src/cli/index.ts`，导出为 `./ciel`）：

| 脚本             | 命令                                      |
| ---------------- | ----------------------------------------- |
| `dev`            | `oxnode ./src/cli/index.ts`               |
| `install-model`  | `oxnode ./src/cli/index.ts install-model` |
| `voiceprint`     | `oxnode ./src/cli/index.ts voiceprint`    |
| `check`          | `vp check`                                |
| `prepublishOnly` | `vp run build`                            |

在 workspace 里调用：

```bash
vp run @cieljs/hearing#install-model -- --models-path ./models
vp run @cieljs/hearing#install-model -- --models-path ./models --force
vp run @cieljs/hearing#install-model -- --models-path ./models --model sensevoice-small --no-speaker
vp run @cieljs/hearing#install-model -- --models-path ./models --kws
vp run @cieljs/hearing#voiceprint -- --models-path ./models --output alice.voiceprint 1.wav 2.wav 3.wav
```

两个命令都必须给 `--models-path`。命令名前后多出的 `--` 会被忽略，所以 `vp run @cieljs/hearing#dev -- install-model --models-path ./models` 效果相同。

### `install-model`

| 参数                  | 类型    | 默认值                | 含义                   |
| --------------------- | ------- | --------------------- | ---------------------- |
| `--models-path <dir>` | string  | —（必填）             | 所有模型文件的目标目录 |
| `--model <id>`        | string  | `qwen3-asr-1.7b-int8` | `ASR_MODELS` 的键      |
| `--kws`               | boolean | `false`               | 改为安装 KWS 唤醒模型  |
| `--no-speaker`        | boolean | `false`               | 跳过说话人模型         |
| `--force`             | boolean | `false`               | 重新下载已存在的文件   |
| `-h, --help`          | boolean | `false`               | 打印用法               |

不加 `--no-speaker` 时，VAD 与说话人模型会和 ASR 模型一起装；走库的方式时，选 `mode: 'events'` 也会跳过 VAD。运行器会为每个文件打印一行 `Downloading <file>` 和进度条，最后打印 `ASR models installed in <dir>`。

### `voiceprint`

| 参数                    | 类型    | 默认值    | 含义                 |
| ----------------------- | ------- | --------- | -------------------- |
| `--models-path <dir>`   | string  | —（必填） | 含 `speaker/` 的目录 |
| `--output <file>`, `-o` | string  | —（必填） | 要写入的声纹文件     |
| `-h, --help`            | boolean | `false`   | 打印用法             |

位置参数是一个或多个 16 kHz WAV 文件，输出就是上面那一行 JSON。

### 模型放在哪里

`modelsPath` 归调用者。包只读它拿到的目录，也只往那个路径里安装；Blive Agent 与 Voice Agent 传的是各自数据目录下的 `join(dataDir, 'models')`，声纹路径同样由这一层决定。包的 `.gitignore` 排除了 `/models/` 与 `voiceprints`，所以两者都不会被提交。KWS 模型落在 `<modelsPath>/kws/<model>/`，安装时会调用系统的 `tar` 并用 `-xOf` 把固定的归档成员读到 stdout——归档里的路径和符号链接永远不会写到文件系统上。

### 运行时模型配置

各种配置在包内生成，公共 API 里不出现任何 sherpa 类型。

| 管线       | 配置                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen3-ASR  | `maxTotalLen 512`、`maxNewTokens 64`、`temperature 1e-6`、`topP 0.8`、`seed 42`、空 hotwords、2 个 CPU 线程、特征维 80                             |
| SenseVoice | `language: 'auto'`、`useInverseTextNormalization: 1`、2 个 CPU 线程、特征维 80                                                                     |
| VAD        | `threshold 0.25`、`minSpeechDuration 0.5 秒`、`minSilenceDuration`（默认 0.5 秒）、`maxSpeechDuration`（默认 10 秒）、窗口 256 采样、1 个 CPU 线程 |
| Speaker    | 1 个 CPU 线程，CPU provider                                                                                                                        |
| KWS        | Zipformer WenetSpeech 3.3M、`numThreads 1`、`numTrailingBlanks 1`、`maxActivePaths 4`、特征维 80                                                   |

`checkConfiguration()` 检查所选选项需要的文件是否存在且非空：

```ts
import { checkConfiguration } from '@cieljs/hearing';

const check = await checkConfiguration({ modelsPath: '/path/to/models' });
// { modelsPath, missingFiles, valid }
```

`installModels(options)` 做同样的选择并返回 `modelsPath`；`installKWSModels(options)` 返回 KWS 模型目录。

### 运维说明

- 运行时不需要 Python：推理用 `sherpa-onnx-node` 的预编译原生绑定，下载用普通 `fetch`，只有安装 KWS 时需要系统的 `tar`。
- Electron 下每个 `ASR`/`KWS` 都有自己的 Node 进程（`./worker`），可用 `CIEL_NODE_EXECUTABLE` 覆盖（默认 `node`）。worker 崩溃、请求超时（120 秒）或队列饱和都会以 `error` 出现；`close()` 会等进程退出，5 秒后强杀。
- 选项在原生后端里校验，所以在 Electron 下非法选项会通过 worker 失败的 `init` 从 `error` 事件冒出来，而不是从构造函数抛出。
- 原生 sherpa 句柄由绑定的 GC finalizer 回收；本包在 `close()` 时释放自己持有的引用。
- Qwen3-ASR 的下载量记录为约 2.4 GB，预编译的 Windows Node 绑定记录为 CPU 推理。
- 商用前请自行确认每个上游模型的许可。

## API 参考

### `@cieljs/hearing`

| 导出                                                                                                                                                                                                                                                                        | 类型      | 说明                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `ASR`                                                                                                                                                                                                                                                                       | class     | `NativeASR`/`ProcessASR` 之上的门面：`write`、`flush`、`setModel`、`on`、`close`、`[Symbol.asyncDispose]` |
| `NativeASR`                                                                                                                                                                                                                                                                 | class     | 原生后端；worker 实例化的也是它                                                                           |
| `createASR(options, prepare?)`                                                                                                                                                                                                                                              | function  | 装好所需资源，再构造并预热一个 `ASR`                                                                      |
| `KWS`                                                                                                                                                                                                                                                                       | class     | 关键词检测器，生命周期与 `ASR` 相同                                                                       |
| `createKWS(options, prepare?)`                                                                                                                                                                                                                                              | function  | 未给 `modelPath` 时先装 KWS 模型，再构造 `KWS`                                                            |
| `installModels(options)`                                                                                                                                                                                                                                                    | function  | 安装 ASR + VAD + 说话人文件；返回 `modelsPath`                                                            |
| `installKWSModels(options)`                                                                                                                                                                                                                                                 | function  | 安装 KWS 模型；返回其目录                                                                                 |
| `checkConfiguration(options)`                                                                                                                                                                                                                                               | function  | `{ modelsPath, missingFiles, valid }`                                                                     |
| `ASR_MODELS` / `DEFAULT_ASR_MODEL`                                                                                                                                                                                                                                          | constants | 模型注册表，以及 `qwen3-asr-1.7b-int8`                                                                    |
| `ASROptions`, `ASRSegment`, `ASRResult`, `ASRToken`, `ASREventMap`, `ASRStream`, `AudioEvent`, `SpeakerProfile`, `Unsubscribe`, `ASRModelId`, `KWSOptions`, `KWSEventMap`, `WakeEvent`, `WakeOptions`, `ConfigurationCheck`, `InstallModelsOptions`, `ModelInstallProgress` | types     | 完整的公共类型面                                                                                          |

留在内部不导出的辅助：`keywordTokens()`（拼音转 KWS token）、声纹的读写与归一化函数，以及各识别器实现。它们都不从主入口导出。

### `@cieljs/hearing/ciel`

CLI 入口（`dist/ciel.mjs`，由 `src/cli/index.ts` 构建）。命令有 `install-model` 与 `voiceprint`；`help`、`--help`、`-h` 打印用法，未知命令打印用法并以退出码 2 结束。这是程序入口，不是库接口。

### `@cieljs/hearing/worker`

Electron 后端拉起的 Node 进程（`dist/worker.mjs`，由 `src/worker.ts` 构建）。它在 stdin/stdout 上说按行分隔的 JSON：

| 方向 | 消息                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 命令 | `init`（`kind: 'asr' \| 'kws'`）、`write`（base64 PCM、ISO `startAt`，可选 `sampleRate`/`channels`/`format`）、`set-model`、`flush`、`close`——每条都带 `id` |
| 事件 | `ack`（`id`，可选 `error`）、`result`、`wake`、`speechstart`、`speechend`                                                                                   |

请求都有 ack，所以调用方可以 await；`init` 失败会把 worker 标记为致命并拒绝所有挂起的请求。不建议应用直接使用。

### `@cieljs/hearing/package.json`

给需要包元数据的工具读取原始 manifest。

## 开发

```bash
vp check        # 格式化、lint 与类型检查
vp test --run   # 测试
vp run build    # vp pack -> dist（index、worker、ciel）
```

测试在 `tests/**/*.test.ts`，用模块替身换掉 `sherpa-onnx-node`，因此既不用下载模型，也不需要真实音频设备。`test` 任务把 `CIEL_NODE_EXECUTABLE` 声明为环境输入，`build` 则依赖 dependencies 里的同一个任务。`./worker` 必须保持为独立的 ESM 入口，因为 Electron 后端是把它当文件拉起的。

使用方：[`@cieljs/perception`](../perception/README.zh-CN.md) 包装 `ASR` 来加视觉采样与 Agent 快照，而 `apps/blive-agent` 与 `apps/voice-agent` 各自在自己的数据目录里决定 `modelsPath` 和声纹布局。
