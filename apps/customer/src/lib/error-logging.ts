/**
 * What the customer app may log about an error: its name, never its message or stack, which may
 * carry customer data (ADR 0016).
 */
export function errorLabel(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Logs a caught error by its label only; for the route error boundaries. */
export function logErrorLabel(error: unknown): void {
  console.error(`Unexpected error: ${errorLabel(error)}`);
}

/**
 * Replaces every `Error` passed to `console.error` and `console.warn` with its label, so libraries
 * that log errors themselves (React, Expo Router) never write a message or stack.
 */
export function redactConsoleErrors(target: Pick<Console, 'error' | 'warn'>): void {
  for (const level of ['error', 'warn'] as const) {
    const write = target[level].bind(target);
    target[level] = (...args: unknown[]) =>
      write(...args.map((arg) => (arg instanceof Error ? `[${errorLabel(arg)}]` : arg)));
  }
}

/** The fields of React Native's exception report that carry an error's text. */
export type ExceptionReport = {
  message: string;
  originalMessage?: string | null;
  name?: string | null;
  extraData?: object;
};

/**
 * Keeps an exception report to the error's name. React Native builds one for every uncaught error
 * and every error a React boundary catches, and in a release build hands it to native code (device
 * logs, crash reports) with the message and the raw stack, whose first line is the message.
 * Component and parsed stack frames stay: they name code, not data.
 */
export function redactExceptionReport<Report extends ExceptionReport>(report: Report): Report {
  return { ...report, message: report.name || 'Error', originalMessage: null, extraData: {} };
}
