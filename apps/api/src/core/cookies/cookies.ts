import {
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, tap } from 'rxjs';

/** A cookie a handler sets or clears; always `HttpOnly`, `Secure` and `SameSite=Strict`. */
export type CookieInstruction = {
  name: string;
  /** Null clears the cookie. */
  value: string | null;
  path: string;
  maxAgeSeconds: number;
};

/** What a handler receives from `@ResponseCookies()`: cookies written with its answer. */
export class CookieJar {
  readonly instructions: CookieInstruction[] = [];

  set(name: string, value: string, path: string, maxAgeSeconds: number): void {
    this.instructions.push({ name, value, path, maxAgeSeconds });
  }

  clear(name: string, path: string): void {
    this.instructions.push({ name, value: null, path, maxAgeSeconds: 0 });
  }
}

type JarRequest = { cookieJar?: CookieJar };

/**
 * The cookies of the answer (spec S02 rules 12, 35): handlers never take `@Res()` (ADR 0020), so
 * they write cookies here and `CookieWriter` sets them once the handler succeeds.
 */
export const ResponseCookies = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<JarRequest>();
  request.cookieJar ??= new CookieJar();
  return request.cookieJar;
});

export function serializeCookie(cookie: CookieInstruction): string {
  return [
    `${cookie.name}=${cookie.value ?? ''}`,
    `Path=${cookie.path}`,
    `Max-Age=${cookie.maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
}

/** Writes the `Set-Cookie` headers of a handler's `CookieJar` with its successful answer. */
@Injectable()
export class CookieWriter implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    return next.handle().pipe(
      tap(() => {
        const jar = http.getRequest<JarRequest>().cookieJar;
        if (!jar || jar.instructions.length === 0) return;
        http
          .getResponse<{ append(name: string, value: string[]): void }>()
          .append('Set-Cookie', jar.instructions.map(serializeCookie));
      }),
    );
  }
}
