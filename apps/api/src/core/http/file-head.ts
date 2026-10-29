import {
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, tap } from 'rxjs';

export const FILE_TYPE = Symbol('FileType');

/**
 * The media type of a file route's bytes, for the OpenAPI document (`listRoutes`); the answer's
 * own `Content-Type` comes from its `StreamableFile`, so an error still leaves as JSON. Routes
 * without it serve the stored images.
 */
export const FileType = (mediaType: string): MethodDecorator =>
  ((_target: object, _property: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(FILE_TYPE, mediaType, descriptor.value);
  }) as MethodDecorator;

/**
 * The status and headers of a file answer (`StreamableFile`) beyond what the file sets: a partial
 * download's `206` or `416` with its `Content-Range` (spec S06 rule 17). Handlers never take
 * `@Res()` (ADR 0020), so they write them here and `FileHeadWriter` applies them.
 */
export class FileHead {
  status: number | null = null;
  readonly headers = new Map<string, string>();

  set(name: string, value: string): void {
    this.headers.set(name, value);
  }
}

type HeadRequest = { fileHead?: FileHead };

export const ResponseFileHead = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<HeadRequest>();
  request.fileHead ??= new FileHead();
  return request.fileHead;
});

type HeadResponse = {
  setHeader(name: string, value: string): void;
  statusCode: number;
  once(event: 'pipe', listener: () => void): void;
};

/**
 * Applies a handler's `FileHead` with its successful answer. Nest sets the route's status (200)
 * just before it pipes the file into the response, so the status is set when the pipe starts,
 * before the first byte is written.
 */
@Injectable()
export class FileHeadWriter implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    return next.handle().pipe(
      tap(() => {
        const head = http.getRequest<HeadRequest>().fileHead;
        if (!head) return;
        const response = http.getResponse<HeadResponse>();
        for (const [name, value] of head.headers) response.setHeader(name, value);
        const { status } = head;
        if (status !== null) {
          response.once('pipe', () => {
            response.statusCode = status;
          });
        }
      }),
    );
  }
}
