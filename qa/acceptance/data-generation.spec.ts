/**
 * REQ-038 .. REQ-041 — data generation and the response Content-Type.
 *
 * No test here asserts a generated value. Bodies are validated against the schema taken from the
 * fixture (ARCHITECTURE section 4, rule 2); where the requirement states a bound explicitly, the
 * bound itself is asserted rather than the value that satisfied it.
 */

import { describe, expect, it } from 'vitest';
import { PETSTORE, fixture, useServer } from '../helpers/server.js';
import { errorBody, request } from '../helpers/http.js';
import { conformsToResponseSchema } from '../helpers/schema.js';

interface Pet {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  tags?: unknown;
}

describe('REQ-038 — a generated body conforms to the response schema', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const composition = useServer({ specPath: fixture('schema-composition.yaml') });
  const constraints = useServer({ specPath: fixture('schema-constraints.yaml') });

  it('REQ-038: GET /pets validates against the documented array-of-Pet schema', async () => {
    const res = await request(petstore().url, '/pets');
    const conformance = await conformsToResponseSchema(PETSTORE, { path: '/pets' }, res.json);
    expect({ status: res.status, valid: conformance.valid, errors: conformance.errors }).toEqual({
      status: 200,
      valid: true,
      errors: '',
    });
  });

  it('REQ-038: every generated pet respects its enum, length, minimum and maxItems bounds', async () => {
    const res = await request(petstore().url, '/pets');
    const pets = Array.isArray(res.json) ? (res.json as Pet[]) : [];
    expect({
      count: pets.length >= 1 && pets.length <= 5,
      statuses: pets.every((pet) => ['available', 'pending', 'sold'].includes(String(pet.status))),
      names: pets.every((pet) => String(pet.name).length >= 1 && String(pet.name).length <= 40),
      ids: pets.every((pet) => Number.isInteger(pet.id) && Number(pet.id) >= 1),
      tags: pets.every((pet) => pet.tags === undefined || (Array.isArray(pet.tags) && pet.tags.length <= 4)),
    }).toEqual({ count: true, statuses: true, names: true, ids: true, tags: true });
  });

  it.each([
    ['allOf', '/all-of'],
    ['oneOf', '/one-of'],
    ['anyOf', '/any-of'],
  ])('REQ-038: a body generated from %s validates against that schema', async (_keyword, path) => {
    const specPath = fixture('schema-composition.yaml');
    const res = await request(composition().url, path);
    const conformance = await conformsToResponseSchema(specPath, { path }, res.json);
    expect({ status: res.status, valid: conformance.valid, errors: conformance.errors }).toEqual({
      status: 200,
      valid: true,
      errors: '',
    });
  });

  it('REQ-038: additionalProperties: false yields no property outside properties', async () => {
    const specPath = fixture('schema-constraints.yaml');
    const res = await request(constraints().url, '/strict');
    const conformance = await conformsToResponseSchema(specPath, { path: '/strict' }, res.json);
    expect({
      valid: conformance.valid,
      extraKeys: Object.keys((res.json ?? {}) as object).filter((key) => !['a', 'b'].includes(key)),
    }).toEqual({ valid: true, extraKeys: [] });
  });

  it('REQ-038: generated values satisfy the supported formats', async () => {
    const specPath = fixture('schema-constraints.yaml');
    const res = await request(constraints().url, '/formats');
    const conformance = await conformsToResponseSchema(specPath, { path: '/formats' }, res.json);
    expect({ status: res.status, valid: conformance.valid, errors: conformance.errors }).toEqual({
      status: 200,
      valid: true,
      errors: '',
    });
  });

  it('REQ-038: an unrecognised format is ignored while the remaining constraints still hold', async () => {
    const specPath = fixture('schema-constraints.yaml');
    const res = await request(constraints().url, '/unknown-format');
    const conformance = await conformsToResponseSchema(specPath, { path: '/unknown-format' }, res.json);
    expect({ status: res.status, valid: conformance.valid, errors: conformance.errors }).toEqual({
      status: 200,
      valid: true,
      errors: '',
    });
  });
});

describe('REQ-039 — writeOnly properties are never generated', () => {
  const server = useServer({ specPath: fixture('readonly-writeonly.yaml') });

  it('REQ-039: a required writeOnly property is absent from the generated body', async () => {
    const res = await request(server().url, '/accounts', {
      method: 'POST',
      body: JSON.stringify({ name: 'a' }),
      headers: { 'content-type': 'application/json' },
    });
    expect({
      status: res.status,
      payload: res.header('x-mock-payload'),
      hasPassword: Object.keys((res.json ?? {}) as object).includes('password'),
    }).toEqual({ status: 201, payload: 'generated', hasPassword: false });
  });

  it('REQ-039: every other required property is still present', async () => {
    const res = await request(server().url, '/accounts', {
      method: 'POST',
      body: JSON.stringify({ name: 'a' }),
      headers: { 'content-type': 'application/json' },
    });
    const keys = Object.keys((res.json ?? {}) as object);
    expect({ hasId: keys.includes('id'), hasName: keys.includes('name') }).toEqual({
      hasId: true,
      hasName: true,
    });
  });
});

describe('REQ-040 — a generation failure is reported, not hidden', () => {
  const server = useServer({ specPath: fixture('generation-unsatisfiable.yaml') });

  it('REQ-040: contradictory constraints are 500 / GENERATION_FAILED with a pointer to the schema', async () => {
    const res = await request(server().url, '/impossible');
    expect({
      status: res.status,
      code: errorBody(res).code,
      pointerStart: String(errorBody(res).pointer).slice(0, 2),
    }).toEqual({ status: 500, code: 'GENERATION_FAILED', pointerStart: '#/' });
  });

  it('REQ-040: a satisfiable schema in the same document still generates a conforming body', async () => {
    const specPath = fixture('generation-unsatisfiable.yaml');
    const res = await request(server().url, '/possible');
    const conformance = await conformsToResponseSchema(specPath, { path: '/possible' }, res.json);
    expect({ status: res.status, valid: conformance.valid }).toEqual({ status: 200, valid: true });
  });
});

describe('REQ-041 — response Content-Type', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const mediaTypes = useServer({ specPath: fixture('media-type-selection.yaml') });

  it('REQ-041: a generated body is served with the selected media type', async () => {
    const res = await request(petstore().url, '/pets');
    expect(res.mediaType).toBe('application/json');
  });

  it('REQ-041: an example body is served with the selected media type, vendor subtypes included', async () => {
    const res = await request(mediaTypes().url, '/text-then-vendor');
    expect(res.mediaType).toBe('application/vnd.acme.pet+json');
  });

  it('REQ-041: a mock error is served as application/problem+json', async () => {
    const res = await request(petstore().url, '/no-such-path');
    expect({ status: res.status, source: res.header('x-mock-source'), mediaType: res.mediaType }).toEqual({
      status: 404,
      source: 'mock',
      mediaType: 'application/problem+json',
    });
  });
});
