/**
 * REQ-013 .. REQ-017 — routing: which operations exist, how path templates match, specificity,
 * unmatched paths and undocumented methods.
 */

import { describe, expect, it } from 'vitest';
import { PETSTORE, fixture, startServer, useServer } from '../helpers/server.js';
import { errorBody, request } from '../helpers/http.js';

describe('REQ-013 — every documented operation is routed at its path template', () => {
  const server = useServer({ specPath: PETSTORE });

  it('REQ-013: GET /pets is routed and declares its origin as the specification', async () => {
    const res = await request(server().url, '/pets');
    expect({ status: res.status, source: res.header('x-mock-source') }).toEqual({
      status: 200,
      source: 'specification',
    });
  });

  it('REQ-013: POST /pets with a valid JSON body is routed to the 201 response', async () => {
    const res = await request(server().url, '/pets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rex' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(201);
  });

  it('REQ-013: GET /pets/1 is routed to the templated operation', async () => {
    const res = await request(server().url, '/pets/1');
    expect(res.status).toBe(200);
  });

  it('REQ-013: only the documented methods are routed — nothing is synthesised', async () => {
    const documented = await request(server().url, '/pets/1');
    const undocumented = await request(server().url, '/pets/1', { method: 'DELETE' });
    expect({ documented: documented.status, undocumented: undocumented.status }).toEqual({
      documented: 200,
      undocumented: 405,
    });
  });
});

describe('REQ-014 — path parameters match exactly one path segment', () => {
  const server = useServer({ specPath: PETSTORE });

  it('REQ-014: GET /pets/1 matches the single-segment template', async () => {
    const res = await request(server().url, '/pets/1');
    expect(res.status).toBe(200);
  });

  it('REQ-014: GET /pets/1/toys does not match and is ROUTE_NOT_FOUND', async () => {
    const res = await request(server().url, '/pets/1/toys');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('REQ-014: GET /pets/ with an empty final segment is ROUTE_NOT_FOUND', async () => {
    const res = await request(server().url, '/pets/');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('REQ-014: GET /pets/%31 percent-decodes the parameter to 1 before validation', async () => {
    const res = await request(server().url, '/pets/%31');
    expect(res.status).toBe(200);
  });

  it('REQ-014: a template variable that is not a whole segment never matches a non-literal request', async () => {
    const partial = await startServer({ specPath: fixture('routing-partial-segment.yaml') });
    try {
      const res = await request(partial.url, '/files/report.txt');
      expect({ status: res.status, code: errorBody(res).code }).toEqual({
        status: 404,
        code: 'ROUTE_NOT_FOUND',
      });
    } finally {
      await partial.stop();
    }
  });
});

describe('REQ-015 — literal segments win over template segments', () => {
  const path = fixture('routing-specificity.yaml');
  const server = useServer({ specPath: path });

  it('REQ-015: GET /pets/mine is answered by the literal operation', async () => {
    const res = await request(server().url, '/pets/mine');
    expect(res.json).toEqual({ which: 'mine' });
  });

  it('REQ-015: GET /pets/7 is answered by the templated operation', async () => {
    const res = await request(server().url, '/pets/7');
    expect(res.json).toEqual({ which: 'byId' });
  });

  it('REQ-015: specificity is decided segment by segment from the left', async () => {
    const literal = await request(server().url, '/pets/mine/toys');
    const templated = await request(server().url, '/pets/7/toys');
    expect([literal.json, templated.json]).toEqual([{ which: 'mine-toys' }, { which: 'byId-toys' }]);
  });
});

describe('REQ-016 — an unmatched path is ROUTE_NOT_FOUND', () => {
  const server = useServer({ specPath: PETSTORE });

  it('REQ-016: GET /unknown is 404 / ROUTE_NOT_FOUND', async () => {
    const res = await request(server().url, '/unknown');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('REQ-016: a trailing slash is significant — /pets/ is not /pets', async () => {
    const res = await request(server().url, '/pets/');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('REQ-016: path matching is case-sensitive — /PETS is not /pets', async () => {
    const res = await request(server().url, '/PETS');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('REQ-016: the server exposes no root page', async () => {
    const res = await request(server().url, '/');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });
});

describe('REQ-017 — a matched path with an undocumented method is METHOD_NOT_ALLOWED', () => {
  const server = useServer({ specPath: PETSTORE });

  it('REQ-017: DELETE /pets/1 is 405 / METHOD_NOT_ALLOWED', async () => {
    const res = await request(server().url, '/pets/1', { method: 'DELETE' });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
    });
  });

  it('REQ-017: the Allow header lists the documented methods of that template', async () => {
    const res = await request(server().url, '/pets/1', { method: 'DELETE' });
    expect(res.header('allow')).toBe('GET');
  });

  it('REQ-017: Allow is uppercased and in document order for a multi-method path item', async () => {
    const res = await request(server().url, '/pets', { method: 'PUT' });
    expect({ status: res.status, allow: res.header('allow') }).toEqual({ status: 405, allow: 'GET, POST' });
  });

  it('REQ-017: HEAD is not derived from a documented GET', async () => {
    const res = await request(server().url, '/pets', { method: 'HEAD' });
    expect(res.status).toBe(405);
  });

  it('REQ-017: OPTIONS is not synthesised', async () => {
    const res = await request(server().url, '/pets', { method: 'OPTIONS' });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
    });
  });
});
