import { DrizzleQueryError } from 'drizzle-orm';

/** A PostgreSQL error from node-postgres: its message and detail may quote the row's values. */
function isDatabaseError(error: Error): error is Error & {
  code: string;
  table?: string;
  column?: string;
  constraint?: string;
} {
  return 'severity' in error && 'code' in error && typeof error.code === 'string';
}

/**
 * A log line for an unexpected error that names it without its data (ADR 0016: no customer phone,
 * address or driver location in logs). A failed Drizzle query is described by its cause only,
 * because its own message lists the query's parameters. A database error keeps its SQLSTATE,
 * table, column and constraint, never its message or detail, which can quote values; any other
 * error keeps its stack.
 */
export function describeForLog(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    return error.cause === undefined ? 'Query failed' : describeForLog(error.cause);
  }
  if (!(error instanceof Error)) return `Non-error thrown: ${typeof error}`;
  if (isDatabaseError(error)) {
    const where = [error.table, error.column, error.constraint].filter(Boolean).join(' ');
    return `Database error ${error.code}${where ? ` on ${where}` : ''}`;
  }
  return error.stack ?? `${error.name}: ${error.message}`;
}
