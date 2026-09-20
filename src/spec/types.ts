/**
 * A deliberately thin view of the OpenAPI 3.0 document.
 *
 * The document has already been validated against the OpenAPI 3.0 meta-schema by the time these
 * types are applied, so they describe what the server reads rather than what the format permits.
 */

export type JsonValue = unknown;

export interface SchemaObject {
  [keyword: string]: unknown;
}

export interface ExampleObject {
  summary?: string;
  value?: unknown;
  externalValue?: string;
}

export interface MediaTypeObject {
  schema?: SchemaObject;
  example?: unknown;
  examples?: Record<string, ExampleObject>;
}

export interface ParameterObject {
  name?: unknown;
  in?: unknown;
  required?: unknown;
  schema?: SchemaObject;
  content?: Record<string, MediaTypeObject>;
  examples?: Record<string, ExampleObject>;
  style?: unknown;
  explode?: unknown;
}

export interface RequestBodyObject {
  required?: unknown;
  content?: Record<string, MediaTypeObject>;
}

export interface ResponseObject {
  description?: unknown;
  headers?: Record<string, unknown>;
  content?: Record<string, MediaTypeObject>;
  links?: Record<string, unknown>;
}

export interface OperationObject {
  operationId?: unknown;
  deprecated?: unknown;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
}

export interface PathItemObject {
  parameters?: ParameterObject[];
  servers?: unknown;
  [member: string]: unknown;
}

export interface ServerObject {
  url?: unknown;
}

export interface OpenApiDocument {
  openapi?: unknown;
  servers?: ServerObject[];
  paths?: Record<string, PathItemObject>;
  components?: Record<string, unknown>;
  [member: string]: unknown;
}

/** The HTTP methods an OpenAPI 3.0 Path Item may declare, in the order the specification lists them. */
export const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON media type is `application/json` or any subtype ending in `+json` (glossary, §2). */
export function isJsonMediaType(mediaType: string): boolean {
  const essence = mediaType.split(';')[0]?.trim().toLowerCase() ?? '';
  const subtype = essence.split('/')[1] ?? '';
  return essence === 'application/json' || subtype.endsWith('+json');
}
