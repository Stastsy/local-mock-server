/**
 * Schema conformance checking (ARCHITECTURE section 4, rule 2).
 *
 * The response schema is read out of the fixture itself — never out of `src/` — dereferenced with
 * swagger-parser, converted from OAS 3.0 Schema to JSON Schema, and compiled with AJV. Tests
 * assert that a body conforms; they never assert a generated value.
 */

import SwaggerParser from '@apidevtools/swagger-parser';
import { fromSchema } from '@openapi-contrib/openapi-schema-to-json-schema';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

type AnyRecord = Record<string, unknown>;

const dereferenced = new Map<string, Promise<AnyRecord>>();
const compiled = new Map<string, ValidateFunction>();

function ajv(): Ajv {
  // `strict: false`: converted OAS schemas legitimately carry annotations AJV does not know
  // (`example`, `xml`, `discriminator`).
  const instance = new Ajv({ strict: false, allErrors: true });
  addFormats(instance);
  return instance;
}

/** Dereferences a fixture once per process and caches it. */
export async function loadSpec(specPath: string): Promise<AnyRecord> {
  let pending = dereferenced.get(specPath);
  if (pending === undefined) {
    pending = SwaggerParser.dereference(specPath) as unknown as Promise<AnyRecord>;
    dereferenced.set(specPath, pending);
  }
  return pending;
}

export interface SchemaLocation {
  path: string;
  method?: string;
  /** Documented status key, e.g. `'200'` or `'default'`. Defaults to `'200'`. */
  status?: string;
  /** Documented media type. Defaults to `'application/json'`. */
  mediaType?: string;
}

function at(root: unknown, segments: (string | undefined)[], where: string): unknown {
  let node: unknown = root;
  for (const segment of segments) {
    if (segment === undefined) continue;
    if (node === null || typeof node !== 'object') {
      throw new Error(`Fixture has no node at ${where} (stopped before "${segment}").`);
    }
    node = (node as AnyRecord)[segment];
  }
  return node;
}

/** The OAS schema object documented for one response, taken from the fixture. */
export async function responseSchema(specPath: string, location: SchemaLocation): Promise<AnyRecord> {
  const api = await loadSpec(specPath);
  const method = (location.method ?? 'get').toLowerCase();
  const status = location.status ?? '200';
  const mediaType = location.mediaType ?? 'application/json';
  const where = `${method.toUpperCase()} ${location.path} -> ${status} -> ${mediaType}`;

  const schema = at(
    api,
    ['paths', location.path, method, 'responses', status, 'content', mediaType, 'schema'],
    where,
  );

  if (schema === null || typeof schema !== 'object') {
    throw new Error(`Fixture declares no response schema at ${where}.`);
  }
  return schema as AnyRecord;
}

/** Compiles an OAS schema object into an AJV validator, caching by location key. */
export async function responseValidator(specPath: string, location: SchemaLocation): Promise<ValidateFunction> {
  const key = [
    specPath,
    (location.method ?? 'get').toLowerCase(),
    location.path,
    location.status ?? '200',
    location.mediaType ?? 'application/json',
  ].join('|');

  const cached = compiled.get(key);
  if (cached !== undefined) return cached;

  const oas = await responseSchema(specPath, location);
  // The converter emits a draft-04 `$schema`, which AJV 8 cannot load; the converted body itself
  // is draft-07 compatible, so the declaration is dropped.
  const { $schema: _unused, ...jsonSchema } = fromSchema(oas as never) as AnyRecord;
  const validate = ajv().compile(jsonSchema);
  compiled.set(key, validate);
  return validate;
}

export interface ConformanceResult {
  valid: boolean;
  /** Human-readable AJV errors, used only to make a failure message readable. */
  errors: string;
}

/** Validates a response body against the schema the fixture documents for that response. */
export async function conformsToResponseSchema(
  specPath: string,
  location: SchemaLocation,
  body: unknown,
): Promise<ConformanceResult> {
  const validate = await responseValidator(specPath, location);
  const valid = validate(body) === true;
  return {
    valid,
    errors: valid
      ? ''
      : (validate.errors ?? [])
          .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
          .join('; '),
  };
}

/** Validates a body against an arbitrary OAS schema object (used for `oneOf` branch checks). */
export function conformsToSchema(oasSchema: AnyRecord, body: unknown): ConformanceResult {
  const { $schema: _unused, ...jsonSchema } = fromSchema(oasSchema as never) as AnyRecord;
  const validate = ajv().compile(jsonSchema);
  const valid = validate(body) === true;
  return {
    valid,
    errors: valid
      ? ''
      : (validate.errors ?? [])
          .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
          .join('; '),
  };
}

/** The value of a named example documented in the fixture. */
export async function documentedExample(
  specPath: string,
  location: SchemaLocation & { name: string },
): Promise<unknown> {
  const api = await loadSpec(specPath);
  const method = (location.method ?? 'get').toLowerCase();
  const where = `${method.toUpperCase()} ${location.path} example ${location.name}`;
  return at(
    api,
    [
      'paths',
      location.path,
      method,
      'responses',
      location.status ?? '200',
      'content',
      location.mediaType ?? 'application/json',
      'examples',
      location.name,
      'value',
    ],
    where,
  );
}

/** The value of the single `example` documented for a response in the fixture. */
export async function documentedSingleExample(specPath: string, location: SchemaLocation): Promise<unknown> {
  const api = await loadSpec(specPath);
  const method = (location.method ?? 'get').toLowerCase();
  return at(
    api,
    [
      'paths',
      location.path,
      method,
      'responses',
      location.status ?? '200',
      'content',
      location.mediaType ?? 'application/json',
      'example',
    ],
    `${method.toUpperCase()} ${location.path} example`,
  );
}
