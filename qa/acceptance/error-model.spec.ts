/**
 * REQ-042 .. REQ-046 — the mock error body, the origin and payload headers, the normative status
 * table, and the rule that separates a documented error from a mock error.
 */

import { describe, expect, it } from 'vitest';
import { PETSTORE, fixture, useServer, type Started } from '../helpers/server.js';
import { errorBody, request, type Res } from '../helpers/http.js';

const REQUEST_TIME_CODES = [
  'ROUTE_NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'MALFORMED_REQUEST_BODY',
  'UNSUPPORTED_REQUEST_MEDIA_TYPE',
  'REQUEST_VALIDATION_FAILED',
  'INVALID_PREFER_HEADER',
  'NO_RESPONSE_FOR_STATUS',
  'EXAMPLE_NOT_FOUND',
  'NO_SUPPORTED_MEDIA_TYPE',
  'GENERATION_FAILED',
];

describe('REQ-042 — every mock error has the same body shape', () => {
  const server = useServer({ specPath: PETSTORE });

  it('REQ-042: the body is an object with a known code and a non-empty message', async () => {
    const res = await request(server().url, '/no-such-path');
    const body = errorBody(res);
    expect({
      source: res.header('x-mock-source'),
      knownCode: REQUEST_TIME_CODES.includes(String(body.code)),
      hasMessage: typeof body.message === 'string' && body.message.length > 0,
    }).toEqual({ source: 'mock', knownCode: true, hasMessage: true });
  });

  it('REQ-042: pointer, when present, begins with #/ and details, when present, is an array or object', async () => {
    const res = await request(server().url, '/pets/abc');
    const body = errorBody(res);
    expect({
      status: res.status,
      code: body.code,
      pointerOk: body.pointer === undefined || String(body.pointer).startsWith('#/'),
      detailsOk: body.details === undefined || typeof body.details === 'object',
    }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
      pointerOk: true,
      detailsOk: true,
    });
  });

  it('REQ-042: the body contains no other top-level members', async () => {
    const res = await request(server().url, '/pets/abc');
    const keys = Object.keys((res.json ?? {}) as object);
    expect({
      code: errorBody(res).code,
      extra: keys.filter((key) => !['code', 'message', 'pointer', 'details'].includes(key)),
    }).toEqual({ code: 'REQUEST_VALIDATION_FAILED', extra: [] });
  });
});

describe('REQ-043 — every response declares its origin', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const headers = useServer({ specPath: fixture('ignored-response-headers-links.yaml') });

  it('REQ-043: exactly one X-Mock-Source header is present, with a permitted value', async () => {
    const fromSpec = await request(petstore().url, '/pets');
    const fromMock = await request(petstore().url, '/no-such-path');
    expect([fromSpec.header('x-mock-source'), fromMock.header('x-mock-source')]).toEqual([
      'specification',
      'mock',
    ]);
  });

  it('REQ-043: a documented response header inside the reserved X-Mock- prefix is never emitted', async () => {
    const res = await request(headers().url, '/pets');
    // The fixture documents `X-Mock-Source` on this response; the served value must be the
    // server's own, never the specification's.
    expect(res.header('x-mock-source')).toBe('specification');
  });

  it('REQ-043: documented response headers are not emitted at all in this MVP', async () => {
    const res = await request(headers().url, '/pets');
    expect({ status: res.status, rateLimit: res.header('x-rate-limit') }).toEqual({
      status: 200,
      rateLimit: undefined,
    });
  });
});

describe('REQ-044 — generated responses expose how they were produced', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const noContent = useServer({ specPath: fixture('no-content.yaml') });
  const precedence = useServer({ specPath: fixture('payload-precedence.yaml') });

  it('REQ-044: a schema.example payload is example with no X-Mock-Seed — no seed was consumed', async () => {
    // REQ-033 level 3. The payload/seed table in REQ-044 maps all three example levels onto
    // `example` with the seed absent.
    const res = await request(precedence().url, '/schema-example');
    expect({
      source: res.header('x-mock-source'),
      payload: res.header('x-mock-payload'),
      seed: res.header('x-mock-seed'),
    }).toEqual({ source: 'specification', payload: 'example', seed: undefined });
  });

  it('REQ-044: a specification response always carries one of the three X-Mock-Payload values', async () => {
    const generated = await request(petstore().url, '/pets');
    const example = await request(petstore().url, '/pets/1');
    const none = await request(noContent().url, '/absent-content', { method: 'DELETE' });
    expect([
      generated.header('x-mock-payload'),
      example.header('x-mock-payload'),
      none.header('x-mock-payload'),
    ]).toEqual(['generated', 'example', 'none']);
  });

  it('REQ-044: a generated response carries X-Mock-Seed as a decimal integer in 0..4294967295', async () => {
    const res = await request(petstore().url, '/pets');
    const seed = res.header('x-mock-seed');
    const value = Number(seed);
    expect({
      present: seed !== undefined,
      decimal: /^\d+$/.test(seed ?? ''),
      inRange: Number.isInteger(value) && value >= 0 && value <= 4294967295,
    }).toEqual({ present: true, decimal: true, inRange: true });
  });

  it('REQ-044: an example or empty payload carries no X-Mock-Seed', async () => {
    const example = await request(petstore().url, '/pets/1');
    const none = await request(noContent().url, '/absent-content', { method: 'DELETE' });
    expect({
      payloads: [example.header('x-mock-payload'), none.header('x-mock-payload')],
      seeds: [example.header('x-mock-seed'), none.header('x-mock-seed')],
    }).toEqual({ payloads: ['example', 'none'], seeds: [undefined, undefined] });
  });

  it('REQ-044: a mock error carries neither X-Mock-Payload nor X-Mock-Seed', async () => {
    const res = await request(petstore().url, '/no-such-path');
    expect({
      source: res.header('x-mock-source'),
      payload: res.header('x-mock-payload'),
      seed: res.header('x-mock-seed'),
    }).toEqual({ source: 'mock', payload: undefined, seed: undefined });
  });
});

