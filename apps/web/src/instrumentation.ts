import { redactConsoleErrors } from './lib/error-logging';

// Next.js logs request errors with their message and stack, which may carry restaurant or customer data
// (ADR 0016): the server writes errors by name only.
export function register(): void {
  redactConsoleErrors(console);
}
