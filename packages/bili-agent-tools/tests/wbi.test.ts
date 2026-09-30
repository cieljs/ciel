import { expect, test } from 'vite-plus/test';

import { getMixinKey, signWbiParams } from '../src/wbi.ts';

// 取自 B 站 WBI 签名算法文档中的已知算例
const KNOWN_MIXIN_KEY = 'ea1db124af3c7062474693fa704f4ff8';

test('getMixinKey 按映射表重排 img_key 与 sub_key', () => {
  const mixinKey = getMixinKey(
    '7cd084941338484aae1ad9425b84077c',
    '4932caff0ff746eab6f01bf08b70ac45',
  );

  expect(mixinKey).toBe(KNOWN_MIXIN_KEY);
});

test('signWbiParams 生成已知的 w_rid', () => {
  const signed = signWbiParams(
    { foo: '114', bar: '514', zab: 1919810 },
    KNOWN_MIXIN_KEY,
    1702204169,
  );

  expect(signed).toEqual({
    foo: '114',
    bar: '514',
    zab: 1919810,
    wts: 1702204169,
    w_rid: '8f6f2b5b3d485fe1886cec6a0be8c5d4',
  });
});

test('signWbiParams 按 encodeURIComponent 编码中文与空格', () => {
  const signed = signWbiParams(
    { foo: 'one one four', bar: '五一四', baz: 1919810 },
    KNOWN_MIXIN_KEY,
    1702204169,
  );

  expect(signed.w_rid).toBe('04e50b58980e3e3cee8cbc0cc4c1c530');
});

test("signWbiParams 剔除值中的 !'()* 字符", () => {
  const dirty = signWbiParams({ q: "a!b'c(d)e*f" }, KNOWN_MIXIN_KEY, 1702204169);
  const clean = signWbiParams({ q: 'abcdef' }, KNOWN_MIXIN_KEY, 1702204169);

  expect(dirty.w_rid).toBe(clean.w_rid);
});
