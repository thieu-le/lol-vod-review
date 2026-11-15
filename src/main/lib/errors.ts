// Typed application error so services never surface raw/unknown throwables.

export type AppErrorCode =
  | 'RIOT_UNAVAILABLE'
  | 'DB_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly cause?: unknown;

  constructor(code: AppErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

export function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
