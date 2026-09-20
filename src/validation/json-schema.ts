/**
 * OAS 3.0 Schema Object -> JSON Schema, plus the single AJV instance the server validates with.
 *
 * An OAS 3.0 Schema is *not* a JSON Schema: `nullable` is a keyword of its own and
 * `exclusiveMinimum` / `exclusiveMaximum` are booleans that modify `minimum` / `maximum`
 * (ARCHITECTURE §7). The converter handles `nullable`; the boolean exclusive bounds it leaves in
 * their draft-04 form, so they are rewritten here into the numeric form AJV 8 understands.
 */

import { fromSchema } from '@openapi-contrib/openapi-schema-to-json-schema';
import { Ajv, type ValidateFunction } from 'ajv';
import * as ajvFormats from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import { isRecord, type SchemaObject } from '../spec/types.js';

export type JsonSchema = Record<string, unknown>;

// `strict: false`: a converted OAS schema legitimately carries annotations AJV does not know
// (`example`, `xml`, `discriminator`, `readOnly` on a request schema).
// `ajv-formats` is a CommonJS package whose type declarations are written as ESM, so TypeScript's
// synthesised default and the real `module.exports.default` disagree. The bridge is explicit here
// rather than hidden behind `any`.
const addFormats = (ajvFormats as unknown as { default: FormatsPlugin }).default;

// `logger: false`: an unrecognised `format` is an annotation the requirements say to ignore
// (REQ-038), and the server writes nothing to stdout or stderr by default (REQ-057).
const ajv = addFormats(new Ajv({ strict: false, allErrors: true, logger: false }));

export function toJsonSchema(schema: SchemaObject): JsonSchema {
  const { $schema: _draft, ...converted } = fromSchema(schema as never) as JsonSchema;
  return rewriteExclusiveBounds(converted);
}

export function compile(schema: JsonSchema): ValidateFunction {
  return ajv.compile(schema);
}

export interface Violation {
  instancePath: string;
  schemaPath: string;
  message: string;
}

export function violationsOf(validate: ValidateFunction): Violation[] {
  return (validate.errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    message: error.message ?? 'is invalid',
  }));
}

function rewriteExclusiveBounds(node: unknown): JsonSchema {
  return transform(node) as JsonSchema;
}

function transform(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(transform);
  if (!isRecord(node)) return node;

  const result: Record<string, unknown> = {};
  for (const [keyword, value] of Object.entries(node)) {
    if (keyword === 'exclusiveMinimum' || keyword === 'exclusiveMaximum') continue;
    result[keyword] = transform(value);
  }

  applyExclusive(node, result, 'exclusiveMinimum', 'minimum');
  applyExclusive(node, result, 'exclusiveMaximum', 'maximum');
  return result;
}

function applyExclusive(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  exclusive: 'exclusiveMinimum' | 'exclusiveMaximum',
  inclusive: 'minimum' | 'maximum',
): void {
  const flag = source[exclusive];
  if (typeof flag === 'number') {
    target[exclusive] = flag;
    return;
  }
  if (flag !== true) return;

  const bound = source[inclusive];
  if (typeof bound === 'number') {
    target[exclusive] = bound;
    delete target[inclusive];
  }
}
