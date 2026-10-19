import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { DomainError } from '@vertex-food/contracts';
import { catchError, type Observable, throwError } from 'rxjs';

/**
 * An upload multer refused (too large, extra parts, wrong field) is a rejected file. Placed before
 * `FileInterceptor` in `@UseInterceptors`. Copied from Vertex Shifa.
 */
@Injectable()
export class RejectedUpload implements NestInterceptor {
  intercept(_: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          throwError(() =>
            error instanceof HttpException
              ? new DomainError('FILE_REJECTED', 'Upload refused')
              : error,
          ),
        ),
      );
  }
}
