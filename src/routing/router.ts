/**
 * Routing (REQ-013 .. REQ-018).
 *
 * Path matching is done here rather than by the HTTP framework's router so that the three rules
 * the requirements state — whole-segment templates, case sensitivity, trailing-slash significance —
 * hold exactly, and so that a matched path with an undocumented method can be told apart from an
 * unmatched path.
 */

import { pointerOf } from '../spec/pointer.js';
import {
  HTTP_METHODS,
  isRecord,
  type HttpMethod,
  type OpenApiDocument,
  type OperationObject,
  type ParameterObject,
  type PathItemObject,
} from '../spec/types.js';

/** A template segment is a whole segment of the form `{name}` and nothing else (REQ-014). */
const TEMPLATE_SEGMENT = /^\{([^{}]+)\}$/;

interface Segment {
  /** Present for `{name}` segments; absent for literal ones. */
  parameter?: string;
  literal: string;
}

export interface RouteOperation {
  method: HttpMethod;
  operation: OperationObject;
  /** Path-item parameters merged with the operation's own (REQ-020). */
  parameters: ParameterObject[];
  pointer: string;
}

export interface Route {
  /** The `paths` key, e.g. `/pets/{petId}`. */
  template: string;
  /** The base path plus the template — the route a client actually calls (REQ-018). */
  routePath: string;
  segments: Segment[];
  /** Documented methods, in document order, for the `Allow` header (REQ-017). */
  methodOrder: HttpMethod[];
  operations: Map<HttpMethod, RouteOperation>;
}

export interface RouteMatch {
  route: Route;
  /** Percent-decoded path parameter values. */
  pathParams: Record<string, string>;
}

export class Router {
  private readonly routes: Route[];

  constructor(document: OpenApiDocument, basePath: string) {
    this.routes = buildRoutes(document, basePath).sort(bySpecificity);
  }

  /** The most specific route whose template matches, or `undefined` for REQ-016's `404`. */
  match(decodedSegments: string[]): RouteMatch | undefined {
    for (const route of this.routes) {
      const pathParams = matchSegments(route.segments, decodedSegments);
      if (pathParams !== undefined) return { route, pathParams };
    }
    return undefined;
  }
}

function buildRoutes(document: OpenApiDocument, basePath: string): Route[] {
  const routes: Route[] = [];

  for (const [template, pathItem] of Object.entries(document.paths ?? {})) {
    if (!isRecord(pathItem)) continue;
    const item = pathItem as PathItemObject;
    const pathPointer = pointerOf('paths', template);
    const inherited = Array.isArray(item.parameters) ? item.parameters : [];

    const operations = new Map<HttpMethod, RouteOperation>();
    const methodOrder: HttpMethod[] = [];

    // Document order, not the canonical method order: `Allow` echoes the document (REQ-017).
    for (const member of Object.keys(item)) {
      if (!(HTTP_METHODS as readonly string[]).includes(member)) continue;
      const method = member as HttpMethod;
      const operation = item[method];
      if (!isRecord(operation)) continue;
      const own = Array.isArray((operation as OperationObject).parameters)
        ? ((operation as OperationObject).parameters as ParameterObject[])
        : [];
      methodOrder.push(method);
      operations.set(method, {
        method,
        operation: operation as OperationObject,
        parameters: mergeParameters(inherited, own),
        pointer: `${pathPointer}/${method}`,
      });
    }

    if (operations.size === 0) continue;

    const routePath = `${basePath}${template}`;
    routes.push({
      template,
      routePath,
      segments: splitTemplate(routePath),
      methodOrder,
      operations,
    });
  }

  return routes;
}

/** REQ-020: an operation parameter replaces the path-item one with the same `name` and `in`. */
function mergeParameters(inherited: ParameterObject[], own: ParameterObject[]): ParameterObject[] {
  const key = (parameter: ParameterObject): string => `${String(parameter.in)}:${String(parameter.name)}`;
  const merged = new Map<string, ParameterObject>();
  for (const parameter of inherited) if (isRecord(parameter)) merged.set(key(parameter), parameter);
  for (const parameter of own) if (isRecord(parameter)) merged.set(key(parameter), parameter);
  return [...merged.values()];
}

function splitTemplate(routePath: string): Segment[] {
  return routePath
    .split('/')
    .slice(1)
    .map((literal) => {
      const templated = TEMPLATE_SEGMENT.exec(literal);
      return templated === null ? { literal } : { literal, parameter: templated[1] as string };
    });
}

function matchSegments(
  segments: Segment[],
  requested: string[],
): Record<string, string> | undefined {
  if (segments.length !== requested.length) return undefined;

  const pathParams: Record<string, string> = {};
  for (const [index, segment] of segments.entries()) {
    const value = requested[index] as string;
    if (segment.parameter === undefined) {
      if (segment.literal !== value) return undefined;
    } else {
      // An empty segment never fills a template variable: `/pets/` is not `/pets/{petId}`.
      if (value === '') return undefined;
      pathParams[segment.parameter] = value;
    }
  }
  return pathParams;
}

/** REQ-015: decided segment by segment from the left; a literal always beats a template. */
function bySpecificity(left: Route, right: Route): number {
  const shared = Math.min(left.segments.length, right.segments.length);
  for (let index = 0; index < shared; index += 1) {
    const leftTemplated = left.segments[index]?.parameter !== undefined;
    const rightTemplated = right.segments[index]?.parameter !== undefined;
    if (leftTemplated !== rightTemplated) return leftTemplated ? 1 : -1;
  }
  if (left.segments.length !== right.segments.length) {
    return left.segments.length - right.segments.length;
  }
  return left.routePath < right.routePath ? -1 : left.routePath > right.routePath ? 1 : 0;
}

/**
 * Splits a request path into percent-decoded segments (REQ-014).
 * A segment that is not valid percent-encoding is kept verbatim rather than rejected.
 */
export function decodePathSegments(path: string): string[] {
  return path
    .split('/')
    .slice(1)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}
