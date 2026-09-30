import { BiliApiError } from './errors.ts';
import { getMixinKey, signWbiParams } from './wbi.ts';

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
const REFERER = 'https://www.bilibili.com/';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 15_000;

// img_key/sub_key 每日更替，缓存几小时即可；签名被拒时再强制刷新
const WBI_KEY_TTL_MS = 6 * 60 * 60 * 1_000;

interface BiliResponseRoot {
  code: number;
  message?: string;
  msg?: string;
  data?: unknown;
}

export interface BiliClientOptions {
  /** 浏览器登录后的 Cookie，建议包含 SESSDATA、bili_jct、buvid3 等字段。 */
  cookie?: string;
  /** 自定义 fetch，便于测试或接入宿主网络层。 */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** 单次请求超时时间，默认 15 秒。 */
  timeoutMs?: number;
  userAgent?: string;
}

export interface BiliApiRequest {
  query?: Record<string, string | number | undefined>;
  /** 是否进行 WBI 签名，默认不签名。 */
  signed?: boolean;
  signal?: AbortSignal;
}

export type BiliClient = ReturnType<typeof createBiliClient>;

export function createBiliClient(options: BiliClientOptions = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const cookies = parseCookie(options.cookie ?? '');

  let wbiKeys: { mixinKey: string; expiresAt: number } | undefined;
  let pendingWbiKeys: Promise<string> | undefined;

  /** 请求接口并返回 data 字段；code 非 0 时抛出 BiliApiError。 */
  async function request<T>(url: string, requestOptions: BiliApiRequest = {}): Promise<T> {
    const mixinKey = requestOptions.signed ? await getWbiMixinKey() : undefined;
    const root = await send(url, requestOptions, mixinKey);

    // 签名被风控拒绝时返回 v_voucher，通常意味着口令已过期，刷新后重试一次
    if (mixinKey && isVoucherRejected(root)) {
      const refreshedKey = await getWbiMixinKey(true);

      return unwrap<T>(url, await send(url, requestOptions, refreshedKey));
    }

    return unwrap<T>(url, root);
  }

  async function getWbiMixinKey(forceRefresh = false): Promise<string> {
    if (!forceRefresh && wbiKeys && wbiKeys.expiresAt > Date.now()) {
      return wbiKeys.mixinKey;
    }

    pendingWbiKeys ??= loadWbiKeys().finally(() => {
      pendingWbiKeys = undefined;
    });

    return pendingWbiKeys;
  }

  async function loadWbiKeys() {
    const root = await fetchJson(NAV_URL);

    const wbiImg = (root.data as { wbi_img?: { img_url?: string; sub_url?: string } } | undefined)
      ?.wbi_img;

    const mixinKey = getMixinKey(requireWbiKey(wbiImg?.img_url), requireWbiKey(wbiImg?.sub_url));

    wbiKeys = { mixinKey, expiresAt: Date.now() + WBI_KEY_TTL_MS };

    return mixinKey;
  }

  async function send(
    url: string,
    requestOptions: BiliApiRequest,
    mixinKey?: string,
  ): Promise<BiliResponseRoot> {
    const query: Record<string, string> = {};

    for (const [key, value] of Object.entries(requestOptions.query ?? {})) {
      if (value !== undefined) {
        query[key] = String(value);
      }
    }

    const signedQuery = mixinKey ? signWbiParams(query, mixinKey, nowSeconds()) : query;
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(signedQuery)) {
      params.set(key, String(value));
    }

    const search = params.toString();

    return fetchJson(search ? `${url}?${search}` : url, requestOptions.signal);
  }

  async function fetchJson(url: string, signal?: AbortSignal): Promise<BiliResponseRoot> {
    const timeout = AbortSignal.timeout(timeoutMs);

    const response = await fetchImpl(url, {
      credentials: 'include',
      headers: buildHeaders(),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });

    storeResponseCookies(response);

    if (!response.ok) {
      throw new Error(`请求 ${url} 失败：HTTP ${response.status}`);
    }

    return (await response.json()) as BiliResponseRoot;
  }

  function buildHeaders() {
    const headers: Record<string, string> = {
      Referer: REFERER,
      'User-Agent': userAgent,
    };

    const cookie = serializeCookie(cookies);

    if (cookie) {
      headers.Cookie = cookie;
    }

    return headers;
  }

  function storeResponseCookies(response: Response) {
    // 未登录时接口会通过 Set-Cookie 下发 buvid3 等字段，后续请求需要带上
    for (const rawCookie of response.headers.getSetCookie()) {
      const pair = rawCookie.split(';')[0];
      const separator = pair.indexOf('=');

      if (separator === -1) {
        continue;
      }

      const name = pair.slice(0, separator).trim();

      if (name) {
        cookies.set(name, pair.slice(separator + 1).trim());
      }
    }
  }

  return { request };
}

function unwrap<T>(url: string, root: BiliResponseRoot): T {
  if (root.code !== 0) {
    throw new BiliApiError(url, root.code, root.message || root.msg || '');
  }

  return root.data as T;
}

function isVoucherRejected(root: BiliResponseRoot) {
  if (root.code !== 0) {
    return false;
  }

  const data = root.data as { v_voucher?: unknown } | undefined;

  return typeof data?.v_voucher === 'string';
}

function requireWbiKey(url: string | undefined) {
  // img_url/sub_url 只是伪装成图片链接的实时 Token，取文件名即可
  const key = url?.split('/').pop()?.split('.')[0];

  if (!key) {
    throw new Error('nav 接口未返回 WBI 口令（wbi_img 缺失），无法进行签名请求');
  }

  return key;
}

function parseCookie(cookie: string) {
  const jar = new Map<string, string>();

  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');

    if (separator === -1) {
      continue;
    }

    const name = part.slice(0, separator).trim();

    if (name) {
      jar.set(name, part.slice(separator + 1).trim());
    }
  }

  return jar;
}

function serializeCookie(jar: Map<string, string>) {
  return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ');
}

function nowSeconds() {
  return Math.round(Date.now() / 1000);
}
