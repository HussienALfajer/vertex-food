/** The SQLSTATEs of a session deadline (`DATABASE_DEADLINES` in `@vertex-food/db`). */
const DEADLINE_CODES = new Set([
  // query_canceled: `statement_timeout` passed.
  '57014',
  // lock_not_available: `lock_timeout` passed while waiting for a row or advisory lock.
  '55P03',
]);

/**
 * Whether `error` is a statement or lock deadline: the transaction was rolled back and the same
 * request may succeed a moment later. Drizzle wraps the driver's error as its `cause`.
 */
export function isDeadlineExceeded(error: unknown): boolean {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    DEADLINE_CODES.has(cause.code)
  );
}
