/** 可以直接展示给用户的错误。hint 说明下一步怎么做。 */
export class UserError extends Error {
  readonly hint?: string;
  /** 供调用方区分处理的错误种类 */
  readonly code?: 'duplicate';
  constructor(message: string, hint?: string, code?: 'duplicate') {
    super(message);
    this.name = 'UserError';
    this.hint = hint;
    this.code = code;
  }
}

export class CancelledError extends Error {
  constructor() {
    super('已取消');
    this.name = 'CancelledError';
  }
}

export function describeError(error: unknown): { message: string; hint?: string } {
  if (error instanceof UserError) return { message: error.message, hint: error.hint };
  const e = error as NodeJS.ErrnoException;
  switch (e?.code) {
    case 'ENOSPC':
      return { message: '磁盘空间不足', hint: '清理磁盘，或在设置里把工作目录换到别的盘。' };
    case 'EACCES':
    case 'EPERM':
      return { message: `没有权限访问 ${e.path ?? '该文件'}`, hint: '确认文件没有被占用，也不在受保护的系统目录里。' };
    case 'EBUSY':
      return { message: `文件被占用：${e.path ?? ''}`, hint: '关闭正在使用它的程序后重试。' };
    case 'ENOENT':
      return { message: `找不到文件：${e.path ?? ''}` };
  }
  return { message: e?.message || String(error) };
}
