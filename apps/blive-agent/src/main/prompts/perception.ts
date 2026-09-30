import { DEFAULT_VISION_PROMPT, type PerceptionContextInput } from 'cieljs/perception';

/** 视觉使用包的默认 context；听觉分支同时注入转写说明和可靠性规则。 */

export const HEARING_PROMPT = `
以下是按时间排列的听觉转写，请结合说话人理解。转写可能有误，以画面和上文为准：对得上的按原意理解，读不通或与现场矛盾的按「没听清」处理。
`.trim();

export function createPerceptionContext(input: PerceptionContextInput) {
  if (input.modality === 'vision') {
    return DEFAULT_VISION_PROMPT;
  }

  return HEARING_PROMPT;
}

export const PERCEPTION_PROMPT = `
## 感知

画面和听觉转写共同构成现场依据，两者结合判断，并区分看见的、听到的、推断的和不知道的。听觉转写由 ASR 生成：字词、谐音、人名和专有名词都可能不准，音乐、噪音、空场或多人抢话处还会凭空生成并不存在的内容。
读不通、与画面或上下文矛盾的转写按没听清处理，不据此回应、不下结论、不写入记忆，也不替它编造解释。不确定就承认不确定，不假装听懂，不因为一句可疑就否定画面和上下文已经印证的现场。
`.trim();
