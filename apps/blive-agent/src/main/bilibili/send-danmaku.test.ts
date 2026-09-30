import type { WebContents } from 'electron';
import { expect, it, vi } from 'vite-plus/test';

import { sendDanmaku, sendDanmakuFromPage } from './send-danmaku.ts';

function page(result: unknown, url = 'https://live.bilibili.com/123') {
  const executeJavaScript = vi.fn().mockResolvedValue(result);

  const contents = {
    executeJavaScript,
    getURL: () => url,
    isDestroyed: () => false,
  } as unknown as WebContents;

  return { contents, executeJavaScript };
}

it('直接提交直播站发送接口，只有 code=0 确认成功', async () => {
  const { contents, executeJavaScript } = page({ code: 0 });

  expect(await sendDanmaku(contents, 123, '晚上好')).toMatchObject({
    accepted: true,
    code: 0,
    riskControl: false,
  });

  const code = executeJavaScript.mock.calls[0]![0] as string;
  expect(code).toContain('https://api.live.bilibili.com/msg/send');
  expect(code).toContain("body.set('roomid', '123')");
  expect(code).toContain('bili_jct');
  expect(code).toContain('晚上好');
});

it('页面发送路径使用原生 setter、input 事件和发送按钮，并保留旧接口', async () => {
  const { contents, executeJavaScript } = page({
    accepted: true,
    code: 0,
    message: '已点击页面发送按钮',
    riskControl: false,
  });

  await expect(sendDanmakuFromPage(contents, '晚上好')).resolves.toMatchObject({ accepted: true });
  const script = executeJavaScript.mock.calls[0]![0] as string;
  expect(script).toContain("Object.getOwnPropertyDescriptor(prototype, 'value')");
  expect(script).toContain("new InputEvent('input'");
  expect(script).toContain('requestAnimationFrame');
  expect(script).toContain('button.click()');
  expect(script).not.toContain('/msg/send');
});

// 真实影子风控响应：code 为 0，data 里还有看似正常的发送回执，唯一信号是 message/msg 为 "f"。
const SHADOWED_RESPONSE = {
  code: 0,
  data: {
    mode_info: {
      mode: 0,
      show_player_type: 0,
      extra: JSON.stringify({
        send_from_me: true,
        content: '[喝彩]',
        is_audited: false,
        id_str: '6e868e6a59fe1df474f39ff75e6aa67c2918',
      }),
    },
    dm_v2: null,
  },
  message: 'f',
  msg: 'f',
};

it('code=0 但 message/msg 为 "f" 时不算成功', async () => {
  const shadowed = page(SHADOWED_RESPONSE);

  expect(await sendDanmaku(shadowed.contents, 123, '[喝彩]')).toMatchObject({
    accepted: false,
    code: 0,
    message: 'f',
    riskControl: true,
  });
});

it('识别错误返回里的风控提示', async () => {
  const limited = page({ code: -352, message: '风控校验失败' });

  expect(await sendDanmaku(limited.contents, 123, 'hello')).toMatchObject({
    accepted: false,
    code: -352,
    message: '风控校验失败',
    riskControl: true,
  });
});

it('message 为空时回退到 msg，普通拒绝不误判为风控', async () => {
  const failed = page({ code: -400, message: '', msg: '请求错误' });

  expect(await sendDanmaku(failed.contents, 123, 'hello')).toMatchObject({
    accepted: false,
    code: -400,
    message: '请求错误',
    riskControl: false,
  });
});

it('响应缺少状态不能误报成功，服务端拒绝不重试', async () => {
  const unknown = page({});
  await expect(sendDanmaku(unknown.contents, 123, 'hello')).rejects.toThrow('未通过校验');

  const rejected = page({ code: -1, message: '拒绝' });

  expect(await sendDanmaku(rejected.contents, 123, 'hello')).toMatchObject({
    accepted: false,
    code: -1,
    message: '拒绝',
    riskControl: false,
  });

  expect(rejected.executeJavaScript).toHaveBeenCalledTimes(1);
});

it('不在 B 站直播页时拒绝发送', async () => {
  const blocked = page({ code: 0 }, 'https://example.com/');
  await expect(sendDanmaku(blocked.contents, 123, 'hello')).rejects.toThrow('页面地址');
  expect(blocked.executeJavaScript).not.toHaveBeenCalled();
});
