/**
 * 全局共用的浏览器 User-Agent：直播页、主进程请求和 FFmpeg 都复用它。
 *
 * Electron 默认 UA 会带上 `Electron/44.2.0` 和产品名，直播页据此即可识别出桌面客户端，
 * 因此固定成这份普通桌面 Chrome 的形态。
 */
export const browserUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
