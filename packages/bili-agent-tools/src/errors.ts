/** B 站接口返回非 0 code 时抛出。 */
export class BiliApiError extends Error {
  readonly code: number;
  readonly url: string;

  constructor(url: string, code: number, message: string) {
    super(`B站接口返回错误：${message || '未知错误'}（code=${code}）`);
    this.name = 'BiliApiError';
    this.url = url;
    this.code = code;
  }
}
