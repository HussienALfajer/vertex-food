import { redactConsoleErrors } from './lib/error-logging';

// Runs before the app hydrates: errors React or Next.js log in the browser are written by name
// only (ADR 0016).
redactConsoleErrors(console);
