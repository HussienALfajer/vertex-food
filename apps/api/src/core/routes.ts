import { type INestApplication, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_PATH,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { CLASS_SERIALIZER_OPTIONS } from '@nestjs/common/serializer/class-serializer.constants.js';
import { ModulesContainer } from '@nestjs/core';
import { API_PREFIX } from '../app.js';
import {
  ACCESS,
  type Access,
  ENTITLEMENT,
  type Entitlement,
  SUSPENDED_ALLOWED,
} from './access/access.decorators.js';
import { FILE_TYPE } from './http/file-head.js';

/** One HTTP route of the application with what it declares. Copied from Vertex Shifa. */
export type Route = {
  /** `Controller.handler`, for messages. */
  name: string;
  method: string;
  /** The success status: `@HttpCode()`, else Nest's default (201 for POST, 200 otherwise). */
  status: number;
  /** Full path with Nest parameters: `/api/branches/:id`. */
  path: string;
  access: Access | undefined;
  entitlement: Entitlement | undefined;
  /** `@SuspendedAllowed()`: a staff write a suspended tenant still makes (spec S05 rule 22). */
  suspendedAllowed: boolean;
  /** From `@SerializeOptions({ schema })`: what the route answers. */
  responseSchema: unknown;
  /** Takes `@Res()` or `@Next()`, which answer outside the response serializer. */
  rawResponse: boolean;
  /** A file route's `@FileType()`; the image routes declare none. */
  contentType?: string;
  /** What the route takes, from `@Body({ schema })`, `@Query({ schema })`, `@Param(name, { schema })`. */
  request: {
    body: unknown;
    query: unknown;
    params: { name: string; schema: unknown }[];
    /** Takes `@UploadedFile()`: a `multipart/form-data` upload in the field `file`. */
    file: boolean;
  };
};

type ParamMetadata = { data?: unknown; schema?: unknown };

/** The request side of a route, from its parameter decorators. */
function requestOf(params: Record<string, ParamMetadata>): Route['request'] {
  const request: Route['request'] = { body: undefined, query: undefined, params: [], file: false };
  for (const [key, param] of Object.entries(params)) {
    const type = Number(key.split(':')[0]);
    if (type === RouteParamtypes.BODY && param.data === undefined) request.body = param.schema;
    if (type === RouteParamtypes.QUERY && param.data === undefined) request.query = param.schema;
    if (type === RouteParamtypes.PARAM && typeof param.data === 'string') {
      request.params.push({ name: param.data, schema: param.schema });
    }
    if (type === RouteParamtypes.FILE) request.file = true;
  }
  return request;
}

function paths(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [typeof value === 'string' ? value : '/'];
}

function join(...parts: string[]): string {
  const path = parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/');
  return `/${path}`;
}

/** Method names of a prototype and its ancestors, as Nest's `MetadataScanner.getAllMethodNames`. */
function methodNames(prototype: object): string[] {
  const names = new Set<string>();
  for (
    let current: object | null = prototype;
    current && current !== Object.prototype;
    current = Reflect.getPrototypeOf(current)
  ) {
    for (const property of Object.getOwnPropertyNames(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, property);
      if (property === 'constructor' || typeof descriptor?.value !== 'function') continue;
      names.add(property);
    }
  }
  return [...names];
}

/** The handler's own metadata, else its controller's (as `Reflector.getAllAndOverride` reads). */
function declared<T>(key: unknown, handler: object, controller: object): T | undefined {
  return Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
}

/**
 * Every route the application serves, read from Nest's metadata. Used by the architecture test
 * and to build the OpenAPI document.
 */
export function listRoutes(app: INestApplication): Route[] {
  const routes: Route[] = [];
  const modules = app.get(ModulesContainer);
  for (const module of modules.values()) {
    // A `RouterModule` path, read as Nest's `RoutesResolver` does.
    const modulePath: string =
      Reflect.getMetadata(MODULE_PATH + modules.applicationId, module.metatype) ??
      Reflect.getMetadata(MODULE_PATH, module.metatype) ??
      '';
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!controller) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const property of methodNames(prototype)) {
        const handler = prototype[property] as object;
        const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const options = declared<{ schema?: unknown }>(
          CLASS_SERIALIZER_OPTIONS,
          handler,
          controller,
        );
        const params: Record<string, ParamMetadata> =
          Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, property) ?? {};
        const rawResponse = Object.keys(params).some((key) => {
          const type = Number(key.split(':')[0]);
          return type === RouteParamtypes.RESPONSE || type === RouteParamtypes.NEXT;
        });
        for (const base of paths(Reflect.getMetadata(PATH_METADATA, controller))) {
          for (const own of paths(Reflect.getMetadata(PATH_METADATA, handler))) {
            routes.push({
              name: `${controller.name}.${property}`,
              method: RequestMethod[method],
              status:
                Reflect.getMetadata(HTTP_CODE_METADATA, handler) ??
                (method === RequestMethod.POST ? 201 : 200),
              path: join(API_PREFIX, modulePath, base, own),
              access: declared(ACCESS, handler, controller),
              entitlement: declared(ENTITLEMENT, handler, controller),
              suspendedAllowed: Reflect.getMetadata(SUSPENDED_ALLOWED, handler) === true,
              responseSchema: options?.schema,
              rawResponse,
              contentType: Reflect.getMetadata(FILE_TYPE, handler),
              request: requestOf(params),
            });
          }
        }
      }
    }
  }
  return routes;
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Declarations that cannot hold, checked when the application starts (spec S05 rules 20, 22): a
 * feature on a route without a tenant session (console, public, ticket, customer, driver), and
 * `@SuspendedAllowed()` on anything but a staff write.
 */
export function declarationViolations(routes: Route[]): string[] {
  const violations: string[] = [];
  for (const route of routes) {
    const kind = route.access?.kind;
    if (route.entitlement?.kind === 'feature' && kind !== 'staff' && kind !== 'device') {
      violations.push(`${route.name}: only staff and device routes can require a feature`);
    }
    if (route.suspendedAllowed && (kind !== 'staff' || !WRITES.has(route.method))) {
      violations.push(`${route.name}: @SuspendedAllowed() marks staff writes only`);
    }
  }
  return violations;
}
