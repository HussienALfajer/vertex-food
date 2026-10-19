import { describe, expect, it, vi } from 'vitest';
import { errorLabel, logErrorLabel, redactConsoleErrors } from './error-logging';

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
    target.error('Error in route match:', cause);
    target.warn(cause);

    expect(error).toHaveBeenCalledWith('Error in route match:', '[Error]');
    expect(warn).toHaveBeenCalledWith('[Error]');
    expect(JSON.stringify([...error.mock.calls, ...warn.mock.calls])).not.toContain(marker);
  });
});
