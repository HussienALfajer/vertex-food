/**
 * Whether `error` is PostgreSQL's unique violation (23505), optionally of the named constraint or
 * index. Drizzle wraps the driver's error as its `cause`.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return false;
  if (cause.code !== '23505') return false;
  return constraint === undefined || ('constraint' in cause && cause.constraint === constraint);
}
