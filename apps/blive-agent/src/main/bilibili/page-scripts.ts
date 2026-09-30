/** UID 就绪前不查账号 API，页面未初始化与未登录都返回空值。 */
export const READ_ACCOUNT_SCRIPT = `(async () => {
  const uid = window.BilibiliLive?.UID || window.__LIVE_USER_LOGIN_STATUS__?.uid;
  if (typeof uid !== 'number' || uid === 0) return null;

  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    credentials: 'include',
  });
  const body = await response.json();
  if (body.code !== 0 || !body.data?.isLogin) return null;

  return { uid: body.data.mid, name: body.data.uname, face: body.data.face ?? '' };
})()`;

/** 使用直播站自己的登录弹窗，保留当前页面及其登录状态检测。 */
export const OPEN_LOGIN_SCRIPT = `(() => {
  const entry = document.querySelector('.header-login-entry');
  if (!entry) throw new Error('当前页面的登录入口尚未就绪');
  entry.click();
  return true;
})()`;

/** 等待播放器挂载后应用网页全屏，隐藏站内侧栏。 */
export const PREPARE_PLAYER_SCRIPT = `(() => {
  const player = window.livePlayer;
  if (!document.body || typeof player?.setFullscreenStatus !== 'function') return false;

  player.setFullscreenStatus(1);
  document.body.classList.add('hide-aside-area');
  return true;
})()`;

/** 短房号与真实房号都可能出现在地址栏，按当前页面信息核对。 */
export const READ_READINESS_SCRIPT = `(() => {
  const match = location.pathname.match(/^\\/(\\d+)/u);
  const pathRoomId = match ? Number(match[1]) : null;
  const room = window.__NEPTUNE_IS_MY_WAIFU__?.roomInitRes?.data;
  // B 站会把真实房号重定向为短房号，仅在当前路径匹配时采用页面房间信息。
  const matchesRoom = room && (pathRoomId === room.room_id || pathRoomId === room.short_id);
  const roomId = matchesRoom ? room.room_id : pathRoomId;
  return {
    roomId,
    // 感知通过独立媒体流运行，不依赖页面暴露播放器实例或所有资源加载完毕。
    ready: location.hostname === "live.bilibili.com"
      && roomId !== null
      && document.readyState !== "loading"
      && Boolean(document.body),
    canSendDanmaku: Boolean(document.querySelector("textarea, [contenteditable=true]")),
  };
})()`;

/** 未开播与轮播都不是实时直播；未知状态交给 API 核实。 */
export const READ_LIVE_STATUS_SCRIPT = `(() => {
  const player = window.livePlayer;
  if (typeof player?.getPlayerInfo !== 'function') return null;
  const status = player.getPlayerInfo()?.liveStatus;
  // B 站播放器：0 未开播，1 直播，2 轮播；轮播不作为实时直播继续感知。
  if (status === 1) return 'live';
  if (status === 0 || status === 2) return 'offline';
  return null;
})()`;
