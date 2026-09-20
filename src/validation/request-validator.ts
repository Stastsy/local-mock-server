/**
 * Request validation (REQ-019 .. REQ-026).
 *
 * Every failure here is a mock error, never the documented `400`: a specification that documents
 * `400` for bad input is not consulted to produce it. All violations of one request are collected
 * and reported together (REQ-026); the two failures that make validation impossible at all — an
 * undocumented media type and unparseable bytes — are thrown instead, because they have their own
 * status in REQ-045's table.
 */

import { MockError } from '../errors.js';
import type { RouteOperation } from '../routing/router.js';
import { isJsonMediaType, isRecord, type SchemaObject } from '../spec/types.js';
import { compile, toJsonSchema, violationsOf, type JsonSchema } from './json-schema.js';
import type { ValidateFunction } from 'ajv';

export type ViolationLocation = 'path' | 'query' | 'header' | 'body';

export interface RequestViolation {
  location: ViolationLocation;
  name?: string;
  instancePath?: string;
  message: string;
  schemaPath: string;
}

export interface PreparedRequest {
  pathParams: Record<string, string>;
  query: URLSearchParams;
  /** Lowercased header names, as Node delivers them. */
  headers: Record<string, string | string[] | undefined>;
  /** Raw request bytes; empty when no body was sent. */
  body: Buffer;
  contentType: string | undefined;
}

/**
 * REQ-021 — these four are part of the protocol the server itself speaks, so they are never
 * validated as header parameters even when the specification declares them.
 */
const RESERVED_HEADERS = new Set(['accept', 'content-type', 'authorization', 'prefer']);

const parameterValidators = new WeakMap<SchemaObject, ValidateFunction>();
const requestBodyValidators = new WeakMap<SchemaObject, ValidateFunction>();

export function validateRequest(
  target: RouteOperation,
  request: PreparedRequest,
): RequestViolation[] {
  return [...validateParameters(target, request), ...validateBody(target, request)];
}

function validateParameters(
  target: RouteOperation,
  request: PreparedRequest,
): RequestViolation[] {
  const violations: RequestViolation[] = [];

  for (const parameter of target.parameters) {
    const name = typeof parameter.name === 'string' ? parameter.name : undefined;
    const location = typeof parameter.in === 'string' ? parameter.in : undefined;
    if (name === undefined || location === undefined) continue;
    if (location !== 'path' && location !== 'query' && location !== 'header') continue;
    if (location === 'header' && RESERVED_HEADERS.has(name.toLowerCase())) continue;

    const schema = isRecord(parameter.schema) ? (parameter.schema as SchemaObject) : undefined;
    const supplied = readParameter(location, name, schema, request);

    if (supplied === undefined) {
      if (parameter.required === true) {
        violations.push({
          location,
          name,
          message: `Required ${location} parameter "${name}" is missing.`,
          schemaPath: '#/required',
        });
      }
      continue;
    }

    if (schema === undefined) continue;

    const validate = validatorFor(parameterValidators, schema, toJsonSchema);
    if (validate(coerce(supplied, schema)) === true) continue;

    for (const violation of violationsOf(validate)) {
      violations.push({
        location,
        name,
        message: `${location} parameter "${name}" ${violation.message}`,
        schemaPath: violation.schemaPath,
      });
    }
  }

  return violations;
}

function readParameter(
  location: 'path' | 'query' | 'header',
  name: string,
  schema: SchemaObject | undefined,
  request: PreparedRequest,
): string | string[] | undefined {
  if (location === 'path') return request.pathParams[name];

  if (location === 'query') {
    // The default `form`/`explode: true` style: an array arrives as repeated `name=value` pairs.
    if (schema?.['type'] === 'array') {
      const values = request.query.getAll(name);
      return values.length === 0 ? undefined : values;
    }
    return request.query.get(name) ?? undefined;
  }

  // REQ-021: header names match case-insensitively.
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(',') : value;
}

