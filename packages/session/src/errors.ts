export type SessionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_ACCESS_DENIED'
  | 'SESSION_COMPACTION_CONFLICT'
  | 'SESSION_CLOSED'
  | 'SESSION_VALIDATION_FAILED';

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code: SessionErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class SessionNotFoundError extends SessionError {
  constructor(message = 'Session 不存在', options?: ErrorOptions) {
    super(message, 'SESSION_NOT_FOUND', options);
  }
}

export class SessionAccessError extends SessionError {
  constructor(message = '无权访问这个 Session', options?: ErrorOptions) {
    super(message, 'SESSION_ACCESS_DENIED', options);
  }
}

export class SessionCompactionConflictError extends SessionError {
  constructor(message = 'Session 压缩边界已变化', options?: ErrorOptions) {
    super(message, 'SESSION_COMPACTION_CONFLICT', options);
  }
}

export class SessionClosedError extends SessionError {
  constructor(message = 'SessionManager 已关闭或正在关闭', options?: ErrorOptions) {
    super(message, 'SESSION_CLOSED', options);
  }
}

export class SessionValidationError extends SessionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'SESSION_VALIDATION_FAILED', options);
  }
}
