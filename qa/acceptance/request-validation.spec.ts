/**
 * REQ-019 .. REQ-026 — request validation.
 *
 * Every validation failure is a mock error, never the documented 400: the tests therefore assert
 * the status, the `code`, and the `location`/`name` of the reported violations — never a message.
 */

import { describe, expect, it } from 'vitest';
import { PETSTORE, fixture, useServer } from '../helpers/server.js';
import { detailsText, errorBody, jsonBody, request, violations } from '../helpers/http.js';

describe('REQ-019 — path parameters are validated against their schema', () => {
  const server = useServer({ specPath: PETSTORE });
  const coercion = useServer({ specPath: fixture('params-coercion.yaml') });

  it('REQ-019: a non-numeric path parameter is 422 and names the parameter', async () => {
    const res = await request(server().url, '/pets/abc');
    expect({
      status: res.status,
      code: errorBody(res).code,
      entry: violations(res).some((v) => v.location === 'path' && v.name === 'petId'),
    }).toEqual({ status: 422, code: 'REQUEST_VALIDATION_FAILED', entry: true });
  });

  it('REQ-019: a path parameter below its minimum is 422', async () => {
    const res = await request(server().url, '/pets/0');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });

  it('REQ-019: a valid path parameter is 200, never 404', async () => {
    const res = await request(server().url, '/pets/1');
    expect(res.status).toBe(200);
  });

  it('REQ-019: a path parameter is coerced to its declared primitive type before validation', async () => {
    const res = await request(coercion().url, '/flag/true');
    expect(res.status).toBe(200);
  });
});

describe('REQ-020 — query parameters are validated; undeclared ones are ignored', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const required = useServer({ specPath: fixture('params-required-query.yaml') });
  const arrays = useServer({ specPath: fixture('params-array-query.yaml') });
  const pathItem = useServer({ specPath: fixture('params-path-item.yaml') });

  it('REQ-020: a missing required query parameter is 422 and names it', async () => {
    const res = await request(required().url, '/search');
    expect({
      status: res.status,
      code: errorBody(res).code,
      entry: violations(res).some((v) => v.location === 'query' && v.name === 'q'),
    }).toEqual({ status: 422, code: 'REQUEST_VALIDATION_FAILED', entry: true });
  });

  it('REQ-020: a query parameter below its minimum is 422', async () => {
    const res = await request(petstore().url, '/pets?limit=0');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });

  it('REQ-020: a non-numeric value for an integer query parameter is 422', async () => {
    const res = await request(petstore().url, '/pets?limit=abc');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });

  it('REQ-020: a query parameter inside its bounds is 200', async () => {
    const res = await request(petstore().url, '/pets?limit=20');
    expect(res.status).toBe(200);
  });

  it('REQ-020: a value outside an enum is 422', async () => {
    const res = await request(petstore().url, '/pets?status=unknown');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });

  it('REQ-020: an undeclared query parameter is ignored and never an error', async () => {
    const res = await request(petstore().url, '/pets?colour=red');
    expect(res.status).toBe(200);
  });

  it('REQ-020: an omitted optional parameter with a default is valid and no default is injected', async () => {
    const omitted = await request(petstore().url, '/pets');
    const supplied = await request(petstore().url, '/pets?limit=20');
    // Omitting the parameter must not behave as if `limit=20` had been sent: were the default
    // injected, the two requests would share a request identity and therefore a body (REQ-054).
    expect({ status: omitted.status, injected: omitted.text === supplied.text }).toEqual({
      status: 200,
      injected: false,
    });
  });

  it('REQ-020: repeated name=value pairs collect into an array and validate', async () => {
    const res = await request(arrays().url, '/pets?tags=dog&tags=cat');
    expect(res.status).toBe(200);
  });

  it('REQ-020: a collected array violating maxItems is 422', async () => {
    const res = await request(arrays().url, '/pets?tags=dog&tags=cat&tags=rat&tags=bat');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });

  it('REQ-020: a path-item parameter applies to an operation that declares none', async () => {
    const res = await request(pathItem().url, '/items');
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });

  it('REQ-020: an operation parameter with the same name and location replaces the path-item one', async () => {
    const res = await request(pathItem().url, '/items', { method: 'POST' });
    expect(res.status).toBe(201);
  });
});

describe('REQ-021 — header parameters are validated, case-insensitively by name', () => {
  const server = useServer({ specPath: fixture('params-header.yaml') });

  it('REQ-021: a missing required header parameter is 422 with location "header"', async () => {
    const res = await request(server().url, '/h');
    expect({
      status: res.status,
      code: errorBody(res).code,
      entry: violations(res).some((v) => v.location === 'header'),
    }).toEqual({ status: 422, code: 'REQUEST_VALIDATION_FAILED', entry: true });
  });

  it('REQ-021: a header name matches case-insensitively', async () => {
    const res = await request(server().url, '/h', { headers: { 'x-request-id': 'abc' } });
    expect(res.status).toBe(200);
  });

  it('REQ-021: a header value violating its schema is 422', async () => {
    const res = await request(server().url, '/h', {
      headers: { 'X-Request-Id': 'abc', 'X-Count': '99' },
    });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });

  it('REQ-021: Accept, Content-Type, Authorization and Prefer are never validated as header parameters', async () => {
    const res = await request(server().url, '/reserved-headers');
    expect(res.status).toBe(200);
  });
});

