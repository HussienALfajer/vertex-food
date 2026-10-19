import { posix } from 'node:path';
import * as common from '@nestjs/common';
import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants.js';
import * as core from '@nestjs/core';
import ts from 'typescript';
import { schemaId } from '../../src/core/openapi/openapi.js';
import type { Route } from '../../src/core/routes.js';

/**
 * The rules ADR 0020 puts on the API's shape, as functions that return their violations, so the
 * architecture test can run them on the real application and prove each one on a broken example.
 * Copied from Vertex Shifa and adapted to Vertex Food's layers and access kinds.
 */

export function routeViolations(routes: Route[]): string[] {
  const violations: string[] = [];
  for (const route of routes) {
    if (!route.access) {
      violations.push(
        `${route.name} declares no access (@Public, @CustomerRoute, @DriverRoute, @StaffRoute or @ConsoleRoute)`,
      );
    }
    if (!route.entitlement) {
      violations.push(`${route.name} declares no entitlement (@RequiresFeature or @NoFeature)`);
    }
    const underConsole = route.path === '/api/console' || route.path.startsWith('/api/console/');
    if ((route.access?.kind === 'console') !== underConsole) {
      violations.push(`${route.name}: console routes, and only they, live under /api/console/`);
    }
    if (!schemaId(route.responseSchema)) {
      violations.push(
        `${route.name} declares no response schema with an id (@SerializeOptions({ schema }))`,
      );
    }
    if (route.rawResponse) {
      violations.push(`${route.name} takes @Res() or @Next(), which skip the response serializer`);
    }
  }
  return violations;
}

/**
 * Classes Nest constructs whose constructor takes a parameter without `@Inject(token)`: the build
 * emits no decorator metadata, so such a parameter would silently be `undefined`.
 */
export function injectionViolations(app: common.INestApplication): string[] {
  const classes = new Set<new (...args: never[]) => unknown>();
  for (const module of app.get(core.ModulesContainer).values()) {
    classes.add(module.metatype as new (...args: never[]) => unknown);
    for (const wrapper of [
      ...module.providers.values(),
      ...module.controllers.values(),
      ...module.injectables.values(),
      ...module.middlewares.values(),
    ]) {
      // A provider built by a factory (`useFactory`) is constructed by the factory, not by Nest.
      if (wrapper.inject) continue;
      if (typeof wrapper.metatype === 'function' && wrapper.metatype.prototype) {
        classes.add(wrapper.metatype as new (...args: never[]) => unknown);
      }
    }
  }
  const nest = new Set<unknown>([...Object.values(common), ...Object.values(core)]);
  const violations: string[] = [];
  for (const type of classes) {
    // Nest's own classes are compiled with metadata or are Nest's exports (ModuleRef).
    if (nest.has(type) || Reflect.hasMetadata('design:paramtypes', type)) continue;
    const injected: unknown[] = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, type) ?? [];
    if (type.length > injected.length) {
      violations.push(`${type.name} has constructor parameters without @Inject(token)`);
    }
  }
  return violations;
}

/**
 * The folders of `modules/` and the rank of their layer (ADR 0001): 1 platform, 2 food, 3 the
 * products. A module depends only on its own layer or below.
 */
const RANK: Record<string, number> = {
  platform: 1,
  food: 2,
  restaurant: 3,
  marketplace: 3,
  dispatch: 3,
};
const LAYERS = Object.keys(RANK);

function mayImport(from: string, to: string): boolean {
  return (RANK[to] ?? Number.POSITIVE_INFINITY) <= (RANK[from] ?? 0);
}

type Place =
  | { area: 'module'; layer: string; module: string }
  | { area: 'core' }
  | { area: 'other' };

function place(file: string): Place {
  const parts = file.split('/');
  if (parts[0] === 'core') return { area: 'core' };
  const [first, layer, module] = parts;
  if (first === 'modules' && layer && module && parts.length >= 4) {
    return { area: 'module', layer, module };
  }
  return { area: 'other' };
}

/**
 * Module boundaries in `src/` (ADR 0001, ADR 0020), from each file's imports. `files` maps a path
 * relative to `src/` (with `/`) to its source. A module lives in `modules/<layer>/<module>/`,
 * reaches another module only through its `index.ts`, and only in a layer it may import; `core/`
 * imports no module.
 */
export function boundaryViolations(files: Map<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, source] of files) {
    const from = place(file);
    if (file.startsWith('modules/') && (from.area !== 'module' || !LAYERS.includes(from.layer))) {
      violations.push(`${file} is not in modules/<${LAYERS.join('|')}>/<module>/`);
      continue;
    }
    for (const { fileName } of ts.preProcessFile(source, true, true).importedFiles) {
      if (!fileName.startsWith('.')) continue;
      const target = posix.join(posix.dirname(file), fileName).replace(/\.js$/, '.ts');
      const to = place(target);
      if (to.area !== 'module') continue;
      if (from.area === 'core') {
        violations.push(`${file} imports ${target}: the core imports no module`);
        continue;
      }
      if (from.area !== 'module' || (from.layer === to.layer && from.module === to.module)) {
        continue;
      }
      if (target !== `modules/${to.layer}/${to.module}/index.ts`) {
        violations.push(`${file} imports ${target}: another module only through its index.ts`);
      }
      if (!mayImport(from.layer, to.layer)) {
        violations.push(
          `${file} imports ${target}: the ${from.layer} layer may not use ${to.layer}`,
        );
      }
    }
  }
  return violations;
}

/**
 * Tables only their owning module touches (ADR 0004): platform tables reached without RLS. A file
 * outside the module that imports one of them from `@vertex-food/db` is a violation.
 */
export function tableOwnershipViolations(
  files: Map<string, string>,
  owned: Record<string, string>,
): string[] {
  const violations: string[] = [];
  for (const [file, source] of files) {
    const from = place(file);
    const imports = [
      ...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'@vertex-food\/db'/g),
    ].flatMap((match) =>
      (match[1] ?? '').split(',').map((name) => name.trim().replace(/^type\s+/, '')),
    );
    for (const name of imports) {
      const owner = owned[name];
      if (!owner) continue;
      if (from.area !== 'module' || `${from.layer}/${from.module}` !== owner) {
        violations.push(`${file} imports ${name}: only modules/${owner} touches it`);
      }
    }
  }
  return violations;
}
