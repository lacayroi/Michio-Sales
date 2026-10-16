/** Domain error with a stable code; route handlers map it to an HTTP status. */
export class DomainError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR' | 'INVALID_STATE',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (what: string) => new DomainError('NOT_FOUND', `Không tìm thấy ${what}`);
