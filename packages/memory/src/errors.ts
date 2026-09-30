export type MemoryErrorCode =
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_ACCESS_DENIED'
  | 'MEMORY_REVISION_CONFLICT'
  | 'MEMORY_ARCHIVED'
  | 'MEMORY_CLOSED'
  | 'MEMORY_VALIDATION_FAILED';

export class MemoryError extends Error {
  constructor(
    message: string,
    readonly code: MemoryErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class MemoryNotFoundError extends MemoryError {
  constructor(message = '记忆不存在', options?: ErrorOptions) {
    super(message, 'MEMORY_NOT_FOUND', options);
  }
}

export class MemoryAccessError extends MemoryError {
  constructor(message = '无权访问这条记忆', options?: ErrorOptions) {
    super(message, 'MEMORY_ACCESS_DENIED', options);
  }
}

export class MemoryConflictError extends MemoryError {
  constructor(message = '记忆版本已变化', options?: ErrorOptions) {
    super(message, 'MEMORY_REVISION_CONFLICT', options);
  }
}

export class MemoryArchivedError extends MemoryError {
  constructor(message = '记忆已经归档', options?: ErrorOptions) {
    super(message, 'MEMORY_ARCHIVED', options);
  }
}

export class MemoryClosedError extends MemoryError {
  constructor(message = 'MemoryManager 已关闭或正在关闭', options?: ErrorOptions) {
    super(message, 'MEMORY_CLOSED', options);
  }
}

export class MemoryValidationError extends MemoryError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'MEMORY_VALIDATION_FAILED', options);
  }
}
