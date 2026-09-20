/**
 * An OAS 3.0 Schema Object is not a JSON Schema. The two differences that matter here — `nullable`
 * and the boolean form of `exclusiveMinimum` / `exclusiveMaximum` — are invisible over HTTP until
 * a body is wrongly accepted or wrongly rejected, so they are pinned at the conversion itself.
 */

import { describe, expect, it } from 'vitest';
import { compile, toJsonSchema } from '../../src/validation/json-schema.js';

function accepts(oasSchema: Record<string, unknown>, value: unknown): boolean {
  return compile(toJsonSchema(oasSchema))(value) === true;
}

describe('toJsonSchema', () => {
  it('drops the draft declaration the converter emits', () => {
    expect(toJsonSchema({ type: 'string' })).not.toHaveProperty('$schema');
  });

  it('turns nullable into a type union', () => {
    const schema = { type: 'string', nullable: true, minLength: 1 };
    expect([accepts(schema, null), accepts(schema, 'a'), accepts(schema, 1)]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('leaves a non-nullable type rejecting null', () => {
    expect(accepts({ type: 'string' }, null)).toBe(false);
  });

  it('rewrites the boolean exclusiveMinimum of OAS 3.0 into its numeric JSON Schema form', () => {
    const schema = { type: 'integer', minimum: 1, exclusiveMinimum: true };
    expect(toJsonSchema(schema)).toEqual({ type: 'integer', exclusiveMinimum: 1 });
    expect([accepts(schema, 1), accepts(schema, 2)]).toEqual([false, true]);
  });

  it('rewrites the boolean exclusiveMaximum the same way', () => {
    const schema = { type: 'integer', maximum: 10, exclusiveMaximum: true };
    expect([accepts(schema, 10), accepts(schema, 9)]).toEqual([false, true]);
  });

  it('leaves an inclusive bound alone when the exclusive flag is false', () => {
    const schema = { type: 'integer', minimum: 1, exclusiveMinimum: false };
    expect([accepts(schema, 1), accepts(schema, 0)]).toEqual([true, false]);
  });

  it('rewrites exclusive bounds nested inside properties and composition keywords', () => {
    const schema = {
      type: 'object',
      properties: {
        value: { allOf: [{ type: 'integer', minimum: 0, exclusiveMinimum: true }] },
      },
    };
    expect([accepts(schema, { value: 0 }), accepts(schema, { value: 1 })]).toEqual([false, true]);
  });

  it('ignores an unrecognised format while the remaining constraints still apply', () => {
    const schema = { type: 'string', format: 'gtin-13', minLength: 13, maxLength: 13 };
    expect([accepts(schema, '1234567890123'), accepts(schema, 'short')]).toEqual([true, false]);
  });

  it('enforces a supported format', () => {
    expect([
      accepts({ type: 'string', format: 'uuid' }, 'b7e3cba0-74e4-4cb4-8c34-17f31d56f463'),
      accepts({ type: 'string', format: 'uuid' }, 'not-a-uuid'),
    ]).toEqual([true, false]);
  });
});
