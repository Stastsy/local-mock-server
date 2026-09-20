/**
 * REQ-027 .. REQ-032 — response selection: status code, then media type, then the empty-body case.
 *
 * Each fixture response carries a self-naming example, so a test can tell which documented
 * response was selected without asserting a generated value.
 */

import { describe, expect, it } from 'vitest';
import { PETSTORE, fixture, useServer } from '../helpers/server.js';
import { detailsText, errorBody, request } from '../helpers/http.js';

describe('REQ-027 — the default status code is the lowest documented 2xx', () => {
  const server = useServer({ specPath: fixture('status-selection.yaml') });

  it('REQ-027: with 200 and 400 documented, the default is 200', async () => {
    const res = await request(server().url, '/ok-and-bad-request');
    expect({ status: res.status, body: res.json }).toEqual({ status: 200, body: { from: '200' } });
  });

  it('REQ-027: with 201, 202 and 400 documented, the default is 201', async () => {
    const res = await request(server().url, '/several-2xx');
    expect({ status: res.status, body: res.json }).toEqual({ status: 201, body: { from: '201' } });
  });

  it('REQ-027: with no 2xx documented, the lowest documented numeric status is selected', async () => {
    const res = await request(server().url, '/no-2xx');
    expect({ status: res.status, body: res.json }).toEqual({ status: 301, body: { from: '301' } });
  });

  it('REQ-027: an operation documenting only default is served as 200 from the default response', async () => {
    const res = await request(server().url, '/default-only');
    expect({ status: res.status, body: res.json }).toEqual({ status: 200, body: { from: 'default' } });
  });

  it('REQ-027: default is never selected while a numeric status is documented', async () => {
    const res = await request(server().url, '/default-and-numeric');
    expect({ status: res.status, body: res.json }).toEqual({ status: 200, body: { from: '200' } });
  });
});

describe('REQ-028 — Prefer: code=NNN selects a documented response', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const statuses = useServer({ specPath: fixture('status-selection.yaml') });

  it('REQ-028: Prefer: code=404 serves the documented 404 as a specification response', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'code=404' } });
    expect({ status: res.status, source: res.header('x-mock-source'), body: res.json }).toEqual({
      status: 404,
      source: 'specification',
      body: { code: 'NOT_FOUND', message: 'Pet not found.' },
    });
  });

  it('REQ-028: Prefer: code=400 serves the documented 400 as a specification response', async () => {
    const res = await request(petstore().url, '/pets', { headers: { prefer: 'code=400' } });
    expect({ status: res.status, source: res.header('x-mock-source') }).toEqual({
      status: 400,
      source: 'specification',
    });
  });

  it('REQ-028: Prefer: code=default is rejected — code takes a numeric status only', async () => {
    const res = await request(statuses().url, '/default-only', { headers: { prefer: 'code=default' } });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 400,
      code: 'INVALID_PREFER_HEADER',
    });
  });
});

describe('REQ-029 — an undocumented preferred status is NO_RESPONSE_FOR_STATUS', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const statuses = useServer({ specPath: fixture('status-selection.yaml') });

  it('REQ-029: Prefer: code=500 on an operation documenting 200 and 404 is 400 and lists the documented statuses', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'code=500' } });
    const serialised = detailsText(res);
    expect({
      status: res.status,
      code: errorBody(res).code,
      lists200: serialised.includes('200'),
      lists404: serialised.includes('404'),
    }).toEqual({ status: 400, code: 'NO_RESPONSE_FOR_STATUS', lists200: true, lists404: true });
  });

  it('REQ-029: a documented default does not make every status available', async () => {
    const res = await request(statuses().url, '/default-and-numeric', { headers: { prefer: 'code=500' } });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 400,
      code: 'NO_RESPONSE_FOR_STATUS',
    });
  });
});

describe('REQ-030 — media type selection prefers application/json', () => {
  const server = useServer({ specPath: fixture('media-type-selection.yaml') });

  it('REQ-030: application/json wins over text/plain', async () => {
    const res = await request(server().url, '/json-and-text');
    expect({ mediaType: res.mediaType, body: res.json }).toEqual({
      mediaType: 'application/json',
      body: { m: 'json' },
    });
  });

  it('REQ-030: a +json vendor media type is chosen over a non-JSON one declared first', async () => {
    const res = await request(server().url, '/text-then-vendor');
    expect({ mediaType: res.mediaType, body: res.json }).toEqual({
      mediaType: 'application/vnd.acme.pet+json',
      body: { m: 'vendor' },
    });
  });

  it('REQ-030: the first JSON media type in document order wins when several are JSON', async () => {
    const res = await request(server().url, '/hal-then-problem');
    expect({ mediaType: res.mediaType, body: res.json }).toEqual({
      mediaType: 'application/hal+json',
      body: { m: 'hal' },
    });
  });

  it('REQ-030: the Accept request header is ignored', async () => {
    const withAccept = await request(server().url, '/json-and-text', { headers: { accept: 'text/plain' } });
    const without = await request(server().url, '/json-and-text');
    expect({ mediaType: withAccept.mediaType, sameBody: withAccept.text === without.text }).toEqual({
      mediaType: 'application/json',
      sameBody: true,
    });
  });
});

describe('REQ-031 — a selected response with content but no JSON media type is 406', () => {
  const server = useServer({ specPath: fixture('media-type-selection.yaml') });

  it('REQ-031: a text/plain and application/xml response is 406 and lists the documented media types', async () => {
    const res = await request(server().url, '/non-json-only');
    const serialised = detailsText(res);
    expect({
      status: res.status,
      code: errorBody(res).code,
      listsText: serialised.includes('text/plain'),
      listsXml: serialised.includes('application/xml'),
    }).toEqual({ status: 406, code: 'NO_SUPPORTED_MEDIA_TYPE', listsText: true, listsXml: true });
  });

  it('REQ-031: this is a request-time failure — the JSON operations of the same document still work', async () => {
    const res = await request(server().url, '/json-and-text');
    expect(res.status).toBe(200);
  });
});

describe('REQ-032 — a response with no content is served with an empty body', () => {
  const server = useServer({ specPath: fixture('no-content.yaml') });

  it('REQ-032: a response with no content member sends zero bytes and no Content-Type', async () => {
    const res = await request(server().url, '/absent-content', { method: 'DELETE' });
    expect({
      status: res.status,
      bytes: res.text.length,
      contentType: res.header('content-type'),
      source: res.header('x-mock-source'),
      payload: res.header('x-mock-payload'),
    }).toEqual({
      status: 204,
      bytes: 0,
      contentType: undefined,
      source: 'specification',
      payload: 'none',
    });
  });

  it('REQ-032: an empty content map behaves the same way', async () => {
    const res = await request(server().url, '/empty-content', { method: 'DELETE' });
    expect({
      status: res.status,
      bytes: res.text.length,
      contentType: res.header('content-type'),
      payload: res.header('x-mock-payload'),
    }).toEqual({ status: 204, bytes: 0, contentType: undefined, payload: 'none' });
  });
});