describe('REQ-045 — error codes and their HTTP statuses', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const mediaTypes = useServer({ specPath: fixture('media-type-selection.yaml') });
  const generation = useServer({ specPath: fixture('generation-unsatisfiable.yaml') });

  /** One trigger per row of the normative request-time table. */
  const triggers: Record<string, { status: number; trigger: (servers: Record<string, Started>) => Promise<Res> }> = {
    ROUTE_NOT_FOUND: { status: 404, trigger: (s) => request(s.petstore!.url, '/no-such-path') },
    METHOD_NOT_ALLOWED: {
      status: 405,
      trigger: (s) => request(s.petstore!.url, '/pets/1', { method: 'DELETE' }),
    },
    MALFORMED_REQUEST_BODY: {
      status: 400,
      trigger: (s) =>
        request(s.petstore!.url, '/pets', {
          method: 'POST',
          body: '{"name":',
          headers: { 'content-type': 'application/json' },
        }),
    },
    UNSUPPORTED_REQUEST_MEDIA_TYPE: {
      status: 415,
      trigger: (s) =>
        request(s.petstore!.url, '/pets', {
          method: 'POST',
          body: 'Rex',
          headers: { 'content-type': 'text/plain' },
        }),
    },
    REQUEST_VALIDATION_FAILED: { status: 422, trigger: (s) => request(s.petstore!.url, '/pets/abc') },
    INVALID_PREFER_HEADER: {
      status: 400,
      trigger: (s) => request(s.petstore!.url, '/pets/1', { headers: { prefer: 'code=abc' } }),
    },
    NO_RESPONSE_FOR_STATUS: {
      status: 400,
      trigger: (s) => request(s.petstore!.url, '/pets/1', { headers: { prefer: 'code=500' } }),
    },
    EXAMPLE_NOT_FOUND: {
      status: 400,
      trigger: (s) => request(s.petstore!.url, '/pets/1', { headers: { prefer: 'example=nosuch' } }),
    },
    NO_SUPPORTED_MEDIA_TYPE: { status: 406, trigger: (s) => request(s.mediaTypes!.url, '/non-json-only') },
    GENERATION_FAILED: { status: 500, trigger: (s) => request(s.generation!.url, '/impossible') },
  };

  it.each(Object.entries(triggers))('REQ-045: %s is served with the status the table prescribes', async (code, row) => {
    const res = await row.trigger({
      petstore: petstore(),
      mediaTypes: mediaTypes(),
      generation: generation(),
    });
    expect({ status: res.status, code: errorBody(res).code, source: res.header('x-mock-source') }).toEqual({
      status: row.status,
      code,
      source: 'mock',
    });
  });
});

describe('REQ-046 — a documented error is never confused with a mock error', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const problem = useServer({ specPath: fixture('documented-problem-json.yaml') });

  it('REQ-046: the documented 404 is a specification response carrying the documented example', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'code=404' } });
    expect({
      status: res.status,
      source: res.header('x-mock-source'),
      mediaType: res.mediaType,
      body: res.json,
    }).toEqual({
      status: 404,
      source: 'specification',
      mediaType: 'application/json',
      body: { code: 'NOT_FOUND', message: 'Pet not found.' },
    });
  });

  it('REQ-046: an unrouted path is a mock 404 in problem+json with code ROUTE_NOT_FOUND', async () => {
    const res = await request(petstore().url, '/nosuchpath');
    expect({
      status: res.status,
      source: res.header('x-mock-source'),
      mediaType: res.mediaType,
      code: errorBody(res).code,
    }).toEqual({
      status: 404,
      source: 'mock',
      mediaType: 'application/problem+json',
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('REQ-046: the two 404s are separable by X-Mock-Source, by Content-Type and by body code alone', async () => {
    const documented = await request(petstore().url, '/pets/1', { headers: { prefer: 'code=404' } });
    const mock = await request(petstore().url, '/nosuchpath');
    expect({
      bySource: documented.header('x-mock-source') !== mock.header('x-mock-source'),
      byMediaType: documented.mediaType !== mock.mediaType,
      byCode: errorBody(documented).code !== errorBody(mock).code,
      sameStatus: documented.status === mock.status,
    }).toEqual({ bySource: true, byMediaType: true, byCode: true, sameStatus: true });
  });

  it('REQ-046: X-Mock-Source stays authoritative when the specification itself documents problem+json', async () => {
    const res = await request(problem().url, '/resource', { headers: { prefer: 'code=404' } });
    expect({
      status: res.status,
      source: res.header('x-mock-source'),
      mediaType: res.mediaType,
      body: res.json,
    }).toEqual({
      status: 404,
      source: 'specification',
      mediaType: 'application/problem+json',
      body: { code: 'DOCUMENTED_NOT_FOUND', message: 'The specification documents this one.' },
    });
  });
});
