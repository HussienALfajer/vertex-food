import { describeForLog } from '@vertex-food/db';
import { DrizzleQueryError } from 'drizzle-orm';

/**
 * A log line for an error that never carries its data (spec S03, "Customer data"): a database
 * error by its SQLSTATE and constraint (`describeForLog`), anything else by its name only, because
 * a WhatsApp library's message or stack can quote a phone or a WhatsApp address.
 */
export function describeError(error: unknown): string {
  if (error instanceof DrizzleQueryError) return describeForLog(error);
  if (error instanceof Error && 'severity' in error && 'code' in error)
    return describeForLog(error);
  if (error instanceof Error) return error.name;
  return `Non-error thrown: ${typeof error}`;
}
