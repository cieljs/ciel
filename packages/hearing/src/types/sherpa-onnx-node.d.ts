declare module 'sherpa-onnx-node' {
  /** 原生构造器返回的不透明句柄。不要读取或修改内部状态，请原样传给 API。 */
  export type OfflineStreamHandle = object;
  export type OnlineStreamHandle = object;
  export type OfflineRecognizerHandle = object;
  export type OnlineRecognizerHandle = object;
  export type DisplayHandle = object;
  export type CircularBufferHandle = object;
  export type VoiceActivityDetectorHandle = object;
  export type AudioTaggingHandle = object;
  export type OfflinePunctuationHandle = object;
  export type LinearResamplerHandle = object;
  export type OfflineTtsHandle = object;
  export type OnlinePunctuationHandle = object;
  export type KeywordSpotterHandle = object;
  export type SpeakerEmbeddingExtractorHandle = object;
  export type SpeakerEmbeddingManagerHandle = object;
  export type SpokenLanguageIdentificationHandle = object;
  export type OfflineSpeakerDiarizationHandle = object;
  export type OfflineSpeechDenoiserHandle = object;
  export type OnlineSpeechDenoiserHandle = object;
  /** `AudioTagging.compute()` 返回的单个音频事件。 */
  export type AudioEvent = {
    /** 事件名称。 */
    name: string;
    /** 概率，范围 0-1。 */
    prob: number;
    /** 事件的整数索引。 */
    index: number;
  };
  /** AudioTagging 的 Zipformer 模型配置。 */
  export type AudioTaggingZipformerModelConfig = {
    model?: string | undefined;
  };
  /** AudioTagging 模型配置。 */
  export type AudioTaggingModelConfig = {
    zipformer?: AudioTaggingZipformerModelConfig | undefined;
    ced?: string | undefined;
    numThreads?: number | undefined;
    debug?: number | boolean | undefined;
    provider?: string | undefined;
  };
  /** 传给 AudioTagging 构造器的配置。 */
  export type AudioTaggingConfig = {
    model?: AudioTaggingModelConfig | undefined;
    labels?: string | undefined;
    topK?: number | undefined;
  };
  /** `acceptWaveform` 使用的波形输入。 */
  export type Waveform = {
    /** 取值范围为 -1 到 1 的采样。 */
    samples: Float32Array;
    /** 整数采样率，例如 16000。 */
    sampleRate: number;
  };
  /** 识别器与模型使用的特征配置。 */
  export type FeatureConfig = {
    sampleRate?: number | undefined;
    featureDim?: number | undefined;
  };
  /** Silero VAD 模型配置。 */
  export type SileroVadModelConfig = {
    model?: string | undefined;
    threshold?: number | undefined;
    minSilenceDuration?: number | undefined;
    minSpeechDuration?: number | undefined;
    windowSize?: number | undefined;
    maxSpeechDuration?: number | undefined;
  };
  /** TEN-VAD 模型配置。 */
  export type TenVadModelConfig = {
    model?: string | undefined;
    threshold?: number | undefined;
    minSilenceDuration?: number | undefined;
    minSpeechDuration?: number | undefined;
    windowSize?: number | undefined;
    maxSpeechDuration?: number | undefined;
  };
  /** 语音活动检测配置。 */
  export type VadConfig = {
    sileroVad?: SileroVadModelConfig | undefined;
    tenVad?: TenVadModelConfig | undefined;
    sampleRate?: number | undefined;
    numThreads?: number | undefined;
    provider?: string | undefined;
    debug?: number | boolean | undefined;
  };
  /** 离线 Transducer 模型配置。 */
  export type OfflineTransducerModelConfig = {
    encoder?: string | undefined;
    decoder?: string | undefined;
    joiner?: string | undefined;
  };
  /** 离线 Paraformer 模型配置。 */
  export type OfflineParaformerModelConfig = {
    model?: string | undefined;
  };
  /** 离线 Zipformer CTC 模型配置。 */
  export type OfflineZipformerCtcModelConfig = {
    model?: string | undefined;
  };
  /** 离线 Wenet CTC 模型配置。 */
  export type OfflineWenetCtcModelConfig = {
    model?: string | undefined;
  };
  /** 离线 Omnilingual ASR CTC 模型配置。 */
  export type OfflineOmnilingualAsrCtcModelConfig = {
    model?: string | undefined;
  };
  /** 离线 Med ASR CTC 模型配置。 */
  export type OfflineMedAsrCtcModelConfig = {
    model?: string | undefined;
  };
  /** 离线 Dolphin 模型配置。 */
  export type OfflineDolphinModelConfig = {
    model?: string | undefined;
  };
  /** 离线 NeMo CTC 模型配置。 */
  export type OfflineNeMoCtcModelConfig = {
    model?: string | undefined;
  };
  /** 离线 Canary 模型配置。 */
  export type OfflineCanaryModelConfig = {
    encoder?: string | undefined;
    decoder?: string | undefined;
    srcLang?: string | undefined;
    tgtLang?: string | undefined;
    usePnc?: number | undefined;
  };
  /** 离线 Whisper 模型配置。 */
  export type OfflineWhisperModelConfig = {
    encoder?: string | undefined;
    decoder?: string | undefined;
    language?: string | undefined;
    task?: string | undefined;
    tailPaddings?: number | undefined;
  };
  /** 离线 FireRed ASR 模型配置。 */
  export type OfflineFireRedAsrModelConfig = {
    encoder?: string | undefined;
    decoder?: string | undefined;
  };
  /** 离线 Moonshine 模型配置。 */
  export type OfflineMoonshineModelConfig = {
    preprocessor?: string | undefined;
    encoder?: string | undefined;
    uncachedDecoder?: string | undefined;
    cachedDecoder?: string | undefined;
  };
  /** 离线 TDNN 模型配置。 */
  export type OfflineTdnnModelConfig = {
    model?: string | undefined;
  };
  /** 离线 SenseVoice 模型配置。 */
  export type OfflineSenseVoiceModelConfig = {
    model?: string | undefined;
    language?: string | undefined;
    useInverseTextNormalization?: number | undefined;
  };
  /** 离线 Qwen3-ASR 模型配置。 */
  export type OfflineQwen3AsrModelConfig = {
    convFrontend?: string | undefined;
    encoder?: string | undefined;
    decoder?: string | undefined;
    tokenizer?: string | undefined;
    hotwords?: string | undefined;
    maxTotalLen?: number | undefined;
    maxNewTokens?: number | undefined;
    temperature?: number | undefined;
    topP?: number | undefined;
    seed?: number | undefined;
  };
  /** 离线 Cohere Transcribe 模型配置。 */
  export type OfflineCohereTranscribeModelConfig = {
    encoder?: string | undefined;
    decoder?: string | undefined;
    language?: string | undefined;
    usePunct?: number | undefined;
    useItn?: number | undefined;
  };
  /** 离线识别模型配置。 */
  export type OfflineModelConfig = {
    transducer?: OfflineTransducerModelConfig | undefined;
    paraformer?: OfflineParaformerModelConfig | undefined;
    zipformerCtc?: OfflineZipformerCtcModelConfig | undefined;
    wenetCtc?: OfflineWenetCtcModelConfig | undefined;
    omnilingual?: OfflineOmnilingualAsrCtcModelConfig | undefined;
    medasr?: OfflineMedAsrCtcModelConfig | undefined;
    dolphin?: OfflineDolphinModelConfig | undefined;
    nemoCtc?: OfflineNeMoCtcModelConfig | undefined;
    canary?: OfflineCanaryModelConfig | undefined;
    whisper?: OfflineWhisperModelConfig | undefined;
    fireRedAsr?: OfflineFireRedAsrModelConfig | undefined;
    moonshine?: OfflineMoonshineModelConfig | undefined;
    tdnn?: OfflineTdnnModelConfig | undefined;
    senseVoice?: OfflineSenseVoiceModelConfig | undefined;
    qwen3Asr?: OfflineQwen3AsrModelConfig | undefined;
    cohereTranscribe?: OfflineCohereTranscribeModelConfig | undefined;
    tokens?: string | undefined;
    numThreads?: number | undefined;
    debug?: number | boolean | undefined;
    provider?: string | undefined;
  };
  /** Transducer 模型配置。 */
  export type TransducerModelConfig = {
    encoder?: string | undefined;
    decoder?: string | undefined;
    joiner?: string | undefined;
  };
  /** Paraformer 模型配置。 */
  export type ParaformerModelConfig = {
    encoder?: string | undefined;
    decoder?: string | undefined;
  };
  /** Zipformer2 CTC 模型配置。 */
  export type Zipformer2CtcModelConfig = {
    model?: string | undefined;
  };
  /** NeMo CTC 模型配置。 */
  export type NemoCtcModelConfig = {
    model?: string | undefined;
  };
  /** Tone CTC 模型配置。 */
  export type ToneCtcModelConfig = {
    model?: string | undefined;
  };
  /** 在线模型配置，对应 C++ `OnlineModelConfig` 的子集。 */
  export type OnlineModelConfig = {
    transducer?: TransducerModelConfig | undefined;
    paraformer?: ParaformerModelConfig | undefined;
    zipformer2Ctc?: Zipformer2CtcModelConfig | undefined;
    nemoCtc?: NemoCtcModelConfig | undefined;
    toneCtc?: ToneCtcModelConfig | undefined;
    tokens?: string | undefined;
    numThreads?: number | undefined;
    debug?: number | boolean | undefined;
    provider?: string | undefined;
    modelType?: string | undefined;
    modelingUnit?: string | undefined;
    bpeVocab?: string | undefined;
    tokensBuf?: string | undefined;
    tokensBufSize?: number | undefined;
  };
  /** 在线与离线识别器共用的同音词替换配置。 */
  export type HomophoneReplacerConfig = {
    lexicon?: string | undefined;
    ruleFsts?: string | undefined;
  };
  /** 传给 `createOnlineRecognizer` 的在线识别配置。 */
  export type OnlineRecognizerConfig = {
    featConfig?: FeatureConfig | undefined;
    modelConfig?: OnlineModelConfig | undefined;
    hr?: HomophoneReplacerConfig | undefined;
    decodingMethod?: string | undefined;
    maxActivePaths?: number | undefined;
    enableEndpoint?: number | boolean | undefined;
    rule1MinTrailingSilence?: number | undefined;
    rule2MinTrailingSilence?: number | undefined;
    rule3MinUtteranceLength?: number | undefined;
    hotwordsFile?: string | undefined;
    hotwordsScore?: number | undefined;
    ruleFsts?: string | undefined;
    ruleFars?: string | undefined;
    blankPenalty?: number | undefined;
  };
  /** 传给 `createOfflineRecognizer` 的离线识别配置。 */
  export type OfflineRecognizerConfig = {
    featConfig?: FeatureConfig | undefined;
    modelConfig?: OfflineModelConfig | undefined;
  };
  /** `readWave` 返回并供 `writeWave` 使用的波形。 */
  export type WaveObject = {
    /** 取值范围为 -1 到 1 的一维采样。 */
    samples: Float32Array;
    /** 整数采样率，例如 16000。 */
    sampleRate: number;
  };
  /** `Vad.front()` 返回的语音片段。 */
  export type SpeechSegment = {
    /** 片段起始索引。 */
    start: number;
    /** 音频采样。 */
    samples: Float32Array;
  };
  /** TTS 与语音降噪器返回的音频。 */
  export type GeneratedAudio = {
    /** 生成或降噪后的音频采样。 */
    samples: Float32Array;
    /** 采样率，单位 Hz。 */
    sampleRate: number;
  };
  export type GenerationConfig = {
    silenceScale?: number | undefined;
    speed?: number | undefined;
    sid?: number | undefined;
    numSteps?: number | undefined;
    referenceAudio?: Float32Array | undefined;
    referenceSampleRate?: number | undefined;
    referenceText?: string | undefined;
    extra?:
      | {
          [key: string]: string | number;
        }
      | undefined;
  };
  /** 传给 `generate` / `generateAsync` 的 TTS 请求。 */
  export type TtsRequest = {
    /** 待合成文本。 */
    text: string;
    /** 说话人整数 ID。 */
    sid: number;
    /** 播放速度。 */
    speed: number;
    /** 是否使用外部缓冲区。 */
    enableExternalBuffer?: boolean | undefined;
    /** 可选的生成参数。 */
    generationConfig?: GenerationConfig | undefined;
  };
  /** 口语语言识别的 Whisper 配置。 */
  export type SpokenLanguageIdentificationWhisperConfig = {
    encoder?: string | undefined;
    decoder?: string | undefined;
    tailPaddings?: number | undefined;
  };
  /** 口语语言识别配置。 */
  export type SpokenLanguageIdentificationConfig = {
    whisper?: SpokenLanguageIdentificationWhisperConfig | undefined;
    numThreads?: number | undefined;
    debug?: number | boolean | undefined;
    provider?: string | undefined;
  };
  /** 说话人 embedding 提取器配置。 */
  export type SpeakerEmbeddingExtractorConfig = {
    model?: string | undefined;
    numThreads?: number | undefined;
    debug?: number | boolean | undefined;
    provider?: string | undefined;
  };
  /** 离线标点模型配置。 */
  export type OfflinePunctuationModelConfig = {
    ctTransformer?: string | undefined;
    numThreads?: number | undefined;
    debug?: number | boolean | undefined;
    provider?: string | undefined;
  };
  /** 离线标点配置。 */
  export type OfflinePunctuationConfig = {
    model?: OfflinePunctuationModelConfig | undefined;
  };
  /** 在线标点模型配置。 */
  export type OnlinePunctuationModelConfig = {
    cnnBilstm?: string | undefined;
    bpeVocab?: string | undefined;
    numThreads?: number | undefined;
    debug?: number | boolean | undefined;
    provider?: string | undefined;
  };
  /** 在线标点配置。 */
  export type OnlinePunctuationConfig = {
    model?: OnlinePunctuationModelConfig | undefined;
  };
  /** 降噪器与 TTS 生成器共用的音频处理请求。 */
  export type AudioProcessRequest = {
    samples: Float32Array;
    sampleRate: number;
    enableExternalBuffer?: boolean | undefined;
  };
  /** 离线 TTS 的 VITS 模型配置。 */
  export type OfflineTtsVitsModelConfig = {
    model?: string | undefined;
    lexicon?: string | undefined;
    tokens?: string | undefined;
    dataDir?: string | undefined;
    noiseScale?: number | undefined;
    noiseScaleW?: number | undefined;
    lengthScale?: number | undefined;
  };
  export type OfflineTtsMatchaModelConfig = {
    acousticModel?: string | undefined;
    vocoder?: string | undefined;
    lexicon?: string | undefined;
    tokens?: string | undefined;
    dataDir?: string | undefined;
    noiseScale?: number | undefined;
    lengthScale?: number | undefined;
  };
  export type OfflineTtsKokoroModelConfig = {
    model?: string | undefined;
    voices?: string | undefined;
    tokens?: string | undefined;
    dataDir?: string | undefined;
    lengthScale?: number | undefined;
    lexicon?: string | undefined;
    lang?: string | undefined;
  };
  export type OfflineTtsKittenModelConfig = {
    model?: string | undefined;
    voices?: string | undefined;
    tokens?: string | undefined;
    dataDir?: string | undefined;
    lengthScale?: number | undefined;
  };
  export type OfflineTtsZipvoiceModelConfig = {
    tokens?: string | undefined;
    encoder?: string | undefined;
    decoder?: string | undefined;
    vocoder?: string | undefined;
    dataDir?: string | undefined;
    lexicon?: string | undefined;
    featScale?: number | undefined;
    tShift?: number | undefined;
    targetRms?: number | undefined;
    guidanceScale?: number | undefined;
  };
  export type OfflineTtsPocketModelConfig = {
    lmFlow?: string | undefined;
    lmMain?: string | undefined;
    encoder?: string | undefined;
    decoder?: string | undefined;
    textConditioner?: string | undefined;
    vocabJson?: string | undefined;
    tokenScoresJson?: string | undefined;
    voiceEmbeddingCacheCapacity?: number | undefined;
  };
  /** 离线 TTS 模型配置。 */
  export type OfflineTtsModelConfig = {
    vits?: OfflineTtsVitsModelConfig | undefined;
    matcha?: OfflineTtsMatchaModelConfig | undefined;
    kokoro?: OfflineTtsKokoroModelConfig | undefined;
    kitten?: OfflineTtsKittenModelConfig | undefined;
    zipvoice?: OfflineTtsZipvoiceModelConfig | undefined;
    pocket?: OfflineTtsPocketModelConfig | undefined;
  };
  /** 离线 TTS 常用配置子集。 */
  export type OfflineTtsConfig = {
    model?: OfflineTtsModelConfig | undefined;
    maxNumSentences?: number | undefined;
    silenceScale?: number | undefined;
    numThreads?: number | undefined;
    provider?: string | undefined;
  };
  /** 离线语音降噪 GTCRN 模型配置。 */
  export type OfflineSpeechDenoiserGtcrnModelConfig = {
    model?: string | undefined;
  };
  /** 离线语音降噪 DPDFNet 模型配置。 */
  export type OfflineSpeechDenoiserDpdfNetModelConfig = {
    model?: string | undefined;
  };
  /** 离线语音降噪模型配置。 */
  export type OfflineSpeechDenoiserModelConfig = {
    gtcrn?: OfflineSpeechDenoiserGtcrnModelConfig | undefined;
    dpdfnet?: OfflineSpeechDenoiserDpdfNetModelConfig | undefined;
    numThreads?: number | undefined;
    debug?: number | boolean | undefined;
    provider?: string | undefined;
  };
  /** 离线语音降噪配置子集。 */
  export type OfflineSpeechDenoiserConfig = {
    model?: OfflineSpeechDenoiserModelConfig | undefined;
  };
  /** 在线语音降噪配置子集。 */
  export type OnlineSpeechDenoiserConfig = {
    model?: OfflineSpeechDenoiserModelConfig | undefined;
  };
  /** 离线说话人分段的 pyannote 模型配置。 */
  export type OfflineSpeakerSegmentationPyannoteModelConfig = {
    model?: string | undefined;
  };
  /** 离线说话人分段模型配置。 */
  export type OfflineSpeakerSegmentationModelConfig = {
    pyannote?: OfflineSpeakerSegmentationPyannoteModelConfig | undefined;
    numThreads?: number | undefined;
    debug?: number | boolean | undefined;
    provider?: string | undefined;
  };
  /** 离线说话人分离配置子集。 */
  export type OfflineSpeakerDiarizationConfig = {
    segmentation?: OfflineSpeakerSegmentationModelConfig | undefined;
    embedding?: SpeakerEmbeddingExtractorConfig | undefined;
    clustering?: FastClusteringConfig | undefined;
    minDurationOn?: number | undefined;
    minDurationOff?: number | undefined;
  };
  /** 说话人分离使用的快速聚类配置。 */
  export type FastClusteringConfig = {
    numClusters?: number | undefined;
    threshold?: number | undefined;
  };
  /** `SpeakerEmbeddingManager` 批量添加的扁平参数。 */
  export type SpeakerEmbeddingManagerAddListFlattenedObj = {
    name: string;
    vv: Float32Array;
    n: number;
  };
  /** `SpeakerEmbeddingManager` 搜索参数。 */
  export type SpeakerEmbeddingManagerSearchObj = {
    v: Float32Array;
    threshold: number;
  };
  /** `SpeakerEmbeddingManager` 验证参数。 */
  export type SpeakerEmbeddingManagerVerifyObj = {
    name: string;
    v: Float32Array;
    threshold: number;
  };
  /** 关键词检测配置子集。 */
  export type KeywordSpotterConfig = {
    featConfig?: FeatureConfig | undefined;
    modelConfig?: OfflineModelConfig | undefined;
    maxActivePaths?: number | undefined;
    numTrailingBlanks?: number | undefined;
    keywordsScore?: number | undefined;
    keywordsThreshold?: number | undefined;
    keywordsFile?: string | undefined;
  };
  /** `getOfflineStreamResultAsJson` 返回的离线识别结果，字段以 C++ 实现为准。 */
  export type OfflineRecognizerResult = {
    lang: string;
    emotion: string;
    event: string;
    text: string;
    timestamps: number[];
    durations: number[];
    tokens: string[];
    ys_log_probs: number[];
    words: number[];
  };
  /** `getOnlineStreamResultAsJson` 返回的在线识别结果，字段以 C++ 实现为准。 */
  export type OnlineRecognizerResult = {
    text: string;
    tokens: string[];
    timestamps: number[];
    ys_probs: number[];
    lm_probs: number[];
    context_scores: number[];
    segment: number;
    words: number[];
    start_time: number;
    is_final: boolean;
    is_eof: boolean;
  };
  /** `getKeywordResultAsJson` 返回的关键词检测结果。 */
  export type KeywordResult = {
    start_time: number;
    keyword: string;
    timestamps: number[];
    tokens: string[];
  };
  /** `offlineSpeakerDiarizationProcess` 返回的说话人片段。 */
  export type SpeakerDiarizationSegment = {
    /** 开始时间，单位为秒。 */
    start: number;
    /** 结束时间，单位为秒。 */
    end: number;
    /** 说话人整数 ID。 */
    speaker: number;
  };
  /** `SpeakerEmbeddingManager.add` 使用的说话人 embedding。 */
  export type SpeakerEmbeddingEntry = {
    /** 说话人名称。 */
    name: string;
    /** embedding 向量。 */
    v: Float32Array;
  };
  export type OfflineStreamObject = {
    handle: OfflineStreamHandle;
  };
  export type OnlineStreamObject = {
    handle: OnlineStreamHandle;
  };
  export type DisplayObject = {
    handle: DisplayHandle;
  };

  export class KeywordSpotter {
    constructor(config: KeywordSpotterConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): KeywordResult;
  }
  export class OnlineStream {
    readonly handle: OnlineStreamHandle;
    acceptWaveform(waveform: Waveform): void;
    inputFinished(): void;
  }

  export class OnlineRecognizer {
    readonly config: OnlineRecognizerConfig;
    constructor(config: OnlineRecognizerConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    isEndpoint(stream: OnlineStream): boolean;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): OnlineRecognizerResult;
  }

  export class OfflineStream {
    readonly handle: OfflineStreamHandle;
    acceptWaveform(waveform: Waveform): void;
    setOption(key: string, value: string): void;
  }

  export class OfflineRecognizer {
    readonly config: OfflineRecognizerConfig;
    constructor(config: OfflineRecognizerConfig);
    static createAsync(config: OfflineRecognizerConfig): Promise<OfflineRecognizer>;
    createStream(hotwords?: string): OfflineStream;
    setConfig(config: OfflineRecognizerConfig): void;
    decode(stream: OfflineStream): void;
    decodeAsync(stream: OfflineStream): Promise<OfflineRecognizerResult>;
    getResult(stream: OfflineStream): OfflineRecognizerResult;
  }

  export class CircularBuffer {
    constructor(capacity: number);
    push(samples: Float32Array): void;
    get(startIndex: number, n: number, enableExternalBuffer?: boolean): Float32Array;
    pop(n: number): void;
    size(): number;
    head(): number;
    reset(): void;
  }

  export class Vad {
    readonly config: VadConfig;
    constructor(config: VadConfig, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    pop(): void;
    clear(): void;
    front(enableExternalBuffer?: boolean): SpeechSegment;
    reset(): void;
    flush(): void;
  }

  export class SpeakerEmbeddingExtractor {
    readonly config: SpeakerEmbeddingExtractorConfig;
    readonly dim: number;
    constructor(config: SpeakerEmbeddingExtractorConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    compute(stream: OnlineStream, enableExternalBuffer?: boolean): Float32Array;
  }

  export class SpeakerEmbeddingManager {
    readonly dim: number;
    constructor(dim: number);
    add(entry: SpeakerEmbeddingEntry): boolean;
    addMulti(entry: { name: string; v: Float32Array[] }): boolean;
    remove(name: string): boolean;
    search(options: SpeakerEmbeddingManagerSearchObj): string;
    verify(options: SpeakerEmbeddingManagerVerifyObj): boolean;
    contains(name: string): boolean;
    getNumSpeakers(): number;
    getAllSpeakerNames(): string[];
  }

  export function readWave(filename: string): WaveObject;
  export function writeWave(filename: string, wave: WaveObject): void;

  const sherpaOnnx: {
    KeywordSpotter: typeof KeywordSpotter;
    CircularBuffer: typeof CircularBuffer;
    OfflineRecognizer: typeof OfflineRecognizer;
    OnlineRecognizer: typeof OnlineRecognizer;
    SpeakerEmbeddingExtractor: typeof SpeakerEmbeddingExtractor;
    SpeakerEmbeddingManager: typeof SpeakerEmbeddingManager;
    Vad: typeof Vad;
    readWave: typeof readWave;
    writeWave: typeof writeWave;
  };

  export default sherpaOnnx;
}