/** Query, path and header values are always strings; the declared primitive type decides the rest. */
function coerce(value: string | string[], schema: SchemaObject): unknown {
  if (Array.isArray(value)) {
    const items = isRecord(schema['items']) ? (schema['items'] as SchemaObject) : undefined;
    return items === undefined ? value : value.map((item) => coerceScalar(item, items));
  }
  return coerceScalar(value, schema);
}

function coerceScalar(value: string, schema: SchemaObject): unknown {
  const type = schema['type'];
  if (type === 'integer' || type === 'number') {
    if (value.trim() === '') return value;
    const numeric = Number(value);
    // A value that is not a number is left as a string so the schema rejects it rather than the
    // coercion silently swallowing it.
    return Number.isFinite(numeric) ? numeric : value;
  }
  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }
  return value;
}

function validateBody(target: RouteOperation, request: PreparedRequest): RequestViolation[] {
  const requestBody = target.operation.requestBody;
  // REQ-022: an operation that declares no requestBody ignores a body sent anyway.
  if (!isRecord(requestBody)) return [];

  const hasBody = request.body.length > 0;
  if (!hasBody) {
    if (requestBody.required !== true) return [];
    return [
      {
        location: 'body',
        instancePath: '',
        message: 'A request body is required.',
        schemaPath: '#/requestBody/required',
      },
    ];
  }

  const content = isRecord(requestBody.content) ? requestBody.content : {};
  const mediaType = matchMediaType(content, request.contentType);
  if (mediaType === undefined) {
    throw new MockError(
      'UNSUPPORTED_REQUEST_MEDIA_TYPE',
      `The request media type "${request.contentType ?? 'application/json'}" is not documented for this operation.`,
      {
        pointer: `${target.pointer}/requestBody/content`,
        details: { documented: Object.keys(content), received: request.contentType ?? null },
      },
    );
  }

  if (!isJsonMediaType(mediaType)) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body.toString('utf8'));
  } catch (error: unknown) {
    throw new MockError('MALFORMED_REQUEST_BODY', 'The request body is not parseable JSON.', {
      pointer: `${target.pointer}/requestBody`,
      cause: error,
    });
  }

  const declared = content[mediaType];
  const schema = isRecord(declared) ? declared['schema'] : undefined;
  if (!isRecord(schema)) return [];

  const validate = validatorFor(requestBodyValidators, schema as SchemaObject, (oas) =>
    toJsonSchema(stripReadOnlyRequired(oas)),
  );
  if (validate(parsed) === true) return [];

  return violationsOf(validate).map((violation) => ({
    location: 'body' as const,
    instancePath: violation.instancePath,
    message: `body${violation.instancePath} ${violation.message}`,
    schemaPath: violation.schemaPath,
  }));
}

/** REQ-023: parameters after `;` are ignored, and a body with no `Content-Type` is JSON. */
function matchMediaType(
  content: Record<string, unknown>,
  contentType: string | undefined,
): string | undefined {
  const essence = (contentType?.split(';')[0] ?? 'application/json').trim().toLowerCase();
  return Object.keys(content).find((documented) => documented.toLowerCase() === essence);
}

/**
 * REQ-025 — a `readOnly` property is server-owned, so requiring a client to send it is a
 * specification mistake the server absorbs rather than a request error.
 */
function stripReadOnlyRequired(schema: SchemaObject): SchemaObject {
  const transform = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(transform);
    if (!isRecord(node)) return node;

    const copy: Record<string, unknown> = {};
    for (const [keyword, value] of Object.entries(node)) copy[keyword] = transform(value);

    const properties = node['properties'];
    const required = node['required'];
    if (isRecord(properties) && Array.isArray(required)) {
      copy['required'] = required.filter((name) => {
        const property = typeof name === 'string' ? properties[name] : undefined;
        return !(isRecord(property) && property['readOnly'] === true);
      });
    }
    return copy;
  };

  return transform(schema) as SchemaObject;
}

function validatorFor(
  cache: WeakMap<SchemaObject, ValidateFunction>,
  schema: SchemaObject,
  convert: (schema: SchemaObject) => JsonSchema,
): ValidateFunction {
  const cached = cache.get(schema);
  if (cached !== undefined) return cached;
  const validate = compile(convert(schema));
  cache.set(schema, validate);
  return validate;
}