describe('REQ-022 — request bodies are validated against the documented schema', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const optional = useServer({ specPath: fixture('body-optional.yaml') });

  it('REQ-022: a missing required body is 422 with location "body"', async () => {
    const res = await request(petstore().url, '/pets', { method: 'POST' });
    expect({
      status: res.status,
      code: errorBody(res).code,
      entry: violations(res).some((v) => v.location === 'body'),
    }).toEqual({ status: 422, code: 'REQUEST_VALIDATION_FAILED', entry: true });
  });

  it('REQ-022: a body missing a required property is 422', async () => {
    const res = await request(petstore().url, '/pets', {
      method: 'POST',
      ...jsonBody({ status: 'available' }),
    });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });

  it('REQ-022: a body violating minLength is 422', async () => {
    const res = await request(petstore().url, '/pets', { method: 'POST', ...jsonBody({ name: '' }) });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });

  it('REQ-022: a valid body is 201', async () => {
    const res = await request(petstore().url, '/pets', { method: 'POST', ...jsonBody({ name: 'Rex' }) });
    expect(res.status).toBe(201);
  });

  it('REQ-022: an operation whose requestBody is not required accepts no body', async () => {
    const res = await request(optional().url, '/optional', { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it('REQ-022: an operation declaring no requestBody ignores a body that is sent anyway', async () => {
    const res = await request(optional().url, '/no-body', {
      method: 'POST',
      ...jsonBody({ anything: true }),
    });
    expect(res.status).toBe(201);
  });
});

describe('REQ-023 — an undocumented request media type is 415', () => {
  const server = useServer({ specPath: PETSTORE });

  it('REQ-023: text/plain against a JSON-only requestBody is 415 and names the documented types', async () => {
    const res = await request(server().url, '/pets', {
      method: 'POST',
      body: 'Rex',
      headers: { 'content-type': 'text/plain' },
    });
    expect({
      status: res.status,
      code: errorBody(res).code,
      namesJson: detailsText(res).includes('application/json'),
    }).toEqual({ status: 415, code: 'UNSUPPORTED_REQUEST_MEDIA_TYPE', namesJson: true });
  });

  it('REQ-023: a charset parameter after the media type is ignored', async () => {
    const res = await request(server().url, '/pets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rex' }),
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    expect(res.status).toBe(201);
  });

  it('REQ-023: a non-empty body with no Content-Type at all is parsed as application/json', async () => {
    const res = await request(server().url, '/pets', {
      method: 'POST',
      // A Uint8Array body keeps undici from setting a Content-Type of its own.
      body: new TextEncoder().encode(JSON.stringify({ name: 'Rex' })),
    });
    expect(res.status).toBe(201);
  });
});

describe('REQ-024 — a malformed JSON request body is 400', () => {
  const server = useServer({ specPath: PETSTORE });

  it('REQ-024: unparseable bytes are 400 / MALFORMED_REQUEST_BODY', async () => {
    const res = await request(server().url, '/pets', {
      method: 'POST',
      body: '{"name":',
      headers: { 'content-type': 'application/json' },
    });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 400,
      code: 'MALFORMED_REQUEST_BODY',
    });
  });

  it('REQ-024: a parseable body that violates the schema is 422, not 400', async () => {
    const res = await request(server().url, '/pets', { method: 'POST', ...jsonBody({ name: 42 }) });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });
});

describe('REQ-025 — readOnly and writeOnly have explicit, opposite effects', () => {
  const server = useServer({ specPath: fixture('readonly-writeonly.yaml') });

  it('REQ-025: a required readOnly property may be omitted from a request body', async () => {
    const res = await request(server().url, '/accounts', { method: 'POST', ...jsonBody({ name: 'a' }) });
    expect(res.status).toBe(201);
  });

  it('REQ-025: a supplied readOnly property is accepted and ignored', async () => {
    const res = await request(server().url, '/accounts', {
      method: 'POST',
      ...jsonBody({ id: 7, name: 'a' }),
    });
    expect(res.status).toBe(201);
  });

  it('REQ-025: a writeOnly property is absent from the generated response body', async () => {
    const res = await request(server().url, '/accounts', { method: 'POST', ...jsonBody({ name: 'a' }) });
    expect({
      status: res.status,
      hasPassword: Object.keys((res.json ?? {}) as object).includes('password'),
    }).toEqual({ status: 201, hasPassword: false });
  });
});

describe('REQ-026 — validation failures report every violation in a stable shape', () => {
  const server = useServer({ specPath: fixture('validation-multi.yaml') });

  it('REQ-026: three simultaneous violations produce one 422 with three details entries', async () => {
    const res = await request(server().url, '/things/abc?size=0', {
      method: 'POST',
      ...jsonBody({ name: '' }),
    });
    expect({
      status: res.status,
      code: errorBody(res).code,
      locations: [...new Set(violations(res).map((v) => v.location))].sort(),
    }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
      locations: ['body', 'path', 'query'],
    });
  });

  it('REQ-026: every details entry carries location, message, schemaPath and a name or instancePath', async () => {
    const res = await request(server().url, '/things/abc?size=0', {
      method: 'POST',
      ...jsonBody({ name: '' }),
    });
    const wellShaped = violations(res).every((v) => {
      const locationOk = ['path', 'query', 'header', 'body'].includes(String(v.location));
      const messageOk = typeof v.message === 'string' && v.message.length > 0;
      const schemaPathOk = typeof v.schemaPath === 'string' && v.schemaPath.length > 0;
      const locatorOk = v.location === 'body' ? typeof v.instancePath === 'string' : typeof v.name === 'string';
      return locationOk && messageOk && schemaPathOk && locatorOk;
    });
    expect({ count: violations(res).length > 0, wellShaped }).toEqual({ count: true, wellShaped: true });
  });
});
