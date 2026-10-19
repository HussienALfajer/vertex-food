import ExceptionsManager from 'react-native/Libraries/Core/ExceptionsManager';
import { redactExceptionReport } from './error-logging';

/**
 * Every error React Native reports (uncaught, or caught by a React boundary) reaches native code
 * by its name only (ADR 0016).
 */
export function redactNativeErrorReports(): void {
  ExceptionsManager.unstable_setExceptionDecorator(redactExceptionReport);
}
