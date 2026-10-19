/**
 * What the renderer may log about an error: its name, never its message or stack, which may carry
 * customer data (ADR 0016).
 */
export function errorLabel(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Logs a caught error by its label only; for React's root and the router's error hooks. */
export function logErrorLabel(error: unknown): void {
  console.error(`Unexpected error: ${errorLabel(error)}`);
}

/**
 * Replaces every `Error` passed to `console.error` and `console.warn` with its label, so libraries
 * that log errors themselves (TanStack Router logs loader and navigation errors) never write a
 * message or stack.
 */
export function redactConsoleErrors(target: Pick<Console, 'error' | 'warn'>): void {
  for (const level of ['error', 'warn'] as const) {
    const write = target[level].bind(target);
    target[level] = (...args: unknown[]) =>
      write(...args.map((arg) => (arg instanceof Error ? `[${errorLabel(arg)}]` : arg)));
  }
}
