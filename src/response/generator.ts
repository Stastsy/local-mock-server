/**
 * Seeded data generation (REQ-038 .. REQ-040).
 *
 * The seed is applied *per generation call*. A single generator instance created once and reused
 * would advance its internal PRNG between calls, so a repeated identical request would return a
 * different body and break the determinism property (ARCHITECTURE §7).
 */

import { generateSync } from 'json-schema-faker';
import type { ValidateFunction } from 'ajv';
import { MockError } from '../errors.js';
import { isRecord, type SchemaObject } from '../spec/types.js';
import { compile, toJsonSchema, violationsOf, type JsonSchema } from '../validation/json-schema.js';

interface PreparedSchema {
  json: JsonSchema;
  validate: ValidateFunction;
}

const prepared = new WeakMap<SchemaObject, PreparedSchema>();

export function generate(schema: SchemaObject, seed: number, pointer: string): unknown {
  const { json, validate } = prepare(schema);

  let value: unknown;
  try {
    value = generateSync(json as never, { seed });
  } catch (error: unknown) {
    throw new MockError(
      'GENERATION_FAILED',
      `Data generation failed for this schema: ${error instanceof Error ? error.message : String(error)}`,
      { pointer, cause: error },
    );
  }

  // REQ-040: the server never returns a 2xx with a body that does not validate against the schema
  // it was generated from. A generator that silently ignores contradictory constraints is caught
  // here rather than passed on to the client.
  if (validate(value) !== true) {
    throw new MockError(
      'GENERATION_FAILED',
      'The generated value does not validate against the schema it was generated from.',
      {
        pointer,
        details: violationsOf(validate).map((violation) => ({
          instancePath: violation.instancePath,
          schemaPath: violation.schemaPath,
          message: violation.message,
        })),
      },
    );
  }

  return value;
}

function prepare(schema: SchemaObject): PreparedSchema {
  const cached = prepared.get(schema);
  if (cached !== undefined) return cached;
  const json = toJsonSchema(stripWriteOnly(schema));
  const entry: PreparedSchema = { json, validate: compile(json) };
  prepared.set(schema, entry);
  return entry;
}

/**
 * REQ-039 — a `writeOnly` property is never present in a generated response body, including one
 * the schema lists as required. This is the only case in which a generated body may omit a
 * required property, so the property is dropped from `required` as well.
 */
function stripWriteOnly(schema: SchemaObject): SchemaObject {
  const transform = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(transform);
    if (!isRecord(node)) return node;

    const properties = node['properties'];
    const writeOnly = new Set<string>();
    if (isRecord(properties)) {
      for (const [name, property] of Object.entries(properties)) {
        if (isRecord(property) && property['writeOnly'] === true) writeOnly.add(name);
      }
    }

    const copy: Record<string, unknown> = {};
    for (const [keyword, value] of Object.entries(node)) {
      if (keyword === 'properties' && isRecord(value)) {
        const kept: Record<string, unknown> = {};
        for (const [name, property] of Object.entries(value)) {
          if (!writeOnly.has(name)) kept[name] = transform(property);
        }
        copy[keyword] = kept;
      } else if (keyword === 'required' && Array.isArray(value)) {
        copy[keyword] = value.filter((name) => typeof name !== 'string' || !writeOnly.has(name));
      } else {
        copy[keyword] = transform(value);
      }
    }
    return copy;
  };

  return transform(schema) as SchemaObject;
}
