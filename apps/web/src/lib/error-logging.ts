/**
 * What the web app may log about an error: its name, never its message or stack, which may carry
 * restaurant or customer data (ADR 0016).
 */
export function errorLabel(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Logs a caught error by its label only; for the error boundaries. */
export function logErrorLabel(error: unknown): void {
  console.error(`Unexpected error: ${errorLabel(error)}`);
}

/**
 * Replaces every `Error` passed to `console.error` and `console.warn` with its label, so code that
 * logs errors itself (Next.js on the server, React in the browser) never writes a message or stack.
 */
export function redactConsoleErrors(target: Pick<Console, 'error' | 'warn'>): void {
  for (const level of ['error', 'warn'] as const) {
    const write = target[level].bind(target);
    target[level] = (...args: unknown[]) =>
      write(...args.map((arg) => (arg instanceof Error ? `[${errorLabel(arg)}]` : arg)));
  }
}
