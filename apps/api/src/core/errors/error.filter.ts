import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  DomainError,
  type ErrorCode,
  type ErrorResponse,
  errorStatus,
} from '@vertex-food/contracts';
import { describeForLog } from '@vertex-food/db';

/** The code of an HTTP error Nest or Express raised before a handler ran (no route, bad JSON). */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 413:
    case 415:
    case 422:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
    case 405:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

/** An error from Express middleware (the body parser) that is safe to show: `http-errors` shape. */
function isExposedHttpError(error: unknown): error is { status: number; message: string } {
  return (
    error instanceof Error &&
    'expose' in error &&
    error.expose === true &&
    'status' in error &&
    typeof error.status === 'number'
  );
}

export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof DomainError) return { code: error.code, message: error.message };
  const http =
    error instanceof HttpException
      ? { status: error.getStatus(), message: error.message }
      : isExposedHttpError(error)
        ? error
        : undefined;
  // A fixed message: the framework's own text can quote the request (URL, query, body).
  const code = http ? codeForStatus(http.status) : 'INTERNAL_ERROR';
  return { code, message: fixedMessage[code] ?? 'Internal error' };
}

const fixedMessage: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Malformed request',
  UNAUTHENTICATED: 'No session',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  RATE_LIMITED: 'Too many requests',
  SERVICE_UNAVAILABLE: 'Service unavailable',
};

/**
 * Every error leaves the API as `{ code, message }` with the status of its code (ADR 0020).
 * Unexpected errors answer `INTERNAL_ERROR` with a generic message and are logged without their
 * data (ADR 0016); refusals are not logged.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  constructor(@Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost) {}

  catch(error: unknown, host: ArgumentsHost) {
    const body = toErrorResponse(error);
    if (body.code === 'INTERNAL_ERROR') this.logger.error(describeForLog(error));
    const { httpAdapter } = this.adapterHost;
    httpAdapter.reply(host.switchToHttp().getResponse(), body, errorStatus[body.code]);
  }
}
