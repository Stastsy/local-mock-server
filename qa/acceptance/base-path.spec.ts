/**
 * REQ-018 — the base path comes from the path component of servers[0].url.
 *
 * The Business Analyst flagged this as the area where a wrong guess stays invisible until a real
 * client is pointed at the mock (REQUIREMENTS section 9, concern 5), so every rule gets its own
 * fixture and its own request.
 */

import { describe, expect, it } from 'vitest';
import { PETSTORE, fixture, startServer } from '../helpers/server.js';
import { errorBody, request } from '../helpers/http.js';

/** Issues one GET against a server built from `file` and returns status plus body. */
async function get(file: string, path: string): Promise<{ status: number; code: unknown }> {
  const server = await startServer({ specPath: file });
  try {
    const res = await request(server.url, path);
    return { status: res.status, code: errorBody(res).code };
  } finally {
    await server.stop();
  }
}

describe('REQ-018 — base path from servers[0].url', () => {
  it('REQ-018: an absolute servers[0].url with a path component prefixes every route', async () => {
    expect((await get(fixture('servers-base-v1.yaml'), '/v1/pets')).status).toBe(200);
  });

  it('REQ-018: with a base path, the unprefixed path is ROUTE_NOT_FOUND', async () => {
    expect(await get(fixture('servers-base-v1.yaml'), '/pets')).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('REQ-018: a trailing slash on servers[0].url is stripped from the base path', async () => {
    expect((await get(fixture('servers-base-v1-trailing.yaml'), '/v1/pets')).status).toBe(200);
  });

  it('REQ-018: a stripped trailing slash does not make /v1//pets a route', async () => {
    expect(await get(fixture('servers-base-v1-trailing.yaml'), '/v1//pets')).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('REQ-018: a servers[0].url with no path component leaves routes unprefixed', async () => {
    const server = await startServer({ specPath: PETSTORE });
    try {
      const res = await request(server.url, '/pets');
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('REQ-018: a path component of exactly / becomes an empty base path', async () => {
    expect((await get(fixture('servers-root-slash.yaml'), '/pets')).status).toBe(200);
  });

  it('REQ-018: a templated servers[0].url is ignored, so routes stay unprefixed', async () => {
    expect((await get(fixture('servers-templated.yaml'), '/pets')).status).toBe(200);
  });

  it('REQ-018: a templated servers[0].url contributes no base path either', async () => {
    expect(await get(fixture('servers-templated.yaml'), '/v1/pets')).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('REQ-018: a relative servers[0].url supplies the base path', async () => {
    expect((await get(fixture('servers-relative.yaml'), '/v1/pets')).status).toBe(200);
  });

  it('REQ-018: only the first servers entry is considered', async () => {
    const first = await get(fixture('servers-two.yaml'), '/v1/pets');
    const second = await get(fixture('servers-two.yaml'), '/v2/pets');
    expect([first, second]).toEqual([
      { status: 200, code: undefined },
      { status: 404, code: 'ROUTE_NOT_FOUND' },
    ]);
  });

  it('REQ-018: path-item and operation servers never contribute a base path', async () => {
    const atRoot = await get(fixture('servers-path-item.yaml'), '/pets');
    const atV2 = await get(fixture('servers-path-item.yaml'), '/v2/pets');
    expect([atRoot, atV2]).toEqual([
      { status: 200, code: undefined },
      { status: 404, code: 'ROUTE_NOT_FOUND' },
    ]);
  });

  it('REQ-018: an empty servers array leaves the base path empty', async () => {
    expect((await get(fixture('servers-empty.yaml'), '/pets')).status).toBe(200);
  });

  it('REQ-018: an absent servers key leaves the base path empty', async () => {
    expect((await get(fixture('minimal.yaml'), '/ping')).status).toBe(200);
  });

  it('REQ-018: an unparseable servers[0].url is ignored, and is never a load-time error', async () => {
    // `http://[` is a string, so the Server Object schema holds and REQ-004 does not fire, but
    // both `new URL("http://[")` and `new URL("http://[", base)` throw ERR_INVALID_URL. Rule 6
    // says the entry is ignored and the base path is empty.
    const server = await startServer({ specPath: fixture('servers-unparseable-url.yaml') });
    try {
      const res = await request(server.url, '/pets');
      expect({ status: res.status, body: res.json }).toEqual({ status: 200, body: { ok: true } });
    } finally {
      await server.stop();
    }
  });

  it('REQ-018: a non-empty base path is not optional for any other prefix', async () => {
    expect(await get(fixture('servers-base-v1.yaml'), '/v2/pets')).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });
});
