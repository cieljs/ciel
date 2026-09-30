<h1 align="center">@cieljs/hearing</h1>

<p align="center">Streaming speech perception in pure Node: PCM buffering, VAD segmentation, offline transcription, segment timestamps and speaker recognition on top of sherpa-onnx.</p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="#overview">Overview</a> ·
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#events--timestamps">Events &amp; timestamps</a> ·
  <a href="#segmentation-vad-options">Segmentation</a> ·
  <a href="#transcription-behavior">Transcription</a> ·
  <a href="#speakers--voiceprints">Speakers</a> ·
  <a href="#multiple-models">Multiple models</a> ·
  <a href="#model-configuration--cli">Model config &amp; CLI</a> ·
  <a href="#api-reference">API reference</a> ·
  <a href="#development">Development</a>
</p>

## Overview

`@cieljs/hearing` does speech perception entirely in Node through [`sherpa-onnx-node`](https://github.com/k2-fsa/sherpa-onnx). Three pipelines share one event stream: TEN-VAD cuts the PCM buffer into speech segments, the ASR model transcribes every finished segment, and 3D-Speaker ERes2Net base extracts voiceprints and clusters them into speakers. The default recognizer is Qwen3-ASR 1.7B INT8.

Audio arrives as 16 kHz mono signed 16-bit little-endian PCM (`s16le`); other sample rates and channel counts are resampled inside the package. Timing stops at the VAD segment — there are no word-level timestamps and no confidence — and every timestamp is derived from the `startAt` the caller supplies, so the package never reads the system clock.

`ASR` is a facade over the backend. Plain Node talks to the native binding directly, and under Electron the same API moves inference into a separate Node process with identical event semantics. Two runtimes are exported: `ASR` (transcription, speakers, optional wake gating) and `KWS` (standalone keyword spotting). Voiceprints are binary assets that live outside the codebase and are produced by the CLI, and [`@cieljs/perception`](../perception/README.md) builds on this package to add vision sampling and agent snapshots.

## Install

```bash
vp install   # or: pnpm install
```

`sherpa-onnx-node` (prebuilt native binding) and `pinyin-pro` are ordinary dependencies, so there is no Python and no manual ONNX runtime to set up.

Models are never bundled. They are downloaded into the directory the caller passes as `modelsPath`, and both the location and the lifecycle stay with the caller:

| Directory                                                    | Model                           | Source                                                            |
| ------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------- |
| `asr/qwen3-asr-1.7b-int8/`                                   | Qwen3-ASR 1.7B INT8 + tokenizer | ModelScope `zengshuishui/Qwen3-ASR-onnx` (community conversion)   |
| `asr/sensevoice-small/`                                      | SenseVoiceSmall INT8 + tokens   | ModelScope `pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue` |
| `vad/ten-vad.int8.onnx`                                      | TEN-VAD                         | sherpa-onnx GitHub release (`asr-models`)                         |
| `speaker/model.onnx`                                         | 3D-Speaker ERes2Net base        | sherpa-onnx GitHub release (`speaker-recongition-models`)         |
| `kws/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01/` | Zipformer WenetSpeech KWS 3.3M  | sherpa-onnx GitHub release (`kws-models`)                         |

The files can be fetched in three ways:

```bash
# 1. CLI
vp run @cieljs/hearing#install-model -- --models-path ./models
```

```ts
// 2. explicit install
import { installModels } from '@cieljs/hearing';
await installModels({ modelsPath: './models' });

// 3. the factories install what the selected options need, then construct
import { createASR, createKWS } from '@cieljs/hearing';
```

Existing non-empty files are skipped unless `force` is set (`--force` on the CLI).

> [!NOTE]
> Downloads use plain `fetch` with `.part` temp files and a rename on success, 2 retries by default (`retries`, `retryDelayMs`) and a 30 s connect / 30 min transfer timeout. Within one process, concurrent installs of the same resolved target share a single download.

## Quick start

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

`write()` takes one PCM chunk plus the time that chunk started at, and `flush()` drains the buffer and emits the last segment. Nothing is thrown out of either call: malformed PCM, a full buffer and a broken worker all surface on the `error` event.

When the files are not on disk yet, use the async factory instead. It installs first and hands back a primed instance, and `ASR` and `KWS` both implement `AsyncDisposable`, so `await using` closes it for you:

```ts
import { createASR } from '@cieljs/hearing';

await using asr = await createASR({
  modelsPath: '/path/to/models',
  model: 'sensevoice-small',
});
```

## Events & timestamps

`ASR` emits five events:

| Event         | Payload     | Meaning                                                        |
| ------------- | ----------- | -------------------------------------------------------------- |
| `wake`        | `WakeEvent` | wake gating is configured and a keyword was detected           |
| `speechstart` | `Date`      | segment started                                                |
| `result`      | `ASRResult` | recognized text, plus language/emotion/events and speaker      |
| `speechend`   | `Date`      | segment finished, including segments that produced no `result` |
| `error`       | `Error`     | bad input, full buffer, model failure or worker failure        |

`on()` returns an unsubscribe function. `speechstart` and `speechend` fire for every VAD segment; `result` fires only when the backend produced text or audio events.

An `ASRResult` carries these fields:

| Field                   | Type                     | Notes                                                                              |
| ----------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `content`               | `string`                 | text with the `<asr_text>` prefix (Qwen3) or `<\|...\|>` tags (SenseVoice) removed |
| `model`                 | `ASRModelId?`            | which model produced this segment; older persisted results may lack it             |
| `language` / `emotion`  | `string?`                | SenseVoice only                                                                    |
| `events`                | `readonly AudioEvent[]?` | SenseVoice only, each `{ type: string }`                                           |
| `speaker`               | `string?`                | registered name, or `speaker_N`; only assigned when there is text                  |
| `startAt` / `endAt`     | `Date`                   | segment bounds                                                                     |
| `confidence` / `tokens` | optional                 | part of the contract, never populated by the current models                        |

Timestamps come from the stream start plus sample offsets:

| Timestamp        | Derivation                          |
| ---------------- | ----------------------------------- |
| `speechstart`    | stream start + segment start sample |
| `result.startAt` | segment start sample                |
| `result.endAt`   | segment end sample                  |
| `speechend`      | segment end sample                  |

The `startAt` of the first `write()` fixes the stream start for the whole stream.

> [!WARNING]
> No word-level timestamps. Qwen3-ASR and SenseVoice provide segment-level alignment only, so `tokens` stays empty. Do not build subtitle timing on `tokens`.

## Segmentation (VAD options)

VAD runs by default (`mode: 'transcription'`). TEN-VAD is advanced in 256-sample windows (16 ms at 16 kHz), and every finished segment is transcribed immediately.

| Option                   | Default           | Meaning                                                                  |
| ------------------------ | ----------------- | ------------------------------------------------------------------------ |
| `bufferSeconds`          | `30`              | circular buffer capacity in seconds — a capacity, not an analysis window |
| `vad.minSilenceDuration` | `0.5`             | silence, in seconds, that closes the current segment                     |
| `vad.maxSpeechDuration`  | `10`              | hard cap on one segment, in seconds                                      |
| `mode`                   | `'transcription'` | `'events'` bypasses VAD entirely                                         |
| `eventWindowSeconds`     | `5`               | window length used by `mode: 'events'`                                   |

`minSpeechDuration` (0.5 s) and the VAD threshold (0.25) are fixed inside the package and are not exposed as options.

`bufferSeconds` is how much PCM can be queued, and a full buffer raises `ASR circular buffer is full` instead of silently dropping samples. Speaker analysis is not bounded by it: 3D-Speaker runs on the VAD segments themselves, and a segment shorter than 3 s is zero-padded up to the extractor minimum.

Wider segmentation (larger `minSilenceDuration`, larger `maxSpeechDuration`) cuts sentences less often, but it adds latency and may merge different speakers into one segment. Validate against real audio instead of tuning by feel.

Callers override per use case. Omitting `vad` keeps the 0.5 s / 10 s defaults; Blive Agent overrides to `{ minSilenceDuration: 0.2, maxSpeechDuration: 5 }` with `bufferSeconds: 30`, because a live stream has to keep up with the room (see `apps/blive-agent/src/main/application.ts`).

Invalid options are rejected when the backend is constructed:

| Rule                                                                                 | Error                                                           |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| every provided `vad.*` value is finite and > 0                                       | `vad.<name> must be a positive number`                          |
| when `vad` is provided: `maxSpeechDuration + minSilenceDuration <= bufferSeconds`    | `VAD speech and silence durations must fit in the audio buffer` |
| `bufferSeconds >= 256 / 16000`                                                       | `bufferSeconds must hold at least one 256-sample VAD window`    |
| `Math.round(eventWindowSeconds * 16000) >= 1`, and `<= bufferSeconds` in events mode | `eventWindowSeconds must fit in the audio buffer`               |
| `speakerThreshold` within `(0, 1]`                                                   | `speakerThreshold must be greater than 0 and at most 1`         |
| `maxSpeakers` is a positive integer                                                  | `maxSpeakers must be a positive integer`                        |

`flush()` zero-pads the samples still in the buffer to a full window, runs them through VAD, emits the final segment, then resets VAD, buffer and stream start — the next `write()` begins a new stream. It does not close the instance; call `close()` when you are done (a cheap operation natively, a worker shutdown under Electron).

## Transcription behavior

Qwen3-ASR output starts with an `<asr_text>` marker and the package keeps only the text after it. `maxNewTokens` is 64, deliberately below the sherpa runtime's 65-token repetition guard, so the package's own degenerate detection trips first.

A result counts as degenerate when either:

- the returned token count reaches `maxNewTokens` (64), or
- the transcript over-repeats: after whitespace, punctuation and symbols are stripped, a 1–8 character unit repeats at least 8 times and covers at least half of the transcript (transcripts under 32 characters never trigger this).

Degenerate results are re-run by binary splitting:

1. the segment is halved and each half is transcribed recursively;
2. recursion stops after 2 levels, and segments shorter than 4 s (64 000 samples) are not split again;
3. joined parts are separated by a space only when the seam is neither Han text nor punctuation;
4. a result that is still degenerate at the limit is dropped — **no `result` is emitted**, although `speechstart`/`speechend` for that segment are still delivered.

This retry logic is specific to the Qwen3 recognizer, and it keeps long segments from losing all of their content to one degenerate half.

## Speakers & voiceprints

Speaker tracking is on by default; `speaker: false` skips the voiceprint model entirely (no download, no extraction).

| Option             | Default | Meaning                                                        |
| ------------------ | ------- | -------------------------------------------------------------- |
| `speaker`          | `[]`    | registered profiles, `{ name, file }`                          |
| `speakerThreshold` | `0.6`   | cosine similarity threshold for accepting a center             |
| `maxSpeakers`      | `8`     | cap on dynamic speakers; registered profiles do not consume it |

```ts
const asr = new ASR({
  modelsPath: '/path/to/models',
  speaker: [{ name: 'alice', file: './voiceprints/alice.voiceprint' }],
  speakerThreshold: 0.6,
  maxSpeakers: 8,
});
```

Each segment is embedded, normalized, and compared by cosine similarity against the closest center. A registered center wins whenever similarity is at least the threshold, and registered centers never move. Otherwise the segment joins dynamic clustering: a new center labelled `speaker_0`, `speaker_1`, … is created while the dynamic count is below `maxSpeakers`, and existing dynamic centers are updated with a moving average whose weight is capped after 20 updates. When `maxSpeakers` is exhausted the segment is assigned to the closest center even though it is below the threshold.

A higher `speakerThreshold` therefore tends to split similar voices into separate speakers; a lower one merges them.

`SpeakerProfile.name` must be non-empty and unique. `file` is passed to the filesystem as given, so a relative path resolves against the process working directory — the package does not resolve it against its own `voiceprints/` folder. The embedding dimension must match the speaker model (documented as 192 for 3D-Speaker ERes2Net base); a wrong dimension, a corrupt file, an empty name or a duplicate name throws while the tracker is being constructed.

Voiceprints use a small custom binary format:

```text
magic "CIELVP01" + uint32 dimensions + float32[] embedding
```

Reads verify the magic and the length, then re-normalize, so a truncated or foreign file cannot pass as a valid voiceprint.

### Generating voiceprints

```bash
vp run @cieljs/hearing#voiceprint -- --models-path ./models --output alice.voiceprint 1.wav 2.wav 3.wav
```

`--models-path` and `--output` are required, and every positional must be a 16 kHz WAV long enough to produce an embedding. Each file is embedded independently; the embeddings are averaged and normalized into one voiceprint, and the command prints one JSON line on stdout:

```json
{
  "type": "voiceprint",
  "output": "…/voiceprints/alice.voiceprint",
  "samples": 3,
  "dimensions": 192
}
```

`dimensions` is reported by the speaker model itself (documented as 192 for 3D-Speaker ERes2Net base). Missing `--output`, missing `--models-path` or no samples exits with code 2 and a message on stderr. The speaker model has to be installed before voiceprints can be generated.

## Multiple models

`ASR_MODELS` is the registry of selectable recognition models:

| Model id              | Audio events | Installed under            |
| --------------------- | ------------ | -------------------------- |
| `qwen3-asr-1.7b-int8` | no           | `asr/qwen3-asr-1.7b-int8/` |
| `sensevoice-small`    | yes          | `asr/sensevoice-small/`    |

`DEFAULT_ASR_MODEL` is `qwen3-asr-1.7b-int8`. Pass `model` to choose, and read `ASRResult.model` to know which model produced a given result.

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

`createASR(options, prepare?)` installs the resources the options require and primes the instance with one `flush()`; `prepare` carries the installer knobs (`force`, `retries`, `retryDelayMs`, `onProgress`). Synchronous callers that already have the files use `new ASR(options)`.

Switching models at runtime:

```ts
await asr.setModel('sensevoice-small');
```

`setModel()` builds the new recognizer first, so a failure leaves the old model working. It then lets the old model finish the tail and continues with the existing event subscriptions and speaker tracking. Under Electron the switch is queued in worker-command order, so it stays ordered with audio writes. Selecting a model without audio-event support while `mode: 'events'` throws.

### PCM input and back-pressure

PCM is interleaved `s16le`; `sampleRate` defaults to 16000 and `channels` to 1, so the common case omits both. Resampling keeps its interpolation position across chunks, so chunk boundaries do not accumulate drift. Changing `sampleRate` or `channels` without flushing first throws `Flush before changing PCM format`, and `data` must contain whole frames.

Await `write()`. Under Electron and in wake-gate mode it returns a promise, and sending more audio before the previous write settles is rejected (`Await write() before sending more audio`). Queue overflow is rejected rather than buffered without bound (`Hearing worker queue is full; await write()`). Input timestamps must stay continuous, so flush before feeding a discontinuous stream.

### SenseVoice results and audio events

SenseVoice results keep `content` and may add `language`, `emotion` and `events: { type: string }[]`, normalized to lowercase (`zh`, `happy`, `applause`). Labels come from the runtime fields when sherpa exposes them and from `<|...|>` tags in the raw text otherwise; the parser accepts either form. No confidence values and no exact event boundaries are invented. Reference: [sherpa SenseVoice implementation](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-recognizer-sense-voice-impl.h).

With the default `mode: 'transcription'`, VAD still gates the audio. To react to non-speech sounds such as music or applause, select `mode: 'events'`:

```ts
await using asr = await createASR({
  modelsPath: '/path/to/models',
  model: 'sensevoice-small',
  mode: 'events',
  eventWindowSeconds: 5,
});
```

Events mode drops VAD and transcribes continuous `eventWindowSeconds` windows, so `content` may be empty for a pure event. Window edges, silence and very short tails can still produce spurious labels, and the reported time span is the input window, not the exact boundary of the sound.

### Standalone keyword spotting

`KWS` detects keywords independently of ASR text and emits a `wake` event:

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

| Option       | Default | Meaning                                                    |
| ------------ | ------- | ---------------------------------------------------------- |
| `keywords`   | —       | required, non-empty; strings or `{ text, tokens }` objects |
| `cooldownMs` | `1500`  | suppression window for repeated wake events                |
| `threshold`  | `0.25`  | keyword spotting threshold                                 |
| `score`      | `1`     | keyword score                                              |
| `modelPath`  | —       | local model directory; skips the default download          |

`WakeEvent.at` is the keyword start mapped onto the input audio timeline, not the clock time at which the event was emitted. Chinese keywords are converted with `pinyin-pro` into toned initial/final tokens; pass `{ text: '法国', tokens: ['f', 'ǎ', 'g', 'uó'] }` when polyphones or unusual words need explicit tokens. A token missing from the model vocabulary aborts initialization, and an empty keyword list is rejected. The default model is a Chinese Zipformer WenetSpeech 3.3M model and makes no promise about other languages. Audio is decoded in 1600-sample blocks so a long recording cannot hide earlier hits; `flush()` appends one second of silence, drains the tail and starts a fresh detection stream. Model reference: [sherpa KWS pretrained models](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html).

### Wake gating

Setting `wake` in `ASROptions` keeps ASR idle until KWS fires:

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

While idle only KWS runs. The last `preRollMs` of audio is retained and replayed to ASR after a hit, so the beginning of the command is not cut off. ASR returns to standby when a VAD segment ends or after `maxListenMs`, and `write()` must be awaited in this mode. Continuous listening (a livestream) should not set `wake` at all. `WakeOptions` is `KWSOptions` without `modelsPath`, plus `preRollMs` (default 1500, must be within 0–30000) and `maxListenMs` (default 15000). KWS errors from the gate are wired into the same `error` event as ASR errors. `createASR()` installs the KWS model when `wake.modelPath` is absent; `new ASR(options)` with `wake` requires the KWS files to already exist.

## Model configuration & CLI

All package scripts run the same CLI entry (`src/cli/index.ts`, exported as `./ciel`):

| Script           | Command                                   |
| ---------------- | ----------------------------------------- |
| `dev`            | `oxnode ./src/cli/index.ts`               |
| `install-model`  | `oxnode ./src/cli/index.ts install-model` |
| `voiceprint`     | `oxnode ./src/cli/index.ts voiceprint`    |
| `check`          | `vp check`                                |
| `prepublishOnly` | `vp run build`                            |

Workspace invocation:

```bash
vp run @cieljs/hearing#install-model -- --models-path ./models
vp run @cieljs/hearing#install-model -- --models-path ./models --force
vp run @cieljs/hearing#install-model -- --models-path ./models --model sensevoice-small --no-speaker
vp run @cieljs/hearing#install-model -- --models-path ./models --kws
vp run @cieljs/hearing#voiceprint -- --models-path ./models --output alice.voiceprint 1.wav 2.wav 3.wav
```

`--models-path` is required by both commands. A leading `--` before or after the command name is ignored, so `vp run @cieljs/hearing#dev -- install-model --models-path ./models` behaves the same.

### `install-model`

| Flag                  | Type    | Default               | Meaning                               |
| --------------------- | ------- | --------------------- | ------------------------------------- |
| `--models-path <dir>` | string  | — (required)          | target directory for every model file |
| `--model <id>`        | string  | `qwen3-asr-1.7b-int8` | key of `ASR_MODELS`                   |
| `--kws`               | boolean | `false`               | install the KWS wake model instead    |
| `--no-speaker`        | boolean | `false`               | skip the speaker model                |
| `--force`             | boolean | `false`               | re-download files that already exist  |
| `-h, --help`          | boolean | `false`               | print usage                           |

Without `--no-speaker` the VAD and speaker models are installed alongside the ASR model; through the library, a `mode: 'events'` selection also skips VAD. The runner prints a `Downloading <file>` line per file plus a progress bar, then `ASR models installed in <dir>`.

### `voiceprint`

| Flag                    | Type    | Default      | Meaning                         |
| ----------------------- | ------- | ------------ | ------------------------------- |
| `--models-path <dir>`   | string  | — (required) | directory containing `speaker/` |
| `--output <file>`, `-o` | string  | — (required) | voiceprint file to write        |
| `-h, --help`            | boolean | `false`      | print usage                     |

Positionals are one or more 16 kHz WAV files, and the output is the single JSON line shown above.

### Where models live

`modelsPath` belongs to the caller. The package reads the directory it is given and installs only into that path; Blive Agent and Voice Agent pass `join(dataDir, 'models')` from their own data directory, and voiceprint paths are decided by the same layer. The package's `.gitignore` excludes `/models/` and `voiceprints`, so neither is ever committed. KWS models land in `<modelsPath>/kws/<model>/`, and installing them shells out to the system `tar` with `-xOf` to read fixed archive members into stdout — archive paths and symlinks are never written to the filesystem.

### Runtime model configuration

Configurations are generated inside the package, and no sherpa type appears in the public API.

| Pipeline   | Configuration                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen3-ASR  | `maxTotalLen 512`, `maxNewTokens 64`, `temperature 1e-6`, `topP 0.8`, `seed 42`, empty hotwords, 2 CPU threads, feature dim 80                          |
| SenseVoice | `language: 'auto'`, `useInverseTextNormalization: 1`, 2 CPU threads, feature dim 80                                                                     |
| VAD        | `threshold 0.25`, `minSpeechDuration 0.5 s`, `minSilenceDuration` (default 0.5 s), `maxSpeechDuration` (default 10 s), window 256 samples, 1 CPU thread |
| Speaker    | 1 CPU thread, CPU provider                                                                                                                              |
| KWS        | Zipformer WenetSpeech 3.3M, `numThreads 1`, `numTrailingBlanks 1`, `maxActivePaths 4`, feature dim 80                                                   |

`checkConfiguration()` verifies that the files the selected options need exist and are non-empty:

```ts
import { checkConfiguration } from '@cieljs/hearing';

const check = await checkConfiguration({ modelsPath: '/path/to/models' });
// { modelsPath, missingFiles, valid }
```

`installModels(options)` performs the same selection and returns `modelsPath`; `installKWSModels(options)` returns the KWS model directory.

### Operational notes

- No Python at runtime: inference is `sherpa-onnx-node`'s prebuilt native binding, downloads are plain `fetch`, and only the KWS install needs a system `tar`.
- Under Electron every `ASR`/`KWS` gets its own Node process (`./worker`), overridable with `CIEL_NODE_EXECUTABLE` (default `node`). Worker crashes, request timeouts (120 s) or a saturated queue surface as `error`; `close()` waits for the process to exit and force-kills it after 5 s.
- Options are validated in the native backend, so under Electron an invalid option surfaces through the worker's failed `init` on the `error` event instead of throwing from the constructor.
- Native sherpa handles are reclaimed by the binding's GC finalizer; this package releases the references it holds on `close()`.
- The Qwen3-ASR download is documented at roughly 2.4 GB, and the prebuilt Windows Node binding is documented as CPU inference.
- Confirm each upstream model license before commercial use.

## API reference

### `@cieljs/hearing`

| Export                                                                                                                                                                                                                                                                      | Kind      | Notes                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `ASR`                                                                                                                                                                                                                                                                       | class     | facade over `NativeASR`/`ProcessASR`: `write`, `flush`, `setModel`, `on`, `close`, `[Symbol.asyncDispose]` |
| `NativeASR`                                                                                                                                                                                                                                                                 | class     | native backend; also what the worker instantiates                                                          |
| `createASR(options, prepare?)`                                                                                                                                                                                                                                              | function  | installs the required resources, then constructs and primes an `ASR`                                       |
| `KWS`                                                                                                                                                                                                                                                                       | class     | keyword spotter with the same lifecycle as `ASR`                                                           |
| `createKWS(options, prepare?)`                                                                                                                                                                                                                                              | function  | installs the KWS model unless `modelPath` is given, then constructs a `KWS`                                |
| `installModels(options)`                                                                                                                                                                                                                                                    | function  | install ASR + VAD + speaker files; returns `modelsPath`                                                    |
| `installKWSModels(options)`                                                                                                                                                                                                                                                 | function  | install the KWS model; returns its directory                                                               |
| `checkConfiguration(options)`                                                                                                                                                                                                                                               | function  | `{ modelsPath, missingFiles, valid }`                                                                      |
| `ASR_MODELS` / `DEFAULT_ASR_MODEL`                                                                                                                                                                                                                                          | constants | model registry, and `qwen3-asr-1.7b-int8`                                                                  |
| `ASROptions`, `ASRSegment`, `ASRResult`, `ASRToken`, `ASREventMap`, `ASRStream`, `AudioEvent`, `SpeakerProfile`, `Unsubscribe`, `ASRModelId`, `KWSOptions`, `KWSEventMap`, `WakeEvent`, `WakeOptions`, `ConfigurationCheck`, `InstallModelsOptions`, `ModelInstallProgress` | types     | full public type surface                                                                                   |

Helpers that stay internal: `keywordTokens()` (pinyin → KWS tokens), the voiceprint read/write/normalize functions, and the recognizer implementations. None of them are exported from the main entry.

### `@cieljs/hearing/ciel`

CLI entry (`dist/ciel.mjs`, built from `src/cli/index.ts`). Commands are `install-model` and `voiceprint`; `help`, `--help` and `-h` print usage, and an unknown command prints usage and exits with code 2. This is a program entry, not a library surface.

### `@cieljs/hearing/worker`

The Node process the Electron backend spawns (`dist/worker.mjs`, built from `src/worker.ts`). It speaks newline-delimited JSON over stdin/stdout:

| Direction | Messages                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| command   | `init` (`kind: 'asr' \| 'kws'`), `write` (base64 PCM, ISO `startAt`, optional `sampleRate`/`channels`/`format`), `set-model`, `flush`, `close` — each with an `id` |
| event     | `ack` (`id`, optional `error`), `result`, `wake`, `speechstart`, `speechend`                                                                                       |

Requests are acked, so callers can await them, and a failed `init` marks the worker fatal and rejects everything pending. Not intended for direct application use.

### `@cieljs/hearing/package.json`

Raw manifest access for tooling that needs package metadata.

## Development

```bash
vp check        # format, lint and type check
vp test --run   # tests
vp run build    # vp pack -> dist (index, worker, ciel)
```

Tests live in `tests/**/*.test.ts` and substitute `sherpa-onnx-node` with module doubles, so they need neither a model download nor real audio hardware. The `test` task declares `CIEL_NODE_EXECUTABLE` as an environment input, and `build` depends on the same task in dependencies. `./worker` must stay a separate ESM entry, because the Electron backend spawns it as a file.

Consumers: [`@cieljs/perception`](../perception/README.md) wraps `ASR` to add vision sampling and agent snapshots, while `apps/blive-agent` and `apps/voice-agent` own the `modelsPath` and voiceprint layout inside their data directories.
