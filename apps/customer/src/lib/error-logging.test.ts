import { describe, expect, it, vi } from 'vitest';
import {
  errorLabel,
  logErrorLabel,
  redactConsoleErrors,
  redactExceptionReport,
} from './error-logging';

const marker = 'synthetic-customer-marker';

describe('error logging', () => {
  it('labels an error by its name only', () => {
    expect(errorLabel(new TypeError(marker))).toBe('TypeError');
    expect(errorLabel(marker)).toBe('string');
  });

  it('never writes the message of a caught error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logErrorLabel(new RangeError(marker));
    expect(JSON.stringify(spy.mock.calls)).not.toContain(marker);
    expect(spy).toHaveBeenCalledWith('Unexpected error: RangeError');
    spy.mockRestore();
  });

  it('redacts errors that libraries pass to console.error and console.warn', () => {
    const error = vi.fn();
    const warn = vi.fn();
    const target = { error, warn };
    redactConsoleErrors(target);

    const cause = new Error(marker);
    target.error('The above error occurred in a component:', cause);
    target.warn(cause);

    expect(error).toHaveBeenCalledWith('The above error occurred in a component:', '[Error]');
    expect(warn).toHaveBeenCalledWith('[Error]');
    expect(JSON.stringify([...error.mock.calls, ...warn.mock.calls])).not.toContain(marker);
  });

  it('keeps a native exception report to the error name', () => {
    // The shape React Native's ExceptionsManager builds for a render error in a release build.
    const report = {
      message: `TypeError: ${marker}\n\nThis error is located at:\n    in HomeScreen`,
      originalMessage: marker,
      name: 'TypeError',
      componentStack: '\n    in HomeScreen',
      stack: [{ methodName: 'HomeScreen', file: 'entry.hbc', lineNumber: 1, column: 2 }],
      id: 1,
      isFatal: false,
      extraData: { jsEngine: 'hermes', rawStack: `TypeError: ${marker}\n    at HomeScreen` },
    };

    const redacted = redactExceptionReport(report);

    expect(JSON.stringify(redacted)).not.toContain(marker);
    expect(redacted).toMatchObject({
      message: 'TypeError',
      originalMessage: null,
      name: 'TypeError',
      componentStack: report.componentStack,
      stack: report.stack,
      extraData: {},
    });
  });
});
