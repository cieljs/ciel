import { createHash } from 'node:crypto';

// WBI 口令重排映射表，见 B 站 WBI 签名算法
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/** 将 nav 接口返回的 img_key 与 sub_key 重排，得到 32 位 mixin_key。 */
export function getMixinKey(imgKey: string, subKey: string) {
  const rawKey = imgKey + subKey;

  return MIXIN_KEY_ENC_TAB.map(index => rawKey[index])
    .join('')
    .slice(0, 32);
}

/** 追加 wts 后按 key 升序编码，再拼接 mixin_key 做 MD5，得到 w_rid。 */
export function signWbiParams(
  params: Record<string, string | number>,
  mixinKey: string,
  wts: number,
) {
  const signed: Record<string, string | number> = { ...params, wts };

  const query = Object.keys(signed)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeWbiValue(signed[key])}`)
    .join('&');

  return { ...signed, w_rid: md5Hex(query + mixinKey) };
}

function encodeWbiValue(value: string | number) {
  // 签名要求剔除值中的 !'()*，并按 encodeURIComponent 规则编码（空格为 %20）
  return encodeURIComponent(String(value).replace(/[!'()*]/g, ''));
}

function md5Hex(input: string) {
  return createHash('md5').update(input).digest('hex');
}
